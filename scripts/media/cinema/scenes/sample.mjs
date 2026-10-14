/* eslint-env browser, node */
// sample: the proof of the cinematic pipeline, about eighteen seconds.
//
//   title card "Drag to edit" (with Figure 1: the chart as it starts)
//   the editor is put onto the page, and the camera pushes in as it lands
//   1. the pointer drags the dashed objective line: slider c follows (a note in the Sliders row: c: 5 to 9)
//   2. close on the plot, the paper beside it as the margin. Shift held: the pivot ring shows on the
//      optimum (the margin note names it), the line swings about it, down and up
//   3. over to the line's card: its Equation field has followed. Equations (a) and (b) stand in the margin
//   the camera pulls back, the editor is taken off the page
//   end card (with Figure 2: the chart as it ends)
//
// The chart is the Linear program example with one change: slider c starts at 5 instead of 9, so the
// objective line lies below the optimum and the first drag brings it there (it snaps onto the optimum,
// where 2x + 3y = 9).
//
// Numbers, checked by hand and again by the scene while it films: the example maximises 2x + 3y over
// x + y <= 4, x + 3y <= 6, x, y >= 0; the optimum is (3, 1). A Shift-drag of the line turns it about
// (3, 1): through (1.5, y) it is a x + 3y = c with a = 2 (y - 1). Down to (1.5, 1.65) that is 1.3x + 3y,
// up to (1.5, 2.25) it is 2.5x + 3y = c with c = 10.5. The slope stays between those of the two
// constraints (-1 and -1/3) all the way, so the optimum stays at (3, 1).

/** A point of the line 2x + 3y = 5, inside the feasible region. */
const LOW = [1.25, 2.5 / 3];
/** Move a point of 2x + 3y = c so that the line gets the value `to` (along the line's normal). */
const onLine = ([x, y], from, to) => [x + (2 * (to - from)) / 13, y + (3 * (to - from)) / 13];
/** Where the Shift-drag takes hold of the line 2x + 3y = 9, how far down it swings, and where it lets go. */
const GRAB = [1.5, 2];
const DIP = [1.5, 1.65];
const TURNED = [1.5, 2.25];
const OPTIMUM = [3, 1];
const NOTE = 'Linear program';
const TEXT = 'Maximise $z = 2x + 3y$ subject to $x + y \\le 4$ and $x + 3y \\le 6$.';

