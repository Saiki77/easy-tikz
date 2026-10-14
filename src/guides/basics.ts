/*
 * Guides of the groups "Getting started" and "Functions and sliders".
 *
 * Every step chart is a complete v4 settings object, built by the small
 * helpers below from the state of a new editor (the SettingsManager
 * defaults) so every key is present. The charts were worked out against the
 * engine: ranges written by the automatic fit after the first formula, the
 * texts and slider values real drags produce (prepareDrag + DragSession), the
 * quick fixes MathContext.validate offers. When a recipe, a default or a UI
 * label changes, change the step that names it too.
 */
import { defaultFunction } from '../migrate';
import type { Annotation, FunctionParameters, Parameter } from '../types';
import { ChartData, Guide } from './types';

// ------------------------------------------------------------- builders

/** The chart a new editor starts with (SettingsManager defaults), with `overrides` on top. */
function chart(overrides: Record<string, unknown> = {}): ChartData {
    return {
        v: 4,
        dimension: false,
        documentSetup: true,
        title: '',
        size_x_cm: 10,
        size_y_cm: 10,
        show_axis_label: true,
        axis_label_x: 'x',
        axis_label_y: 'y',
        showAxis: true,
        showLargeGrid: false,
        showSmallGrid: false,
        gridSize: 5,
        majorTickNum: 8,
        xmin: '-0.5',
        xmax: '10',
        ymin: '-0.5',
        ymax: '5',
        zmin: '-5',
        zmax: '5',
        axis_style: 'box',
        coordinateSystem: 'cartesian',
        axis_label_x_polar: '',
        axis_label_y_polar: '',
        axis_label_z: 'z',
        rotationX: 30,
        rotationZ: 45,
        zoom3D: 1,
        boxAspect: 'true',
        previewSize: 760,
        functions: [],
        functions3D: [],
        tools: [],
        annotations: [],
        parameters: [],
        variables: 'x, y',
        equalScale: false,
        showSlidersInNote: true,
        ...overrides,
    };
}

/** A function card as + Add creates it, with `fields` on top. New cards take black, then blue, then red. */
function fn(name: string, expression: string, fields: Partial<FunctionParameters> = {}): FunctionParameters {
    return { ...defaultFunction([]), name, expression, ...fields };
}

/** A slider. The defaults are those of a slider made by "Add slider": -10 to 10 in steps of 0.1. */
function slider(name: string, value: number, min = -10, max = 10, step = 0.1): Parameter {
    return { name, value, min, max, step };
}

/** A text label as + Add > Text label creates it (centred on its point), with `fields` on top. */
function label(x: string, y: string, text: string, fields: Partial<Annotation> = {}): Annotation {
    return { x, y, text, color: 'black', size: 'normal', anchor: 'center', ...fields };
}

// ------------------------------------------------------- 1. first chart

/** Ranges the editor writes when `2 + sin(x)` is the first formula of a new chart (the automatic fit). */
const FIRST_FIT = { xmin: '-1.025', xmax: '10.525', ymin: '0.902', ymax: '3.099' };
/** Ranges typed in the Chart tab. */
const FIRST_RANGES = { xmin: '0', xmax: '2pi', ymin: '0', ymax: '4' };

function firstChart(stage: 'typed' | 'styled' | 'two' | 'ranges' | 'legend' | 'grid'): ChartData {
    const order = ['typed', 'styled', 'two', 'ranges', 'legend', 'grid'];
    const at = (s: string) => order.indexOf(stage) >= order.indexOf(s);
    const functions = [fn('f1', '2 + sin(x)', at('styled') ? { color: 'blue', thickness: 'thick', showLegend: at('legend') } : {})];
    if (at('two')) functions.push(fn('f2', '2 + cos(x)', { showLegend: at('legend') }));
    return chart({ ...(at('ranges') ? FIRST_RANGES : FIRST_FIT), showLargeGrid: at('grid'), functions });
}

