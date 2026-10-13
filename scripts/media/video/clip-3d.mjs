/* eslint-env node */
// clip-3d: the Surface and plane example. A drag in the 3D preview turns
// the view; slider h moves the plane z = h through the paraboloid.

export default {
    name: 'clip-3d',
    title: '3D: turn the view, move a plane with a slider',
    frame: 'editor',
    seconds: [6, 14],

    async setup(d) {
        await d.obs.openEditor({ chart: d.charts.plane3d });
        await d.obs.blur();
        await d.park({ preview: [0.2, 0.85] });
    },

    async run(d) {
        const { obs } = d;
        const view = async () => {
            const chart = await obs.chart();
            return { x: chart.rotationX, z: chart.rotationZ };
        };

        await d.caption('Drag the 3D preview to turn it');
        await d.hold(0.6);
        const before = await view();
        // Out to the right and part of the way back: the label z = h stays in front of the surface.
        await d.drag([{ preview: [0.5, 0.55] }, { preview: [0.62, 0.5] }, { preview: [0.53, 0.5] }], { seconds: 2.6, approach: 0.9, pause: 0.9 });
        const after = await view();
        d.expect(after.z !== before.z, 'the drag did not turn the view');

        await d.caption('Slider h moves the plane through the surface');
        await d.slider('h', 6, { seconds: 1.5, approach: 0.9, pause: 0.6 });
        await d.slider('h', 1.5, { seconds: 1.9, approach: 0.2, pause: 1.2 });
        d.expect(Math.abs((await obs.sliderValue('h')) - 1.5) < 0.051, `slider h is at ${await obs.sliderValue('h')}, expected 1.5`);
        // The poster: the end, where the plane cuts the bowl in one clean circle.
        d.poster();
    },
};
