/* eslint-env browser, node */
// text: charts as text (4.5), about twenty-eight seconds, in one note in Live Preview.
//
//   title card "§3 Charts as text" (Figure 1: the finished chart)
//   the window is put onto the page: a note with a block in it, the cursor in the block, its chart under it
//   1. one line per object, typed in words: the feasible region fades in as soon as its first condition is
//      whole, the slider line brings its slider, the dashed objective line draws itself, the optimum pops in
//      with its coordinates
//   2. a number changes: 4 becomes 5 in x + y <= 4, the region grows and the optimum slides along the
//      constraint, its coordinates counting along (a glide)
//   3. a click on the note's first line: the cursor leaves the block, the lines give way to the chart
//   the camera pulls back, the window is taken off the page
//   end card (Figure 2: the chart after the change)
//
// Filmed on the capture's clock: the glide and the pop-ins follow the time of the animation frames, so they
// have their true speed and a picture per 1/30 s. A half-typed line keeps its object's last working version on
// screen (the problem line under the chart says what is missing), so nothing blinks out.
//
// Numbers, checked by hand and again while it films: maximise 2x + 3y over x + y <= b, x + 3y <= 6,
// x, y >= 0. For b = 4 the optimum is (3, 1) with 9; for b = 5 the corners are (0, 0), (5, 0), (4.5, 0.5)
// and (0, 2), and the optimum is (4.5, 0.5) with 10.5. The view runs to x = 5.5, so the corner (5, 0) stays
// inside, and to y = 3: the chart is 12 x 6, so a unit is about as tall as it is wide.

const NOTE = 'Production plan';
const TEXT = 'Maximise $z = 2x + 3y$ subject to $x + y \\le 4$ and $x + 3y \\le 6$.';
/** What the block holds before the film: the view, nothing drawn yet. */
const START = ['show x from 0 to 5.5 and y from 0 to 3', 'axes on the edges', 'size 12 x 6'];
/** The lines typed, in order. */
const REGION = 'shade where x + y <= 4 and x + 3y <= 6 and x >= 0 and y >= 0, numbered';
const SLIDER = 'slider c from 0 to 15, starting at 6';
const LINE = 'draw 2x + 3y = c in red, dashed';
const OPTIMUM = 'mark the maximum of 2x + 3y in the region, large, with coordinates';
/** Font size of the note while it is filmed, so the lines read in the film and in its 960 px loop. */
const FONT_PX = 24;
/** Width of the note's column: the longest line fits on one line, the chart sits in the middle. */
const COLUMN_PX = 1080;

/** The note as markdown, with these lines in its block (the empty line under them is where the cursor goes). */
const noteWith = (lines) => `${TEXT}\n\n\`\`\`easy-tikz\n${lines.join('\n')}\n\n\`\`\`\n`;
/** The empty line in the block: the note's line 0 is the text, 1 is empty, 2 the fence, then the lines. */
const cursorLine = (lines) => 3 + lines.length;