export default {
    name: 'sample',
    title: { secno: '§1', text: 'Drag to edit', lead: 'Drag a line and [[its numbers follow]].', seconds: 1.9 },
    end: { seconds: 2.2 },
    seconds: [15, 19.5],

    async setup(d) {
        const { obs } = d;
        const chart = d.charts.lp;
        chart.parameters[0].value = 5;
        // The note the chart is made for lies behind the editor, as it would for a user.
        await obs.writeNote(NOTE, `${TEXT}\n\n${d.chartBlock({ ...d.charts.lp, displayWidth: 560 })}\n`);
        await obs.openNote(NOTE);
        await obs.openEditor({ chart });
        // "Shapes and marks" leads the Build panel (not the empty Functions group); the corners card is closed.
        await d.tidyBuild({ collapse: ['P2'], lead: 'Shapes and marks' });
        // The figure of the film is the editor: nothing of the dimmed workspace around it.
        await d.figure('editor');
        // The pointer waits above the lines, inside the frame of the first beat.
        await d.park([3.6, 2.9]);
    },

    async run(d) {
        const { obs, ui } = d;
        const state = async () => {
            const chart = await obs.chart();
            const tool = (name) => chart.tools.find((t) => t.name === name);
            return { c: chart.parameters[0].value, line: tool('C1').equation, objective: tool('P1').objective };
        };
        const pivotShown = () => obs.call(() => {
            const g = document.querySelector('.modal.tikz-modal .etz-drag-pivot');
            return !!g && g.childElementCount > 0;
        });
        /** A card of the Build panel and its n-th visible formula field: { card, input, value } in window px. */
        const field = (name, index) => obs.call((wanted, n) => {
            const M = window.__etzMedia;
            const m = M.editor();
            const card = Array.from(m.modalEl.querySelectorAll('.etz-card')).find((node) => ((node.querySelector('.etz-card-name') || {}).textContent || '').trim() === wanted);
            const input = card ? Array.from(card.querySelectorAll('input.etz-expr-input')).filter(M.visible)[n] : null;
            return input ? { card: M.rect(card), input: M.rect(input), value: input.value } : null;
        }, name, index);

        const before = await state();
        d.expect(before.c === 5 && before.line === '2x + 3y = c', `the chart starts as ${JSON.stringify(before)}`);
        const editor = d.track.figure.rect;
        const pane = await d.rect('stage');
        const plot = await d.rect('preview');

        // The editor is put onto the page; the push begins as it lands.
        await d.hold(0.35);
        await d.cardFigure('title', 'preview', { label: 'Figure 1.', text: `The Linear program example, at $c = ${before.c}$.` });

        // ---- 1. Drag the line: slider c follows.
        await d.beat({
            id: 'drag',
            caption: `Drag the line $${before.line}$. Slider $c$ follows.`,
            // The editor from edge to edge: the line's way up to the optimum, its card, and the Sliders dock.
            // The dock's lower edge lies a little under the top of the caption band, so the band takes the
            // action bar whole (half a button showing through its edge would be debris).
            focus: { columns: 'editor', rows: 'dock' },
            pad: [0, 0, 0, -12],
            align: 'bottom',
            move: 0.8,
        });
        const tip = await d.rest(LOW, { seconds: 0.9, pause: 0.25 });
        d.expect(/^C1: 2x \+ 3y = c/.test(tip || ''), `the hover tip says "${tip}"`);
        // Slowly: on its way the line clicks into the corners (0, 2) and (4, 0), and that should read as meant.
        // Of these 2.8 s the line moves for about 1.8: it holds its start value for the first pixels of the
        // hand's way and has clicked into the optimum before the hand is there.
        await d.dragStart([LOW, onLine(LOW, 5, 9)], { seconds: 2.8, approach: 0 });
        const dragged = await state();
        d.expect(dragged.c === 9, `after the drag c is ${dragged.c}, expected 9 (through the optimum)`);
        d.fact('c', [before.c, dragged.c]);
        // The note stands in the free part of the Sliders row, right of the value it is about.
        await d.callout({
            at: { selector: `${ui.editor} .etz-dock-value`, at: [1, 0.5] },
            text: `$c: ${before.c} -> ${dragged.c}$`,
            side: 'right',
            dx: 170,
            dy: 0,
            bend: -0.08,
            gap: 12,
            seconds: 1.45,
        });
        await d.dragHold(0.4);
        await d.dragEnd({ pause: 1.05 });
        d.expect((await obs.sliderValue('c')) === 9, 'slider c did not follow the line');

        // ---- 2. Shift: the line turns about the optimum.
        const top = (await obs.mathToClient(0, 3.08)).y;
        await d.beat({
            id: 'turn',
            caption: `Hold Shift. It turns about $(${OPTIMUM.join(', ')})$.`,
            // The preview pane, edge on edge: the frame's left edge lies on the divider beside the panel, the
            // band begins where the pane ends (so the row under the plot, with the editor's own tip, is whole).
            // The paper right of the editor is the margin of this shot.
            focus: { x: pane.x + 1, y: top, width: pane.width - 1, height: pane.y + pane.height - 5 - top },
            pad: [0, 12, 0, 0],
            align: 'left',
            move: 0.7,
        });
        await d.rest(GRAB, { seconds: 0.85, pause: 0.15 });
        // The keycap stands left of the pointer, a little lower: in the wedge under the line, clear of it.
        await d.keyDown('Shift', { side: 'left', offset: [-6, 9] });
        await obs.sleep(140);
        d.expect(await pivotShown(), 'Shift is held over the line, but the pivot ring does not show');
        const shiftTip = (await obs.editorState()).hint || '';
        d.expect(/turns around .*\(3, 1\)/.test(shiftTip), `with Shift the tip says "${shiftTip}"`);
        // A margin note, as on the brand's pages: it stays while the line swings about the point it names.
        await d.callout({ at: OPTIMUM, text: 'the pivot', side: 'right', place: [49, 10], in: 93, looseness: 1.05, gap: 13, seconds: null, delay: 0.05 });
        await d.hold(0.8);
        // The swing: down, then up past where it began. About 17 degrees about the ring.
        await d.dragStart([GRAB, DIP], { seconds: 0.8, approach: 0 });
        await d.dragTo(TURNED, { seconds: 1.2 });
        await d.dragHold(0.5);
        d.poster();
        d.calloutEnd();
        await d.dragEnd({ pause: 0 });
        const turned = await state();
        d.expect(turned.line === '2.5x + 3y = c' && turned.objective === '2.5x + 3y' && turned.c === 10.5, `after the turn: ${JSON.stringify(turned)}`);
        d.fact('line', [before.line, turned.line]);

        // ---- 3. The formula has followed: over to the line's card.
        const c1 = await field('C1', 0);
        d.expect(c1 && c1.value === turned.line, `the Equation field of C1 says "${c1 && c1.value}"`);
        await d.beat({
            id: 'result',
            caption: `Its formula follows: $${turned.line}$.`,
            // The panel, as close as the capture allows, its right edge on the right edge of the frame. The
            // Equation field lies level with grid line 10 of the page, where equation (b) stands in the margin
            // (its middle is 13.5 px above its baseline); the frame's upper edge then falls between two rows
            // of the card above.
            focus: { x: editor.x, y: c1.input.y + c1.input.height / 2 - 138.25, width: pane.x - 1 - editor.x, height: 300 },
            pad: 0,
            align: 'right top',
            zoom: 99,
            move: 0.9,
        });
        await d.move({ rect: c1.input, at: [0.72, 0.6] }, { seconds: 0.9 });
        await d.callout({
            at: { rect: { x: c1.card.x, y: c1.input.y, width: 0, height: c1.input.height }, at: [0, 0.5] },
            // Before and after, as numbered equations; the number that changed is set in the accent.
            equations: [[before.line, 'a'], [turned.line.replace(/^(\d+(?:\.\d+)?)/, '[[$1]]'), 'b']],
            side: 'left',
            place: [5, 7],
            bend: 0.05,
            gap: 12,
            seconds: null,
        });
        await d.hold(2.2);
        d.calloutEnd();

        // ---- Pull back; the editor is taken off the page as the camera comes to rest (no wide hold).
        await d.beat({ id: 'back', focus: 'window', move: 0.85 });
        await d.hold(0.8);
        await d.cardFigure('end', 'preview', { label: 'Figure 2.', text: `After the turn: $${turned.line}$, $c = ${turned.c}$.` });
    },
};
