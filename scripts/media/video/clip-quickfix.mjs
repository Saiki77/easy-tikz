/* eslint-env node */
// clip-quickfix: start a chart by typing a x^2 - 3x. The name a does not
// exist, so the field offers the quick fix "Add slider a". One click adds
// the slider and the function; dragging the slider reshapes the parabola.

export default {
    name: 'clip-quickfix',
    title: 'Type a formula, add the missing slider with one click',
    frame: 'editor',
    seconds: [6, 14],

    async setup(d) {
        await d.obs.openEditor();
        await d.park({ preview: [0.3, 0.75] });
    },

    async run(d) {
        const { obs, ui } = d;

        await d.caption('Start a chart: type a formula');
        await d.hold(0.5);
        await d.click(ui.startInput, { seconds: 0.9, pause: 0.3 });
        await d.type('a x^2 - 3x', { cps: 6 });
        d.expect(await obs.waitForSelector(ui.quickfix, { timeout: 4000 }), 'the quick fix "Add slider a" did not appear');
        await d.caption('The name a is unknown: the quick fix adds a slider');
        await d.hold(1.2);
        await d.click(ui.quickfix, { seconds: 0.7, pause: 0.3 });
        // Off the formula, which now sits where the quick fix was.
        await d.move({ preview: [0.3, 0.75] }, { seconds: 0.7 });
        await d.hold(0.9);
        const chart = await obs.chart();
        d.expect(chart.functions.length === 1 && chart.functions[0].expression === 'a x^2 - 3x', 'the function was not added');
        d.expect(chart.parameters.length === 1 && chart.parameters[0].name === 'a', 'slider a was not added');

        // Between 0.5 and 1 the whole parabola stays inside the view that was fitted to a = 1.
        await d.caption('Drag slider a: the parabola follows');
        await d.slider('a', 0.5, { seconds: 1.4, approach: 0.8, pause: 0.5 });
        await d.slider('a', 0.8, { seconds: 1.2, approach: 0.2, pause: 1.1 });
        d.expect(Math.abs((await obs.sliderValue('a')) - 0.8) < 0.051, `slider a is at ${await obs.sliderValue('a')}, expected 0.8`);
        // The poster: the result, with the slider and the parabola (not the red error before the fix).
        d.poster();
    },
};
