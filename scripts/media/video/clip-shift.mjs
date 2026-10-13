/* eslint-env node */
// clip-shift: the second gesture of drag to edit. Shift-drag turns a
// straight line around its pivot (0.5x - 1 becomes x - 1) and stretches a
// curve from its pivot (sin(x) becomes 2sin(x)).

const PEAK = [Math.PI / 2, 1];

export default {
    name: 'clip-shift',
    title: 'Shift-drag: turn a line, stretch a curve',
    frame: 'editor',
    seconds: [6, 14],

    async setup(d) {
        // Two plain functions on the view of the "Areas between two curves" example.
        const chart = d.charts.areas;
        const [sine, other] = chart.functions;
        chart.functions = [
            { ...sine, expression: 'sin(x)', domain: '', showLegend: false, color: 'blue' },
            { ...other, expression: '0.5x - 1', domain: '', showLegend: false, color: 'orange' },
        ];
        chart.tools = [];
        Object.assign(chart, { xmin: '-1', xmax: '7', ymin: '-2.5', ymax: '3.5', size_x_cm: 12, size_y_cm: 11 });
        await d.obs.openEditor({ chart });
        await d.obs.blur();
        await d.park([5.6, -1.9]);
    },

    async run(d) {
        const { obs } = d;
        const formulas = async () => (await obs.chart()).functions.map((f) => f.expression);

        await d.caption('Shift-drag a line: it turns around its pivot');
        await d.hold(0.5);
        await d.rest([4, 1], { seconds: 0.9, pause: 0.5 });
        await d.dragStart([[4, 1], [4, 3]], { shift: true, seconds: 1.7, approach: 0 });
        await d.dragHold(0.9);
        // The poster: the first gesture in the middle, before any Undo bar is on screen.
        d.poster();
        await d.dragEnd({ pause: 0.9 });
        d.expect((await formulas())[1] === 'x - 1', `after the turn f2 reads "${(await formulas())[1]}"`);

        await d.caption('Shift-drag a curve: it stretches');
        await d.rest(PEAK, { seconds: 0.9, pause: 0.5 });
        await d.dragStart([PEAK, [PEAK[0], 2]], { shift: true, seconds: 1.6, approach: 0 });
        await d.dragHold(1.0);
        await d.dragEnd({ pause: 0.5 });
        d.expect((await formulas())[0] === '2sin(x)', `after the stretch f1 reads "${(await formulas())[0]}"`);
        // Off the curve, so the last picture shows the plain result.
        await d.move([5.6, -1.9], { seconds: 0.7 });
        await d.hold(1.0);
    },
};