const FIRST_CHART: Guide = {
    id: 'first-chart',
    title: 'Your first chart',
    summary: 'From an empty editor to a chart in your note: type a formula, style it, set the ranges and insert it.',
    category: 'Getting started',
    level: 'start',
    minutes: 5,
    outcomes: [
        'Open the editor and plot a formula',
        'Style a curve and add a second one',
        'Set the ranges, add a legend and switch on the grid',
        'Insert the chart into a note and edit it again later',
    ],
    chart: firstChart('grid'),
    steps: [
        {
            title: 'Open the editor',
            body:
                'Open a note and put the cursor where the chart should go.\n\n' +
                'Click the Easy TikZ icon in the ribbon on the left, or run `Easy TikZ: Open editor` from the command palette. ' +
                'The editor opens on the Build tab with the heading Start a chart. The preview on the right is still empty.',
            chart: chart(),
            shot: { tab: 'build', frame: 'editor', caption: 'A new chart: the Build tab on the left, the empty preview on the right.' },
            tip: 'Insert into note writes the chart at the cursor, so place the cursor before you open the editor.',
        },
        {
            title: 'Type a formula and press Enter',
            body:
                'Type the formula into the field under Start a chart and press Enter.\n\n' +
                'A card named `f1` appears with the summary `y = 2 + sin(x)`, and the curve is drawn. ' +
                'Because the ranges were still the defaults, the editor fits them to the curve once. ' +
                'From now on the preview redraws while you type.',
            type: [{ where: 'Start a chart', text: '2 + sin(x)' }],
            chart: firstChart('typed'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], caption: 'The first function card and its curve. The ranges were fitted to the curve.' },
            tip: 'Functions need brackets: write `sin(x)`, not `sin x`. If you forget them, the message under the field offers the button Use sin(x).',
        },
        {
            title: 'Pick a colour and a thicker line',
            body:
                'Click the colour swatch at the left end of the `f1` card and pick Blue from the grid.\n\n' +
                'Then click Options on the card and choose the third sample in the Line row. The curve is now blue and thick. ' +
                'When you close Options again, a small Thick pill stays on the card, so you see what is switched on without opening it.',
            chart: firstChart('styled'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], caption: 'The curve in blue with a thick line.' },
            tip: 'The first colour in the grid is Auto: it follows the text colour of your theme on screen and exports as black.',
        },
        {
            title: 'Add a second function',
            body:
                'Click + Add at the top of the Build tab and choose Function y = f(x). A new card `f2` appears with the cursor in its formula field.\n\n' +
                'Type the formula. The second curve appears while you type.',
            type: [{ where: 'f2, y =', text: '2 + cos(x)' }],
            chart: firstChart('two'),
            shot: {
                tab: 'build',
                frame: 'editor',
                actions: [{ menu: 'add' }],
                caption: 'The + Add menu lists everything you can draw. Function y = f(x) is its first entry.',
            },
            tip: 'Everything else starts at + Add as well: regions, lines, points, arrows, text labels and sliders.',
        },
        {
            title: 'Set the ranges',
            body:
                'The automatic fit left odd bounds such as -1.025. Open the Chart tab and type your own under Ranges: x from `0` to `2pi`, y from `0` to `4`.\n\n' +
                'The preview now shows exactly one period, with room above the curves. Ranges accept formulas, so `2pi` works as typed.',
            type: [
                { where: 'Chart > Ranges, x from', text: '0' },
                { where: 'Chart > Ranges, x to', text: '2pi' },
                { where: 'Chart > Ranges, y from', text: '0' },
                { where: 'Chart > Ranges, y to', text: '4' },
            ],
            chart: firstChart('ranges'),
            shot: { tab: 'chart', frame: 'editor', caption: 'The Chart tab holds ranges, axes, grid and export size.' },
            tip: 'An axis whose bound is a formula stays fixed when you pan or zoom the preview. Bounds that are plain numbers move.',
        },
        {
            title: 'Show a legend',
            body:
                'Back in the Build tab, open Options on the `f1` card and click Legend. Do the same on the `f2` card.\n\n' +
                'A legend box appears at the top right of the plot and shows each formula. ' +
                'To print your own words instead, type them into the Legend field that appears below the chips.',
            chart: firstChart('legend'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1', 'f2'], caption: 'Legend switched on for both functions.' },
        },
        {
            title: 'Switch on the grid',
            body:
                'Click the grid button in the small toolbar at the bottom right of the preview. Grid lines appear behind the curves.\n\n' +
                'The same switch is called Major grid in the Chart tab, under Grid, next to the minor grid and the number of divisions.',
            chart: firstChart('grid'),
            shot: { tab: 'build', frame: 'preview', caption: 'The finished chart: two curves, a legend and the major grid.' },
        },
        {
            title: 'Insert it into your note',
            body:
                'Click Insert into note at the bottom right, or press Cmd+Enter (Ctrl+Enter on Windows and Linux). ' +
                'The editor closes and the chart is drawn in your note. It is stored there as an `easy-tikz` code block.\n\n' +
                'To change it later, click the chart in the note. The editor opens with every setting filled in, and the button now reads Save changes.',
            shot: { frame: 'note', caption: 'The chart in the note. Click it to edit it again.' },
            tip: 'Closed the editor by accident? Nothing is lost. The next time you open it, it offers to restore the unsaved chart.',
        },
    ],
    next: ['formulas', 'drag-to-edit', 'sliders'],
};

// ---------------------------------------------------------- 2. formulas

function formulasChart(stage: 'product' | 'slider' | 'fraction' | 'brackets' | 'call' | 'domain'): ChartData {
    const order = ['product', 'slider', 'fraction', 'brackets', 'call', 'domain'];
    const at = (s: string) => order.indexOf(stage) >= order.indexOf(s);
    const functions = [fn('f1', at('slider') ? 'a*x(4 - x)' : '0.5x(4 - x)', { domain: at('domain') ? '0:4' : '' })];
    if (at('fraction')) functions.push(fn('f2', at('brackets') ? '1/(2x)' : '1/2x', { color: 'blue' }));
    if (at('call')) functions.push(fn('f3', 'f1(x - 4)', { color: 'red' }));
    return chart({ functions, parameters: at('slider') ? [slider('a', 1)] : [] });
}