/** The rectangle of an element of the workspace, in window px. */
const rectOf = (d, selector) =>
    d.obs.call((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, selector);

/** What the chart in the note draws (the one under the block while the cursor is in it): its objects, its labels, its problem line. */
const drawn = (d) =>
    d.obs.call(() => {
        const ed = document.querySelector('.workspace-leaf.mod-active .cm-editor');
        const box = ed && (ed.querySelector('.etz-live .etz-inline') || ed.querySelector('.etz-inline'));
        if (!box) return null;
        const names = Array.from(new Set(Array.from(box.querySelectorAll('[data-etz-item]')).map((e) => e.getAttribute('data-etz-item'))));
        const texts = Array.from(box.querySelectorAll('.etz-texts text, .etz-texts foreignObject')).map((e) => (e.textContent || '').trim());
        const issuesEl = box.querySelector('.etz-inline-issues');
        const issues = issuesEl && !issuesEl.classList.contains('tikz-hidden') ? (issuesEl.textContent || '').trim() : '';
        return { live: !!box.closest('.etz-live'), charts: ed.querySelectorAll('.etz-inline').length, names, texts, issues };
    });

/** Put the cursor on a line of the note (0-based), in the editor that is filmed. */
const cursorAt = (d, line) =>
    d.obs.call((l) => {
        const editor = app.workspace.activeEditor.editor;
        editor.setCursor({ line: l, ch: 0 });
        editor.focus();
    }, line);

/** The frame of the film: the note's column, from its first line to the bottom of the chart and its sliders as they are at the end. */
let frame = null;

export default {
    name: 'text',
    title: { secno: '§3', text: 'Charts as text', lead: 'Write the chart [[in plain words]].', seconds: 2.2 },
    end: { seconds: 2.6 },
    seconds: [22, 36],

    async setup(d) {
        const { obs } = d;
        const all = [...START, REGION, SLIDER, LINE, OPTIMUM];
        // First the finished note, to measure where the chart and its sliders end up.
        await obs.writeNote(NOTE, noteWith(all));
        await obs.call(
            async (note, size, column) => {
                app.vault.setConfig('baseFontSize', size);
                if (typeof app.updateFontSize === 'function') app.updateFontSize();
                app.vault.setConfig('readableLineLength', true);
                document.body.style.setProperty('--file-line-width', `${column}px`);
                const file = app.vault.getAbstractFileByPath(`${note}.md`);
                const leaf = app.workspace.getLeaf(false);
                await leaf.openFile(file, { state: { mode: 'source', source: false } });
                app.workspace.setActiveLeaf(leaf, { focus: true });
            },
            NOTE,
            FONT_PX,
            COLUMN_PX
        );
        await cursorAt(d, cursorLine(all));
        await obs.sleep(1200);
        const root = await rectOf(d, '.workspace-split.mod-root');
        const column = await rectOf(d, '.workspace-leaf.mod-active .cm-sizer');
        const live = await rectOf(d, '.workspace-leaf.mod-active .cm-editor .etz-live');
        const first = await obs.call(() => {
            const cm = app.workspace.activeEditor.editor.cm;
            const c = cm.coordsAtPos(0);
            return c ? { y: c.top } : null;
        });
        d.expect(root && root.width > 1200, `the note's pane: ${JSON.stringify(root)}`);
        d.expect(column && live && first, `the column, the chart under the block and the first line: ${JSON.stringify({ column, live, first })}`);
        const top = first.y - 20;
        frame = { x: column.x - 28, y: top, width: column.width + 56, height: live.y + live.height + 14 - top };
        d.expect(frame.y + frame.height <= root.y + root.height, `the finished note does not fit the window: ${JSON.stringify({ frame, root })}`);
        const finished = await drawn(d);
        d.expect(finished && finished.live && finished.names.includes('P1'), `the finished chart under the block: ${JSON.stringify(finished)}`);

        // Then the note as the film begins: the view only, the cursor on the empty line in the block.
        await obs.call((text) => app.workspace.activeEditor.editor.setValue(text), noteWith(START));
        await cursorAt(d, cursorLine(START));
        await obs.sleep(1200);
        await d.figure(root);
        const start = await drawn(d);
        d.expect(start && start.live && start.charts === 1 && start.names.length === 0, `the chart under the block starts empty: ${JSON.stringify(start)}`);
        // The hand waits beside the block's short lines, inside the first framing.
        await d.park({ rect: frame, at: [0.86, 0.26] });
    },

    async run(d) {
        const { obs } = d;

        // The window is put onto the page; the push begins as it lands.
        await d.hold(0.35);
        await d.clock('film');

        // ---- 1. One line per object, in words.
        await d.beat({ id: 'region', caption: 'One line per object, in words.', focus: frame, pad: 0, move: 0.8 });
        await d.hold(0.4);
        await d.type(REGION, { cps: 21 });
        await d.hold(0.7);
        const region = await drawn(d);
        d.expect(region && region.live && region.names.includes('R1'), `after the region line: ${JSON.stringify(region)}`);

        await d.beat({ id: 'slider', caption: 'A slider is a line too.', focus: frame, pad: 0 });
        await d.key('Enter', {}, { pause: 0.15 });
        await d.type(SLIDER, { cps: 18 });
        await d.hold(0.8);
        await d.key('Enter', {}, { pause: 0.15 });
        await d.beat({ id: 'line', caption: 'Options read like words.', focus: frame, pad: 0 });
        await d.type(LINE, { cps: 16 });
        await d.hold(1.0);
        const line = await drawn(d);
        d.expect(line && line.names.includes('C1'), `after the objective line: ${JSON.stringify(line)}`);

        await d.key('Enter', {}, { pause: 0.15 });
        await d.beat({ id: 'optimum', caption: 'The optimum, computed.', focus: frame, pad: 0 });
        await d.type(OPTIMUM, { cps: 21 });
        await d.hold(1.1);
        const optimum = await drawn(d);
        d.expect(optimum && optimum.names.includes('P1') && optimum.texts.some((t) => /\(3, 1\)/.test(t)), `the optimum: ${JSON.stringify(optimum)}`);
        d.expect(!optimum.issues, `a problem line under the finished chart: "${optimum.issues}"`);
        await d.cardFigure('title', await rectOf(d, '.workspace-leaf.mod-active .etz-live .etz-inline-box'), { label: 'Figure 1.', text: 'Seven lines of text.' });

        // ---- 2. A number changes: the chart glides.
        const four = await obs.call((wanted) => {
            const cm = app.workspace.activeEditor.editor.cm;
            const doc = cm.state.doc;
            for (let n = 1; n <= doc.lines; n++) {
                const l = doc.line(n);
                const at = l.text.indexOf(wanted);
                if (at < 0) continue;
                const c = cm.coordsAtPos(l.from + at + wanted.length, -1);
                return c ? { x: c.left, y: (c.top + c.bottom) / 2 } : null;
            }
            return null;
        }, 'x + y <= 4');
        d.expect(four, 'the 4 of x + y <= 4 is on screen');
        await d.beat({ id: 'change', caption: 'Change a number. The chart glides.', focus: frame, pad: 0 });
        // Just inside the 4, so the caret lands behind it.
        await d.click({ rect: { x: four.x - 2, y: four.y, width: 0, height: 0 }, at: [0, 0] }, { seconds: 0.9, pause: 0.25, settle: false });
        await d.key('Backspace', {}, { pause: 0.2 });
        await d.type('5', { cps: 6 });
        // The hand moves off the line while the chart glides (a third of a second); the note points where the optimum lands.
        await d.move({ rect: frame, at: [0.86, 0.26] }, { seconds: 0.5 });
        const point = await rectOf(d, '.workspace-leaf.mod-active .etz-live .etz-markers [data-etz-item="P1"]');
        d.expect(point, 'the optimum is drawn');
        // The note stands above the region, the arrow comes in from the upper left: the coordinates at the upper right stay clear.
        await d.callout({ at: { rect: point, at: [0.5, 0.5] }, text: 'the optimum slides', side: 'left', dx: -60, dy: -175, in: 155, seconds: 1.6 });
        await d.hold(1.3);
        d.poster();
        const after = await drawn(d);
        d.expect(after && after.texts.some((t) => /\(4\.5, 0\.5\)/.test(t)), `after the change: ${JSON.stringify(after)}`);
        d.fact('optimum', ['(3, 1)', '(4.5, 0.5)']);

        // ---- 3. Click away: the lines give way to the chart.
        const word = await obs.call(() => {
            const c = app.workspace.activeEditor.editor.cm.coordsAtPos(4);
            return c ? { x: c.left, y: (c.top + c.bottom) / 2 } : null;
        });
        d.expect(word, 'the first word of the note is on screen');
        await d.beat({ id: 'away', caption: 'Click away, and the note shows the chart.', focus: frame, pad: 0 });
        await d.click({ rect: { x: word.x, y: word.y, width: 0, height: 0 }, at: [0, 0] }, { seconds: 0.9, pause: 0.25, settle: false });
        await d.hold(1.7);
        const away = await drawn(d);
        d.expect(away && !away.live && away.charts === 1 && away.names.includes('P1') && away.texts.some((t) => /\(4\.5, 0\.5\)/.test(t)), `the chart in the note: ${JSON.stringify(away)}`);

        // ---- Pull back; the window is taken off the page as the camera comes to rest.
        await d.beat({ id: 'back', focus: 'window', move: 0.85 });
        await d.hold(0.8);
        await d.cardFigure('end', await rectOf(d, '.workspace-leaf.mod-active .cm-editor .etz-inline-box'), { label: 'Figure 2.', text: 'After the change: $x + y <= 5$.' });
        await d.clock('real');
    },
};
