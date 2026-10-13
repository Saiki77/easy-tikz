/* eslint-env browser, node */
// overview: just under a minute through the plugin on the Linear program
// example, from a new chart to a chart in the note and back into the editor.
//
// The clip starts with the editor already open on a new chart (over the note
// the chart will go into), so the first picture is the editor with its
// examples and the first chart is on screen after two seconds.
//
//   pick the example
//   drag slider c, drag the objective line (it snaps onto the optimum)
//   Shift-drag turns the line around the optimum; Undo takes it back
//   type a new limit into a condition, drag the line onto the new optimum
//   Code tab, Insert into note, the slider strip in the note, click the chart to edit again
//
// Numbers used below, checked by hand: the example maximises 2x + 3y over
// x + y <= 4, x + 3y <= 6, x, y >= 0, with the optimum (3, 1) and the value
// 9. With x + y <= 3 the optimum is (1.5, 1.5) with the value 7.5.

const NOTE = 'Production plan';
const TEXT = 'Two products share two machines. A unit of the first earns 2, a unit of the second earns 3.\n\nWhich mix earns the most?\n\n';

/** Move a point of the line 2x + 3y = c so that the line gets the value `to` (along the line's normal). */
const onLine = ([x, y], from, to) => [x + (2 * (to - from)) / 13, y + (3 * (to - from)) / 13];