const FORMULAS: Guide = {
    id: 'formulas',
    title: 'Write formulas that work',
    summary: 'Leave out the multiplication sign safely, avoid the traps ax and 1/2x, call functions by name and limit them with a domain.',
    category: 'Getting started',
    level: 'start',
    minutes: 6,
    outcomes: [
        'Write products without a multiplication sign',
        'Spot the traps ax and 1/2x before they bite',
        'Reuse a function in another formula by its name',
        'Limit a curve to a domain',
    ],
    requires: ['first-chart'],
    chart: formulasChart('domain'),
    steps: [
        {
            title: 'Multiply without a star',
            body:
                'In a new chart, click + Add, choose Function y = f(x) and type the formula. It means `0.5*x*(4 - x)`: an arch with zeros at 0 and 4.\n\n' +
                'You can leave out `*` between a number, a name or a bracket and whatever follows:\n\n' +
                '- `2x` and `0.5x` multiply a number and a name\n' +
                '- `3(x + 1)` and `(x + 1)(x - 1)` multiply with brackets\n' +
                '- `2 pi` and `a x` multiply two names, and those need the space\n\n' +
                'The Start a chart field would work as well, but it also fits the ranges to the curve. + Add keeps the ranges as they are.',
            type: [{ where: 'f1, y =', text: '0.5x(4 - x)' }],
            chart: formulasChart('product'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], caption: 'A number, a name and a bracket in a row are multiplied.' },
            tip: 'Constants and functions are plain names: `pi`, `e`, `sqrt(x)`, `exp(x)`, `ln(x)`, `abs(x)`. Trigonometry works in radians.',
        },
        {
            title: 'Split a slider from x',
            body:
                'Make the height adjustable: change the formula to `ax(4 - x)`, with the `a` right against the `x`.\n\n' +
                "After a short pause the field reports `Unknown function 'ax'. Did you mean a*x?`. A run of letters is one name, so `ax` is not `a` times `x`. " +
                'Click the button `Use a*x, add slider a`. The formula becomes `a*x(4 - x)`, a slider `a` with the value 1 appears under the preview, and the arch is twice as high as before.',
            chart: formulasChart('slider'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1', 'a'], caption: 'After the fix: the formula multiplies a and x, and the new slider a sits under the preview.' },
            tip: 'Between a slider and x, type a space or a star: `a x` or `a*x`. Numbers do not need one: `2x`.',
        },
        {
            title: 'See what a fraction really means',
            body:
                'Add a second function with + Add > Function y = f(x) and type `1/2x`.\n\n' +
                'You may have meant one over 2x, but the preview draws a straight line. ' +
                'Division and multiplication run from left to right, so `1/2x` is `(1/2)*x`.',
            type: [{ where: 'f2, y =', text: '1/2x' }],
            chart: formulasChart('fraction'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f2'], caption: '1/2x is half of x: a straight line.' },
        },
        {
            title: 'Bracket the denominator',
            body:
                'Put the denominator in brackets. Now the curve is the hyperbola you meant. It breaks at x = 0, where the fraction has no value.\n\n' +
                'Whenever more than one factor belongs below the fraction line, write the brackets.',
            type: [{ where: 'f2, y =', text: '1/(2x)' }],
            chart: formulasChart('brackets'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f2'], caption: 'With brackets: one over 2x.' },
        },
        {
            title: 'Call a function by its name',
            body:
                'Add a third function and type `f1(x - 4)`. Every function can be used in other formulas by the name on its card. ' +
                'The new curve is the arch of `f1` moved 4 to the right, and it follows when you change `f1` or the slider `a`.\n\n' +
                'A bare name means the function at x: `2 f1 + 1` is `2*f1(x) + 1`.',
            type: [{ where: 'f3, y =', text: 'f1(x - 4)' }],
            chart: formulasChart('call'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f3'], caption: 'f3 reuses f1, shifted 4 to the right.' },
            tip: 'With a slider `a`, `a(x - 4)` is a product. With a function `f1`, `f1(x - 4)` is a call. A power belongs to the bracket only: `a(x - 4)^2` is `a*(x - 4)^2`.',
        },
        {
            title: 'Limit a curve with a domain',
            body:
                'On the `f1` card, type `0:4` into the Domain field. A domain is written `min:max`, and both ends may be formulas, as in `0:2pi` or `-a:a`.\n\n' +
                '`f1` is now drawn only between its zeros. Outside its domain a function has no value, so `f3`, which calls `f1`, shrinks to one arch as well, from 4 to 8.',
            type: [{ where: 'f1, Domain', text: '0:4' }],
            chart: formulasChart('domain'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], actions: [{ focus: ['f1', 'domain'] }], caption: 'f1 limited to 0:4. f3 follows, because it calls f1.' },
            tip: 'An empty Domain means the visible x range. The separator is a colon: `0,4` is not accepted.',
        },
    ],
    next: ['sliders', 'tangents-extrema', 'regions'],
};

// ----------------------------------------------------------- 3. sliders

function slidersChart(stage: 'added' | 'dragged' | 'range' | 'play' | 'title' | 'second'): ChartData {
    const order = ['added', 'dragged', 'range', 'play', 'title', 'second'];
    const at = (s: string) => order.indexOf(stage) >= order.indexOf(s);
    const value = at('play') ? -1.2 : at('range') ? 2 : at('dragged') ? 4 : 1;
    const parameters = [at('range') ? slider('a', value, -2, 2) : slider('a', value)];
    if (at('second')) parameters.push(slider('b', 2));
    return chart({
        title: at('title') ? 'Amplitude a = {a}' : '',
        functions: [fn('f1', at('second') ? '2 + a sin(b x)' : '2 + a sin(x)')],
        parameters,
    });
}

const SLIDERS: Guide = {
    id: 'sliders',
    title: 'Sliders that move the picture',
    summary: 'Turn a letter in a formula into a slider, set its range, play it and print its value in the chart.',
    category: 'Functions and sliders',
    level: 'core',
    minutes: 6,
    outcomes: [
        'Create a slider from a letter in a formula',
        'Set the range of a slider and play it',
        'Print a live value in the title',
        'Use the sliders under the chart in your note',
    ],
    requires: ['first-chart'],
    chart: slidersChart('second'),
    steps: [
        {
            title: 'Type a formula with a new letter',
            body:
                'In a new chart, click + Add, choose Function y = f(x) and type the formula.\n\n' +
                "The chart does not know `a` yet. After a short pause the field reports `Unknown name 'a'` and offers a button. " +
                'Click Add slider a. The Sliders dock appears under the preview with `a = 1`, and the wave is drawn.',
            type: [{ where: 'f1, y =', text: '2 + a sin(x)' }],
            chart: slidersChart('added'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1', 'a'], caption: 'The letter a became a slider in the dock under the preview.' },
            tip: 'Keep a space or a `*` after the letter. `asin(x)` is the arcsine, and `ax` is one name.',
        },
        {
            title: 'Drag the slider',
            body:
                'Drag the slider `a` to the right, up to 4. The wave grows while you drag: the preview redraws on every frame, not only when you let go. ' +
                'At 4 it no longer fits, and the crests leave the view.\n\n' +
                'You can also click the value and type a number, or press the arrow keys while the slider has the focus.',
            chart: slidersChart('dragged'),
            shot: { tab: 'build', frame: 'editor', reveal: ['a'], actions: [{ slider: ['a', 4] }], caption: 'a = 4: the wave has outgrown the view.' },
        },
        {
            title: 'Set the range of the slider',
            body:
                'The small numbers at the two ends of the slider are its minimum and maximum. Click the right one, type `2` and press Enter. ' +
                'The value is pulled back to 2 and the wave fits the view again. Then click the left one and type `-2`.\n\n' +
                'Now the whole travel of the slider is useful. The step size sits in the menu behind the three dots on the row, next to Delete slider.',
            type: [
                { where: 'Sliders, a: maximum', text: '2' },
                { where: 'Sliders, a: minimum', text: '-2' },
            ],
            chart: slidersChart('range'),
            shot: { tab: 'build', frame: 'editor', reveal: ['a'], caption: 'The slider now runs from -2 to 2, and the wave stays inside the view.' },
            tip: 'A number typed into the value field may lie outside the range. The range then widens to include it.',
        },
        {
            title: 'Press play',
            body:
                'Click the play button on the slider row. The value sweeps back and forth between the minimum and the maximum, about four seconds each way, and the wave flips over as `a` passes zero.\n\n' +
                'Click the button again to stop, for example near -1.2. While it plays you can still drag the slider; it carries on from where you let go.',
            chart: slidersChart('play'),
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['a'],
                actions: [{ slider: ['a', -1.2] }],
                caption: 'Stopped at a = -1.2: a negative amplitude turns the wave upside down.',
            },
        },
        {
            title: 'Show the value in the title',
            body:
                'Open the Chart tab and type a title under Axes. Curly brackets print the value of a formula, so the title always says where the slider stands.\n\n' +
                '`{a}` prints up to three decimals, `{a:1}` rounds to one. The same placeholders work in every label of the chart.',
            type: [{ where: 'Chart > Axes, Title', text: 'Amplitude a = {a}' }],
            chart: slidersChart('title'),
            shot: { tab: 'chart', frame: 'editor', caption: 'The title prints the live value of a.' },
            tip: 'A placeholder that cannot be computed prints a question mark, so a typo is easy to spot.',
        },
        {
            title: 'Add a second slider',
            body:
                'Back in the Build tab, change the formula to `2 + a sin(b x)` and click Add slider b. `b` starts at 1, so nothing moves yet.\n\n' +
                'Drag `b` to 2: the wave now has twice as many crests. Each slider has its own row. From five sliders on, the dock shows compact pills instead and opens one row at a time.',
            type: [{ where: 'f1, y =', text: '2 + a sin(b x)' }],
            chart: slidersChart('second'),
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['f1', 'b'],
                actions: [{ slider: ['b', 2] }],
                caption: 'Two sliders: a sets the height of the wave, b its frequency.',
            },
            tip: 'To rename a slider, type a new name into its name field. Every formula and label that uses it follows.',
        },
        {
            title: 'Take the sliders into your note',
            body:
                'Click Insert into note. In the note, a strip with the same sliders sits under the chart.\n\n' +
                'Moving them there redraws the chart for the current session only. The note itself is never changed. ' +
                'To hide the strip, switch off Show sliders in note in the Chart tab, under In your note.',
            shot: { frame: 'note', caption: 'The chart in a note with its slider strip.' },
        },
    ],
    next: ['animate-play', 'tangents-extrema', 'drag-to-edit', 'charts-in-notes'],
};

// ------------------------------------------------------ 4. drag to edit

/** x of the first trough of the wave (3π/2), a good place to grab it. */
const TROUGH_X = 4.712;

function dragChart(stage: 'start' | 'moved' | 'slider' | 'turned' | 'stretched'): ChartData {
    const order = ['start', 'moved', 'slider', 'turned', 'stretched'];
    const at = (s: string) => order.indexOf(stage) >= order.indexOf(s);
    const line = at('turned') ? '0.25x + a' : at('slider') ? '0.5x + a' : at('moved') ? '0.5x + 2' : '0.5x + 1';
    return chart({
        functions: [fn('f1', line), fn('f2', at('stretched') ? '2sin(x) + 2.5' : 'sin(x) + 2.5', { color: 'blue' })],
        // Make slider gives the dragged 2 a range from 0 to 5 in steps of 0.05.
        parameters: at('slider') ? [slider('a', 2, 0, 5, 0.05)] : [],
    });
}

const DRAG_TO_EDIT: Guide = {
    id: 'drag-to-edit',
    title: 'Drag shapes to edit them',
    summary: 'Grab a line or a curve in the preview and its numbers follow: move, turn, stretch, undo.',
    category: 'Getting started',
    level: 'start',
    minutes: 7,
    outcomes: [
        'Move a shape and read the tip that says what will change',
        'Turn a line and stretch a curve with Shift',
        'Undo a drag, cancel one, or turn the dragged number into a slider',
        'Switch dragging off when you only want to pan',
    ],
    requires: ['first-chart'],
    chart: dragChart('stretched'),
    steps: [
        {
            title: 'Add a line and a wave',
            body:
                'In a new chart, click + Add, choose Function y = f(x) and type `0.5x + 1`. Add a second function the same way and type `sin(x) + 2.5`.\n\n' +
                'These are the two shapes you are going to drag: a straight line and a curve.',
            type: [
                { where: 'f1, y =', text: '0.5x + 1' },
                { where: 'f2, y =', text: 'sin(x) + 2.5' },
            ],
            chart: dragChart('start'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1', 'f2'], caption: 'A line and a wave, typed as formulas.' },
        },
        {
            title: 'Drag the line up',
            body:
                'Rest the pointer on the line. A tip in the lower left corner of the preview shows `f1: 0.5x + 1` with the `1` highlighted: that is the number a drag will change. ' +
                '(The very first time, the tip explains the gestures for a few seconds instead.)\n\n' +
                'Press on the line near x = 4 and drag it up by one unit. The line follows the pointer, the card reads `0.5x + 2`, and a bar at the bottom of the left pane says Moved f1.',
            chart: dragChart('moved'),
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['f1'],
                actions: [{ hover: [4, 4] }],
                caption: 'After the drag the card reads 0.5x + 2. The tip marks the number the next drag would change.',
            },
            tip: 'Only numbers are rewritten. Your spacing and your way of writing the formula stay as typed, and dragging back restores the text exactly.',
        },
        {
            title: 'Keep the number as a slider',
            body:
                'For 6 seconds after the drag, the bar at the bottom of the left pane offers two buttons: Undo and Make slider. Click Make slider.\n\n' +
                'The `2` you just dragged becomes a slider `a`: the formula reads `0.5x + a`, and the Sliders dock appears with `a = 2` and a range from 0 to 5. ' +
                'From now on a drag of the line moves the slider and leaves the formula alone, because sliders take a change first.',
            chart: dragChart('slider'),
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['f1', 'a'],
                actions: [{ hover: [4, 4] }],
                caption: 'The dragged number is now the slider a. The tip highlights a: the next drag moves the slider.',
            },
            tip: 'Bar already gone? Drag the line away and back to `0.5x + 2`. Make slider is offered after every drag that changed exactly one number you typed.',
        },
        {
            title: 'Hold Shift to turn the line',
            body:
                'Hold Shift and rest the pointer on the line. A ring with a cross, ⊕, appears at (0, 2), and the tip says that a Shift-drag turns the line around it. ' +
                'Easy TikZ places ⊕ where a single number does the turn: for this line, the point on the y-axis.\n\n' +
                'Keep Shift down and drag the line from (4, 4) down to (4, 3). It turns around ⊕ and clicks into the slope 1/4. The card reads `0.25x + a`.',
            chart: dragChart('turned'),
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['f1'],
                actions: [{ hover: [4, 3], shift: true }],
                caption: 'Shift held over the turned line: the pivot ⊕ sits at (0, 2).',
            },
            tip: 'Turns click into simple slopes such as 1, 1/2 or horizontal. Hold Alt (Option on macOS) as well for a free angle and free values.',
        },
        {
            title: 'Stretch the wave with Shift',
            body:
                'Hold Shift over the wave. Its ⊕ sits at (0, 2.5), and the tip adds the note Adds a factor and a scale: the formula has no number that could stretch it, so the drag inserts one.\n\n' +
                'Shift-drag the first crest from 3.5 up to 4.5. The wave doubles its height around ⊕, and the card reads `2sin(x) + 2.5`.',
            chart: dragChart('stretched'),
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['f2'],
                actions: [{ hover: [TROUGH_X, 0.5], shift: true }],
                caption: 'The stretched wave. With Shift held, ⊕ marks the point that stays where it is.',
            },
            tip: 'Sliders change first, then the numbers you typed, and only then a number is inserted. A constant exponent, such as the 2 in `x^2`, never changes.',
        },
        {
            title: 'Undo a drag',
            body:
                'Drag the wave somewhere you did not want it. The bar at the bottom of the left pane names the step, Moved f2, and offers Undo. ' +
                'Click it, or press Cmd+Z (Ctrl+Z on Windows and Linux). Inside a text field the same keys undo your typing instead.\n\n' +
                'Every finished drag is one step. Up to 50 steps can be undone while the editor stays open, and Cmd+Shift+Z redoes a step you undid with Cmd+Z. ' +
                'A step taken back with the Undo button in the bar leaves the history, so it cannot be redone.',
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['f2'],
                actions: [{ drag: [[TROUGH_X, 0.5], [TROUGH_X + 1, 1]] }],
                caption: 'Right after an unwanted drag: the bar offers Undo for 6 seconds.',
            },
            tip: 'The same Undo brings back a deleted card or slider and takes back a slider change.',
        },
        {
            title: 'Cancel with Escape',
            body:
                'Start dragging the line and, with the mouse button still down, press Escape. The line jumps back and the slider returns to its old value, as if you had never touched it.\n\n' +
                'While you drag, a dashed ghost marks where the shape started, and the tip follows the pointer with the live value.',
            chart: dragChart('stretched'),
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['a'],
                actions: [{ drag: [[4, 3], [5, 4.2]], hold: true }],
                caption: 'In the middle of a drag: the ghost shows the start, the tip the live value of a. Escape puts everything back.',
            },
        },
        {
            title: 'Switch dragging off',
            body:
                'Sometimes you only want to pan. Click the pointer button, Edit shapes by dragging, in the small toolbar at the bottom right of the preview. ' +
                'With it off, a drag pans the view wherever it starts, and the choice is remembered.\n\n' +
                'With dragging on you can still pan: drag empty space, or hold Space and drag from anywhere.',
            chart: dragChart('stretched'),
            shot: { tab: 'build', frame: 'editor', caption: 'The pointer button at the bottom right of the preview switches drag to edit on and off.' },
            tip: 'Computed points, such as intersections or an optimum, cannot be dragged. The tip names the lines to drag instead.',
        },
    ],
    next: ['sliders', 'linear-program', 'shortcuts'],
};

