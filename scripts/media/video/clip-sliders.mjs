/* eslint-env node */
// clip-sliders: the Tangent explorer example. Dragging slider a slides the
// tangent along x^3 - 3x while the pointer moves; play sweeps the slider on
// its own.
//
// One change to the example as it ships: the slider starts at 1.4 instead
// of 0.5, so the first sweep runs the whole way down to -1.5. The live text
// "slope at x = ..." is the chart title of the example itself: a tangent
// that sweeps the whole plot would run through any text inside it.

export default {
    name: 'clip-sliders',
    title: 'Sliders: drag one, then let it play',
    frame: 'editor',
    seconds: [6, 14],

    async setup(d) {
        const chart = d.charts.tangent;
        chart.parameters[0].value = 1.4;
        await d.obs.openEditor({ chart });
        await d.obs.blur();
        await d.park({ preview: [0.5, 0.94] });
    },

    async run(d) {
        const { obs, ui } = d;

        await d.caption('Drag a slider: the tangent follows while you move');
        await d.hold(0.7);
        // The poster: the start, where the tangent is clear of the labels "max" and "min".
        d.poster();
        // To -1.5: on the way the tangent sweeps over the maximum, and the label "max" steps aside for it.
        await d.slider('a', -1.5, { seconds: 2.6, approach: 0.9, pause: 0.8 });
        d.expect(Math.abs((await obs.sliderValue('a')) + 1.5) < 0.051, `slider a is at ${await obs.sliderValue('a')}, expected -1.5`);

        await d.caption('Press play: the slider sweeps on its own');
        const before = await obs.sliderValue('a');
        await d.click(ui.play('a'), { seconds: 0.9, pause: 0, settle: false });
        // One sweep takes 4 s for the whole range, so 3 s carry a from -1.5 to about 1.5.
        await d.realtime(3.0);
        const during = await obs.sliderValue('a');
        d.expect(during - before > 1.5, `play did not move slider a far enough (${before} to ${during})`);
        // The same button pauses; the slider settles on its step.
        await d.click(null, { pause: 0, settle: false });
        await d.hold(1.2);
    },
};