export default {
    name: 'overview',
    title: 'Overview: from a new chart to an editable chart in a note',
    frame: 'window',
    seconds: [50, 70],

    async setup(d) {
        const { obs } = d;
        await obs.writeNote(NOTE, TEXT);
        await obs.openNote(NOTE, { mode: 'live' });
        // The editor as the ribbon icon opens it: a new chart, the cursor in "Start a chart".
        await obs.openEditor();
        d.expect((await obs.editorState()).banner === '', 'the editor opened with a draft banner');
        await d.park({ preview: [0.42, 0.62] });
    },

    async run(d) {
        const { obs, ui } = d;
        const state = async () => {
            const chart = await obs.chart();
            const tool = (name) => chart.tools.find((t) => t.name === name);
            return { c: chart.parameters[0].value, line: tool('C1').equation, objective: tool('P1').objective, conditions: tool('R1').conditions };
        };
        const editorOpen = () =>
            obs.waitFor(() => obs.call(() => {
                const m = window.__etzMedia.editor();
                return !!m && m.ready === true;
            }), { timeout: 8000, message: 'the editor to open' });
        const editorClosed = () => obs.waitFor(() => obs.call(() => !window.__etzMedia.editor()), { timeout: 8000, message: 'the editor to close' });

        // 1. A new chart: pick the example. The chart is on screen within two seconds.
        await d.caption('Easy TikZ 4: start from a formula or an example');
        await d.hold(0.7);
        await d.click(ui.example('Linear program'), { seconds: 0.8, pause: 1.9, until: () => obs.waitFor(async () => (await obs.chart()).tools.length === 4, { message: 'the example to load' }) });
        d.expect((await state()).c === 9, 'the Linear program example did not load');

        // 2. A slider moves the picture. c stays between 5 and 9: there the line crosses the region and
        // its label has room beside it (the label placer keeps it clear and inside the plot for any c).
        await d.caption('Drag a slider: the chart redraws while you move');
        await d.slider('c', 5.5, { seconds: 1.5, approach: 1.0, pause: 0.4 });
        await d.slider('c', 8, { seconds: 1.2, approach: 0.2, pause: 0.4 });
        await d.slider('c', 5, { seconds: 1.4, approach: 0.2, pause: 0.8 });
        d.expect(Math.abs((await state()).c - 5) < 0.11, `slider c is at ${(await state()).c}, expected 5`);

        // 3. Drag the line: slider c follows, and the line snaps onto the optimum.
        await d.caption('Or drag the line itself: it snaps onto the optimum');
        const low = [1.25, 2.5 / 3];
        await d.rest(low, { seconds: 1.0, pause: 0.6 });
        await d.dragStart([low, onLine(low, 5, 9)], { seconds: 1.6, approach: 0 });
        await d.dragHold(0.9);
        d.poster();
        await d.dragEnd({ pause: 0.8 });
        d.expect((await state()).c === 9, `after the drag c is ${(await state()).c}, expected 9 (through the optimum)`);

        // 4. Shift-drag turns it around the optimum. Past the slope of constraint (2) the optimum changes corner.
        await d.caption('Shift-drag turns the line around the optimum');
        await d.rest([1.5, 2], { seconds: 0.9, pause: 0.5 });
        await d.dragStart([[1.5, 2], [1.5, 1.75]], { shift: true, seconds: 1.1, approach: 0 });
        await d.dragHold(0.7);
        await d.caption('Past a constraint, the optimum jumps to the next corner');
        await d.dragTo([1.5, 1.25], { seconds: 1.4 });
        await d.dragHold(1.2);
        await d.dragEnd({ pause: 0.4 });
        let now = await state();
        d.expect(now.line === '0.5x + 3y = c' && now.objective === '0.5x + 3y', `after the turn the line reads "${now.line}", the objective "${now.objective}"`);
        await d.caption('Undo takes the whole drag back');
        await d.click(ui.undo, { seconds: 0.9, pause: 1.3 });
        now = await state();
        d.expect(now.line === '2x + 3y = c' && now.objective === '2x + 3y' && now.c === 9, `after Undo: ${JSON.stringify(now)}`);

        // 5. Type a new limit: double-click the 4 of "x + y <= 4" and type 3.
        await d.caption('Type a new limit: region, corners and optimum follow');
        const digit = await obs.call(() => {
            const m = window.__etzMedia.requireEditor();
            const input = Array.from(m.modalEl.querySelectorAll('.etz-build input.etz-expr-input')).find((el) => el.value === 'x + y <= 4');
            if (!input) return null;
            const style = getComputedStyle(input);
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const before = ctx.measureText(input.value.slice(0, -1)).width;
            const last = ctx.measureText(input.value.slice(-1)).width;
            const r = input.getBoundingClientRect();
            return { x: r.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) + before + last / 2, y: r.top + r.height / 2 };
        });
        d.expect(digit, 'the field of condition (1) was not found');
        await d.click(digit, { seconds: 1.1, pause: 0.6, count: 2 });
        const picked = await obs.call(() => {
            const el = document.activeElement;
            return el && typeof el.value === 'string' ? el.value.slice(el.selectionStart, el.selectionEnd) : null;
        });
        d.expect(picked === '4', `the double-click selected "${picked}", expected the 4`);
        // Off the field, so the pointer does not cover the digit that changes.
        await d.move({ x: digit.x + 46, y: digit.y + 40 }, { seconds: 0.4 });
        await d.hold(0.3);
        await d.type('3', { cps: 4 });
        await d.hold(0.3);
        await d.key('Enter', {}, { pause: 1.5 });
        now = await state();
        d.expect(now.conditions.join('; ') === 'x + y <= 3; x + 3y <= 6; x >= 0; y >= 0', `the conditions read "${now.conditions.join('; ')}"`);

        // 6. The line again: onto the new optimum (1.5, 1.5), where 2x + 3y = 7.5.
        await d.caption('Drag the line onto the new optimum: z = 7.5');
        const high = [1.2, 2.2];
        await d.rest(high, { seconds: 1.0, pause: 0.4 });
        await d.dragStart([high, onLine(high, 9, 7.5)], { seconds: 1.3, approach: 0 });
        await d.dragHold(0.8);
        await d.dragEnd({ pause: 0.9 });
        d.expect((await state()).c === 7.5, `after the drag c is ${(await state()).c}, expected 7.5`);

        // 7. The LaTeX.
        await d.caption('Code: a complete LaTeX document for pdflatex');
        await d.click(ui.tab('Code'), { seconds: 1.0, pause: 2.8 });
        const code = (await obs.codeText()) || '';
        d.expect(code.includes('\\documentclass') && code.includes('\\end{document}'), 'the Code tab does not show a standalone document');

        // 8. Into the note.
        await d.caption('Insert into note');
        await d.click(ui.insert, { seconds: 1.1, pause: 0.5, until: editorClosed });
        await obs.waitForRender({ settle: 300 });
        const charts = await obs.noteCharts();
        d.expect(charts.length === 1 && charts[0].drawn && charts[0].sliders.join() === 'c', `the note shows ${JSON.stringify(charts)}`);
        await d.caption('The chart is in the note, with its slider');
        await d.hold(3.0);

        // 9. The slider strip in the note. Up to 9 and back: the range in which the line crosses the
        // region near its optimum, so the picture changes where the reader looks.
        const noteValue = () => obs.sliderValue('c', { scope: 'note' });
        const saved = await obs.readNote(NOTE);
        await d.caption('In the note the slider stays live');
        await d.slider('c', 9, { scope: 'note', seconds: 1.5, approach: 1.1, pause: 0.5 });
        await d.slider('c', 7.5, { scope: 'note', seconds: 1.4, approach: 0.2, pause: 0.8 });
        d.expect((await noteValue()) === 7.5, `the note slider is at ${await noteValue()}, expected 7.5`);
        d.expect((await obs.readNote(NOTE)) === saved, 'moving the slider changed the note file');

        // 10. Back into the editor.
        await d.caption('Click the chart to edit it again');
        const chartPoint = await obs.call(() => {
            const box = window.__etzMedia.inlineCharts()[0].querySelector('.etz-inline-box');
            const r = box.getBoundingClientRect();
            return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.3 };
        });
        await d.click(chartPoint, { seconds: 1.1, pause: 0.4, until: editorOpen });
        const editor = await obs.editorState();
        d.expect(editor.cta === 'Save changes', `the reopened editor's button says "${editor.cta}"`);
        await d.hold(2.8);
    },
};