// ------------------------------------------------ 5. tangents and extrema

function tangentChart(stage: 'plot' | 'extrema' | 'number' | 'keyword' | 'slider' | 'dragged' | 'label'): ChartData {
    const order = ['plot', 'extrema', 'number', 'keyword', 'slider', 'dragged', 'label'];
    const at = (s: string) => order.indexOf(stage) >= order.indexOf(s);
    const tangentPoint = at('slider') ? 'a' : at('keyword') ? 'max2' : at('number') ? '0.5' : '';
    return chart({
        functions: [fn('f1', '0.4x + sin(x)', { color: 'blue', extrema: at('extrema'), tangent: at('number'), tangentPoint })],
        parameters: at('slider') ? [slider('a', at('dragged') ? 6 : 1, 0, 10)] : [],
        annotations: at('label') ? [label('a - 1', 'f1(a) + 0.6', 'slope {0.4 + cos(a):2}')] : [],
    });
}

const TANGENTS_EXTREMA: Guide = {
    id: 'tangents-extrema',
    title: 'Tangents and extrema',
    summary: 'Mark the turning points of a function, add a tangent, slide it along the curve and label its slope.',
    category: 'Functions and sliders',
    level: 'core',
    minutes: 7,
    outcomes: [
        'Mark local minima and maxima',
        'Draw a tangent at a number, at min or max, or at a slider',
        'Slide the tangent by dragging its point',
        'Label the slope with a live value',
    ],
    requires: ['first-chart', 'sliders'],
    chart: tangentChart('label'),
    steps: [
        {
            title: 'Plot the function',
            body:
                'In a new chart, click + Add, choose Function y = f(x) and type the formula: a wave on a slope, with two crests and one trough in view.\n\n' +
                'Click the colour swatch on the card and pick Blue. The tangent and the markers will take the colour of their function.',
            type: [{ where: 'f1, y =', text: '0.4x + sin(x)' }],
            chart: tangentChart('plot'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], caption: 'The function to explore.' },
        },
        {
            title: 'Mark the extrema',
            body:
                'Open Options on the `f1` card and click Extrema. A dot appears at every local maximum and minimum, labelled max or min.\n\n' +
                'The dots are computed from the curve, so they move when you change the formula.',
            chart: tangentChart('extrema'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], caption: 'Extrema on: two maxima and one minimum are marked.' },
            tip: 'Extrema are searched in the visible x range, or in the Domain when the function has one.',
        },
        {
            title: 'Add a tangent',
            body:
                'In the same Options, click Tangent. A field At x appears, filled in with the middle of the view, and a dashed tangent is drawn with a dot where it touches the curve.\n\n' +
                'Type `0.5` into At x. The tangent now touches the first rise of the curve.',
            type: [{ where: 'f1, At x', text: '0.5' }],
            chart: tangentChart('number'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], actions: [{ focus: ['f1', 'tangentPoint'] }], caption: 'A tangent at x = 0.5. The field At x sits in the Options of the card.' },
        },
        {
            title: 'Snap it to an extremum',
            body:
                'Replace the number with `max2`. The tangent jumps to the second maximum and lies flat. ' +
                '`max` and `min` mean the first local maximum or minimum from the left, `max2` the second maximum, and so on.\n\n' +
                'These keywords stay live: change the formula and the tangent follows the new extremum.',
            type: [{ where: 'f1, At x', text: 'max2' }],
            chart: tangentChart('keyword'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], actions: [{ focus: ['f1', 'tangentPoint'] }], caption: 'At x = max2: a horizontal tangent at the second maximum.' },
            tip: 'If the curve has fewer extrema than the keyword asks for, the status chip at the top left of the preview says so, for example that f1 has only 2 local maxima.',
        },
        {
            title: 'Put the tangent on a slider',
            body:
                'Type `a` into At x and click Add slider a. The point of contact is now the value of the slider, 1 at first.\n\n' +
                'Click the small number at the left end of the slider and type `0`. The slider now runs from 0 to 10, which is the part of the curve in view. Drag it and the tangent rolls along the curve.',
            type: [
                { where: 'f1, At x', text: 'a' },
                { where: 'Sliders, a: minimum', text: '0' },
            ],
            chart: tangentChart('slider'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1', 'a'], actions: [{ focus: ['f1', 'tangentPoint'] }], caption: 'At x = a: the slider moves the tangent.' },
        },
        {
            title: 'Drag the tangent along the curve',
            body:
                'You do not need the dock. Grab the dot of the tangent in the preview and drag it along the curve to x = 6. The slider `a` follows, and the tip shows its live value.\n\n' +
                'This works whenever At x is a number or a slider. A tangent at `min` or `max` is computed, so it cannot be dragged.',
            chart: tangentChart('dragged'),
            shot: {
                tab: 'build',
                frame: 'editor',
                reveal: ['a'],
                actions: [{ hover: [6, 2.12] }],
                caption: 'The tangent dragged to x = 6. Resting on its dot, the tip says Drag along the curve.',
            },
            tip: 'A dragged slider stays on its step and inside its range, so this tangent stops at 0 and at 10.',
        },
        {
            title: 'Label the slope',
            body:
                'Click + Add and choose Text label. In the new card, type the text and the two positions. The label prints the slope with two decimals and sits next to the point of contact.\n\n' +
                '`f1(a)` is the height of the curve at the slider value, so the label travels with the tangent.',
            type: [
                { where: 'Label 1, Text', text: 'slope {0.4 + cos(a):2}' },
                { where: 'Label 1, Position x', text: 'a - 1' },
                { where: 'Label 1, Position y', text: 'f1(a) + 0.6' },
            ],
            chart: tangentChart('label'),
            shot: { tab: 'build', frame: 'editor', reveal: ['label:0'], actions: [{ focus: ['label:0', 'text'] }], caption: 'A label that follows the tangent and prints its slope.' },
            tip: 'The slope formula is typed by hand. For another function, replace `0.4 + cos(a)` with its derivative at `a`.',
        },
    ],
    next: ['secant-tangent', 'tangent-area', 'points-labels', 'drag-to-edit'],
};

