/* eslint-env node */
// clip-areas: two recipes of the + Add menu on sin(x) and cos(x). "Area
// between two functions" shades where f2 <= y <= f1, "Intersections of two
// functions" marks the crossings. Dragging a curve moves both.
//
// The drag goes just under half a unit to the right, where the peak of the
// curve snaps onto the grid line x = 2: sin(x) becomes sin(x - 0.45). There
// the coordinate labels of the two crossings are clear of both curves and
// of the tick labels of the x axis, and no curve runs through a tick label
// (after a whole unit the label of the second crossing sits right under the
// tick label 5; after a drag upward the curve runs through it).

/** A point of sin(x), clear of the labels of the crossings. */
const GRAB = [2.2, Math.sin(2.2)];
/** Where the drag ends. */
const DROP = [GRAB[0] + 0.45, GRAB[1]];
/** Where the pointer waits: the empty band of the preview above the chart. */
const REST = { preview: [0.8, 0.09] };

export default {
    name: 'clip-areas',
    title: 'Add an area between two curves and their crossings',
    frame: 'editor',
    seconds: [6, 14],

    async setup(d) {
        // The functions of the "Areas between two curves" example, without its regions, points and legend.
        const chart = d.charts.areas;
        chart.tools = [];
        for (const f of chart.functions) f.showLegend = false;
        Object.assign(chart, { ymin: '-1.5', ymax: '2', size_x_cm: 12, size_y_cm: 8 });
        await d.obs.openEditor({ chart });
        await d.obs.blur();
        await d.park(REST);
    },

    async run(d) {
        const { obs, ui } = d;
        const tools = async () => (await obs.chart()).tools;
        const menuOpen = () => obs.waitForSelector(ui.menu);
        const menuClosed = () => obs.waitForSelector(ui.menu, { gone: true });

        await d.caption('Add > Area between two functions');
        await d.hold(0.5);
        await d.click(ui.add, { seconds: 0.9, pause: 0.5, until: menuOpen });
        await d.click(ui.menuItem('Area between two functions'), { seconds: 0.7, pause: 0.9, until: menuClosed });
        let now = await tools();
        d.expect(now.length === 1 && now[0].conditions[0] === 'f2 <= y <= f1', `the recipe made ${JSON.stringify(now.map((t) => t.conditions || t.type))}`);

        await d.caption('Add > Intersections of two functions');
        await d.click(ui.add, { seconds: 0.7, pause: 0.5, until: menuOpen });
        await d.click(ui.menuItem('Intersections of two functions'), { seconds: 0.8, pause: 0.9, until: menuClosed });
        now = await tools();
        d.expect(now.length === 2 && now[1].source === 'intersections', 'the second recipe did not add intersections');

        // The new cards made the list scroll: wheel it back to the top, so the cards show from their headers.
        await obs.mouse.wheel({ x: obs.mouse.x, y: obs.mouse.y }, -2000);
        await obs.sleep(120);
        await d.hold(0.4);

        await d.caption('Drag a curve: the area and the crossings follow');
        await d.rest(GRAB, { seconds: 0.9, pause: 0.3 });
        await d.dragStart([GRAB, DROP], { seconds: 1.5, approach: 0 });
        await d.dragHold(0.8);
        await d.dragEnd({ pause: 0.5 });
        const f1 = (await obs.chart()).functions[0].expression;
        d.expect(f1 === 'sin(x - 0.45)', `after the drag f1 reads "${f1}"`);
        await d.move(REST, { seconds: 0.6 });
        await d.hold(0.9);
        // The poster: the settled result, every card showing the formula the drag wrote.
        d.poster();
    },
};
