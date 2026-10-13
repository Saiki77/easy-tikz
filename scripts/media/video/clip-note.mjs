/* eslint-env node */
// clip-note: a chart with a slider inside a note (the Market equilibrium
// example). The slider strip under the chart redraws it while you drag,
// the note's file is not written, and Reset puts the saved value back.

const NOTE = 'Market equilibrium';
const TEXT = [
    'Demand is p = 10 - a q, supply is p = 2 + q. Slider a sets how steeply demand falls.',
    'The shaded areas are the consumer surplus (CS) and the producer surplus (PS).',
];

export default {
    name: 'clip-note',
    title: 'A chart in a note with its slider strip',
    frame: { note: { height: 770, margin: 90 } },
    seconds: [6, 14],

    async setup(d) {
        const { obs } = d;
        const chart = { ...d.charts.surplus, displayWidth: 600 };
        await obs.writeNote(NOTE, `${TEXT[0]}\n\n${d.chartBlock(chart)}\n\n${TEXT[1]}\n`);
        await obs.openNote(NOTE, { mode: 'reading' });
        const charts = await obs.noteCharts();
        d.expect(charts.length === 1 && charts[0].drawn && charts[0].sliders.join() === 'a', `the note shows ${JSON.stringify(charts)}`);
        // Below the chart, not on it: resting on a chart shows its width and alignment controls.
        await d.park({ selector: '.etz-inline-strip', at: [0.62, 2.4] });
    },

    async run(d) {
        const { obs } = d;
        const value = () => obs.sliderValue('a', { scope: 'note' });
        const saved = await obs.readNote(NOTE);

        await d.caption('A chart in a note keeps its sliders');
        await d.hold(1.0);
        await d.slider('a', 2.2, { scope: 'note', seconds: 1.6, approach: 1.0, pause: 0.5 });
        d.poster();
        await d.caption('Dragging redraws the chart; the note is not changed');
        await d.slider('a', 0.6, { scope: 'note', seconds: 2.0, approach: 0.2, pause: 0.8 });
        d.expect(Math.abs((await value()) - 0.6) < 0.026, `slider a is at ${await value()}, expected 0.6`);
        d.expect((await obs.readNote(NOTE)) === saved, 'moving the slider changed the note file');

        await d.caption('Reset puts the saved value back');
        await d.click('.etz-inline-reset', { seconds: 0.9, pause: 1.4 });
        d.expect((await value()) === 1, `after Reset slider a is at ${await value()}, expected 1`);
    },
};