// --------------------------------------------- 6. parametric and polar

/** Ranges the editor writes when `2cos(2theta)` is the first formula of a new polar chart. */
const ROSE_FIT = { xmin: '-2.2', xmax: '2.2', ymin: '-2.195', ymax: '2.195' };

function parametricChart(stage: 'ellipse' | 'equal' | 'spiral' | 'turns'): ChartData {
    const order = ['ellipse', 'equal', 'spiral', 'turns'];
    const at = (s: string) => order.indexOf(stage) >= order.indexOf(s);
    const curve = at('spiral')
        ? { expression: '5 + 0.12t cos(t)', expressionY: '2.25 + 0.12t sin(t)' }
        : { expression: '3 + 2cos(t)', expressionY: '2 + 1.5sin(t)' };
    return chart({
        equalScale: at('equal'),
        functions: [fn('f1', curve.expression, { parametric: true, expressionY: curve.expressionY, domain: at('turns') ? '0:6pi' : '0:2*pi' })],
    });
}

function polarChart(stage: 'empty' | 'rose' | 'slider' | 'petals'): ChartData {
    if (stage === 'empty') return chart({ coordinateSystem: 'polar' });
    const parameters = stage === 'petals' ? [slider('k', 5, 1, 8, 1)] : stage === 'slider' ? [slider('k', 1)] : [];
    return chart({
        coordinateSystem: 'polar',
        ...ROSE_FIT,
        functions: [fn('f1', stage === 'rose' ? '2cos(2theta)' : '2cos(k theta)')],
        parameters,
    });
}

