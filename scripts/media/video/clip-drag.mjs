/* eslint-env node */
// clip-drag: drag a constraint line of a linear program. The number in its
// condition is rewritten while the line moves; the region, its corners, the
// optimum and the objective line follow. Cmd/Ctrl+Z takes the drag back.
//
// The chart is the Linear program example with one change: the objective
// line is written as 2x + 3y = P1_val (the computed optimum value) instead
// of the slider c, so it stays on the optimum while a constraint moves.
//
// The hover tip is small text in a corner of the preview, so the clip shows
// an enlarged live copy of it in the top right (d.lens, see common.mjs): the
// same element, cloned and scaled, following the real one.

/** Condition (2), x + 3y <= 6, passes through this point. */
const GRAB = [0.6, 1.8];

export default {
    name: 'clip-drag',
    title: 'Drag a constraint line: its number follows',
    frame: 'editor',
    seconds: [6, 14],

    async setup(d) {
        const chart = d.charts.lp;
        chart.parameters = [];
        chart.xmax = '6';
        const line = chart.tools.find((t) => t.name === 'C1');
        line.equation = '2x + 3y = P1_val';
        line.label = 'z = {P1_val}';
        await d.obs.openEditor({ chart });
        await d.obs.blur();
        await d.park([4.6, 3.6]);
    },

    async run(d) {
        const { obs } = d;
        const condition = async () => (await obs.chart()).tools.find((t) => t.name === 'R1').conditions[1];

        await d.caption('Rest on a line: the tip shows what a drag changes');
        await d.lens(true);
        await d.hold(0.4);
        // The tip stays for three seconds: long enough to find it and read it.
        const tip = await d.rest(GRAB, { seconds: 0.9, pause: 3.0 });
        d.expect(/R1 \(2\): x \+ 3y <= 6/.test(tip || ''), `the hover tip says "${tip}"`);

        await d.caption('Drag it: the number in the condition follows');
        await d.dragStart([GRAB, [0.6, 2.3]], { seconds: 1.8, approach: 0 });
        await d.dragHold(1.0);
        d.poster();
        await d.dragEnd({ pause: 1.1 });
        d.expect((await condition()) === 'x + 3y <= 7.5', `after the drag the condition reads "${await condition()}"`);
        const undo = (await obs.editorState()).undo || '';
        d.expect(/Moved R1 \(2\)/.test(undo), `the undo bar says "${undo}"`);

        await d.caption('Cmd/Ctrl+Z takes the drag back');
        await d.hold(0.7);
        await d.key('z', { mod: true }, { pause: 1.5 });
        d.expect((await condition()) === 'x + 3y <= 6', `after undo the condition reads "${await condition()}"`);
    },
};