const PARAMETRIC_POLAR: Guide = {
    id: 'parametric-polar',
    title: 'Parametric and polar curves',
    summary: 'Draw a curve from x(t) and y(t), then switch a chart to polar and grow a rose from r(θ).',
    category: 'Functions and sliders',
    level: 'core',
    minutes: 7,
    outcomes: [
        'Add a parametric curve and set its t range',
        'Keep shapes true with Equal scale',
        'Switch a chart to polar and type r(θ)',
        'Count petals with a whole-number slider',
    ],
    requires: ['first-chart', 'sliders'],
    chart: polarChart('petals'),
    steps: [
        {
            title: 'Add a parametric curve',
            body:
                'In a new chart, click + Add and choose Parametric curve x(t), y(t). ' +
                'The card has two formula rows, `x(t) =` and `y(t) =`, and a t range. It arrives filled in with an ellipse around (3, 2).',
            chart: parametricChart('ellipse'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], caption: 'The parametric recipe: an ellipse given by x(t) and y(t).' },
            tip: 'An existing function becomes parametric in its Options: switch from y = f(x) to x(t), y(t) at the top.',
        },
        {
            title: 'Give both axes the same scale',
            body:
                'The ellipse is 4 wide and 3 high, yet it looks taller than wide, because the two axes use different units. ' +
                'Open the Chart tab and click Equal scale under Axes.\n\n' +
                'Both axes now share one unit, so the ellipse has its true shape and circles are round. The exported picture keeps that.',
            chart: parametricChart('equal'),
            shot: { tab: 'chart', frame: 'editor', caption: 'Equal scale on: the ellipse is wider than high, as its formulas say.' },
        },
        {
            title: 'Type a spiral',
            body:
                'Back in the Build tab, replace the two formulas. The radius `0.12t` grows with t while `cos(t)` and `sin(t)` go around, so the curve spirals away from (5, 2.25).\n\n' +
                'With the range the recipe came with, `0:2*pi`, it makes one turn.',
            type: [
                { where: 'f1, x(t) =', text: '5 + 0.12t cos(t)' },
                { where: 'f1, y(t) =', text: '2.25 + 0.12t sin(t)' },
            ],
            chart: parametricChart('spiral'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], caption: 'One turn of the spiral.' },
            tip: 'Keep the space in `0.12t cos(t)`. Without it, `tcos` is read as one unknown name, and the field offers `Use t*cos`.',
        },
        {
            title: 'Extend the t range',
            body:
                'Type `0:6pi` into the t range field. The spiral now makes three turns.\n\n' +
                'The t range is written like a domain, `min:max`, and accepts formulas. Left empty it runs from 0 to 2π.',
            type: [{ where: 'f1, t range', text: '0:6pi' }],
            chart: parametricChart('turns'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], actions: [{ focus: ['f1', 'domain'] }], caption: 't from 0 to 6π: three turns.' },
        },
        {
            title: 'Switch a new chart to Polar',
            body:
                'Polar curves get a chart of their own. Insert the spiral into your note (or close the editor), open the editor again and click Polar in the header. ' +
                'If the editor offers to restore the unsaved spiral, click Discard.\n\n' +
                'The Start a chart field now asks for r(θ): in a polar chart every function gives the radius for an angle.',
            chart: polarChart('empty'),
            shot: { tab: 'build', frame: 'editor', caption: 'A new chart switched to Polar. The field asks for r(θ).' },
            tip: 'In a polar chart Equal scale is always on.',
        },
        {
            title: 'Type r as a formula in theta',
            body:
                'Type the formula and press Enter. Write the angle as `theta` (or `θ`).\n\n' +
                'The curve is a rose with four petals, and the ranges are fitted around it. The θ range is empty, which means 0 to 2π.',
            type: [{ where: 'Start a chart', text: '2cos(2theta)' }],
            chart: polarChart('rose'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1'], caption: 'r = 2cos(2theta): a rose with four petals.' },
        },
        {
            title: 'Put the petal count on a slider',
            body:
                'In the formula, replace the `2` inside the cosine with `k` and click Add slider k. `k` starts at 1, and `2cos(theta)` is a plain circle.\n\n' +
                'Keep the space in `k theta`: `ktheta` would be one name.',
            type: [{ where: 'f1, r =', text: '2cos(k theta)' }],
            chart: polarChart('slider'),
            shot: { tab: 'build', frame: 'editor', reveal: ['f1', 'k'], caption: 'With k = 1 the rose is a single circle.' },
        },
        {
            title: 'Step through whole numbers',
            body:
                'Open the menu behind the three dots on the slider row and set Min to 1, Max to 8 and Step to 1. Then drag `k` to 5: five petals.\n\n' +
                'An odd `k` gives k petals, an even `k` twice as many. With a step of 0.1 the slider would also stop between whole numbers, where the rose does not close.',
            type: [
                { where: 'Sliders, k: Min', text: '1' },
                { where: 'Sliders, k: Max', text: '8' },
                { where: 'Sliders, k: Step', text: '1' },
            ],
            chart: polarChart('petals'),
            shot: { tab: 'build', frame: 'editor', reveal: ['k'], actions: [{ slider: ['k', 5] }], caption: 'k = 5 in whole steps: five petals.' },
            tip: 'Parametric and polar curves cannot be dragged in the preview yet. Change their formulas or their sliders.',
        },
    ],
    next: ['tangents-extrema', 'areas-between', 'export-latex'],
};

/**
 * Guides of this group (see the list in docs/guides/README.md), in display
 * order: "Getting started" first, then "Functions and sliders".
 */
export const BASICS_GUIDES: Guide[] = [FIRST_CHART, FORMULAS, DRAG_TO_EDIT, SLIDERS, TANGENTS_EXTREMA, PARAMETRIC_POLAR];
