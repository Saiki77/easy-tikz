/* eslint-env browser, node */
// overview: the film of Easy TikZ 4 for the README, about 35 seconds. Two ideas, nothing else.
//
//   title card "Easy TikZ 4": TikZ charts from formulas, now fully interactive (Figure 1: the Linear program)
//   §1 Drag to edit, on the Linear program example (slider c starts at 5)
//     1. the pointer drags the objective line: slider c follows (a note in the Sliders row: c: 5 to 9)
//     2. Shift held: the line turns about the optimum (3, 1) (the margin note names the pivot)
//     3. its card: the Equation field has followed (equations (a) and (b) in the margin)
//   section card "§2 Dynamics": move one number and everything built on it follows (Figure 2)
//   §2 Dynamics, on the Tangent explorer example with the area between the curve and its tangent; the
//   camera frames the plot alone (title to the -4 tick, about 1.44x), the paper beside it is the margin
//     4. the hand comes straight up onto the tangent point (only the tangent lights up on the way), then
//        drags it along the curve from a = 1 to a = -1: tangent, area and the slope in the title follow.
//        Through a = 0 the area shrinks to nothing and grows back on the other side (margin note, on until
//        the area has grown back). On the maximum the hand lets go below the point and leaves it straight
//        down; then the tangent lies flat on the maximum (margin note)
//     5. play: down to the Sliders dock (1.3x), the hand comes under the plot and along the slider's row,
//        clicks play and rests on it; it leaves under the dock onto the paper as the camera goes back up
//        to the plot, and the slider sweeps by itself up to its end (a = 1, the tangent flat on the
//        minimum). Filmed on the capture's clock, so the sweep has its true speed and a picture per 1/30 s
//     6. the Build panel: one slider and three definitions (f1, f2, R1), set as equations (1) to (3) in the
//        margin (the hand comes round the plot, not across it); then the whole editor before it leaves
//   end card (Figure 3: the chart as the definitions were shown, play running)
// Every glide of part 2 is checked picture by picture: nothing in the app may answer the hand on its way
// (no halo of a shape, no tip, no tooltip, no control) but what it goes to.
//
// Part 1 is the approved sample, tightened. Its numbers, checked by hand and again while it films: the
// example maximises 2x + 3y over x + y <= 4, x + 3y <= 6, x, y >= 0; the optimum is (3, 1). A drag of the
// line from c = 5 snaps onto the optimum, where 2x + 3y = 9. A Shift-drag turns it about (3, 1): through
// (1.5, y) it is a x + 3y = c with a = 2 (y - 1); up to (1.5, 2.25) that is 2.5x + 3y = c with c = 10.5.
//
// Part 2, checked by hand: the tangent of f1(x) = x^3 - 3x at a is t(x) = f1(a) + (3a^2 - 3)(x - a), and
// f1(x) - t(x) = (x - a)^2 (x + 2a): the tangent touches at a and crosses the curve again at -2a. For a > 0
// the curve lies above the tangent on (-2a, a), for a < 0 below it on (a, -2a); at a = 0 (the inflection
// point) the two points merge and the area vanishes, then it is on the other side. At a = 1 the tangent is
// y = -2 on the minimum (1, -2), at a = -1 it is y = 2 on the maximum (-1, 2). For |a| <= 1 the area lies
// within |x| <= 2 and |y| <= 2, inside the example's view (-3..3 by -4..4): the slider runs from -1 to 1.
// Its step is 0.01 instead of 0.05, so a drag along the curve changes the picture at almost every step of
// the hand (with 0.05 it was 40 values in 96 steps). The plugin does not compute areas: nothing says so.

import { figureOnScreen, minJerk, solveCamera, stageLayout, windowToScreen } from '../timeline.mjs';

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

const f1 = (x) => x ** 3 - 3 * x;
/** The curve from x = from to x = to, as math points: the hand drags the tangent point along it. */
const alongCurve = (from, to, n = 48) => Array.from({ length: n + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / n;
    return [x, f1(x)];
});
/**
 * Where the tangent point is during the drag, as a function of time (0..1 to a, from 1 to -1). The hand
 * starts and stops at rest (over the first and last `r` of the time), goes slowly where the area is large
 * and changes its shape, and about 3.5 times as fast through the middle, where there is almost no area to
 * see (the preview draws none for |a| < 0.15 or so): in 3.4 s, |a| < 0.4 takes 0.56 s, |a| < 0.15 0.18 s.
 * In terms of a, not of the hand's way: near a = 0 the curve is steep, and an even pace along the way
 * there was a third as fast in a (the first cut was empty for 1.2 s).
 */
function sweep({ k = 2.5, w = 0.1, r = 0.2 } = {}) {
    const n = 2000;
    const smooth = (q) => q * q * (3 - 2 * q);
    const speed = (s) => Math.min(smooth(Math.min(1, s / r)), smooth(Math.min(1, (1 - s) / r))) * (1 + k * Math.exp(-(((s - 0.5) / w) ** 2)));
    const at = [0];
    for (let i = 1; i <= n; i++) at.push(at[i - 1] + speed((i - 0.5) / n));
    const total = at[n];
    return (p) => {
        const x = Math.max(0, Math.min(1, p)) * n;
        const i = Math.min(n - 1, Math.floor(x));
        return 1 - (2 * (at[i] + (at[i + 1] - at[i]) * (x - i))) / total;
    };
}

/** The chart of part 2: the Tangent explorer example, with the tangent as a named (hidden) function and the area between. */
function tangentChart(d) {
    const chart = d.charts.tangent;
    chart.parameters[0] = { ...chart.parameters[0], value: 1, min: -1, max: 1, step: 0.01 };
    const curve = chart.functions[0];
    // The tangent written out, so a region can use it. Hidden: the built-in tangent of f1 already draws it.
    chart.functions.push({ ...d.clone(curve), name: 'f2', expression: 'f1(a) + (3a^2 - 3)(x - a)', tangent: false, tangentPoint: '', extrema: false, thickness: 'thin', color: 'black', hidden: true });
    // The area between curve and tangent: whichever is on top, from the touching point to the crossing.
    const region = d.clone(d.charts.lp.tools[0]);
    Object.assign(region, {
        id: 't0',
        name: 'R1',
        color: 'red',
        conditions: ['min(f1, f2) <= y <= max(f1, f2)', 'min(a, -2a) <= x <= max(a, -2a)'],
        conditionLabels: ['', ''],
        constraintLines: false,
        fillOpacity: 0.2,
        label: '',
    });
    chart.tools = [region];
    return chart;
}

export default {
    name: 'overview',
    title: { text: 'Easy TikZ 4', lead: 'TikZ charts from formulas, now [[fully interactive]].', seconds: 2.3 },
    // The title card names the whole film: the chip over the captions of part 1 names its section.
    chip: { secno: '§1', text: 'Drag to edit' },
    // The title card says "Easy TikZ 4": its running head does not say it again (the end card's head).
    head: { main: ['An Obsidian plugin', 'Version 4'], end: ['An Obsidian plugin', 'Version 4'] },
    end: { seconds: 3 },
    seconds: [32, 42],
    // The README loop is the heart of the film: from the complete section card "§2 Dynamics" through the
    // drag and play to the definitions that make it. Film seconds; both ends are still frames (the card
    // held complete, and the Build panel with its equations, before they and the caption begin to fade at
    // 34.67). 17.6 s; the first two and the last two frames of the GIF are the same pictures.
    loop: { from: 17.0, to: 34.6 },

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
        await d.figure('editor');
        // The pointer waits above the lines, inside the frame of the first beat.
        await d.park([3.6, 2.9]);
    },

    async run(d) {
        await partOne(d);
        await partTwo(d);
    },
};

/** §1 Drag to edit: the approved sample, tightened to about twelve seconds. */
async function partOne(d) {
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

    const before = await state();
    d.expect(before.c === 5 && before.line === '2x + 3y = c', `the chart starts as ${JSON.stringify(before)}`);
    const editor = d.track.figure.rect;
    const pane = await d.rect('stage');

    // The editor is put onto the page; the push begins as it lands.
    await d.hold(0.35);
    await d.cardFigure('title', 'preview', { label: 'Figure 1.', text: `The Linear program example, at $c = ${before.c}$.` });

    // ---- 1. Drag the line: slider c follows.
    await d.beat({
        id: 'drag',
        caption: `Drag the line $${before.line}$. Slider $c$ follows.`,
        focus: { columns: 'editor', rows: 'dock' },
        pad: [0, 0, 0, -12],
        align: 'bottom',
        move: 0.8,
    });
    const tip = await d.rest(LOW, { seconds: 0.8, pause: 0.15 });
    d.expect(/^C1: 2x \+ 3y = c/.test(tip || ''), `the hover tip says "${tip}"`);
    await d.dragStart([LOW, onLine(LOW, 5, 9)], { seconds: 2.4, approach: 0 });
    const dragged = await state();
    d.expect(dragged.c === 9, `after the drag c is ${dragged.c}, expected 9 (through the optimum)`);
    d.fact('c', [before.c, dragged.c]);
    await d.callout({
        at: { selector: `${ui.editor} .etz-dock-value`, at: [1, 0.5] },
        text: `$c: ${before.c} -> ${dragged.c}$`,
        side: 'right',
        dx: 170,
        dy: 0,
        bend: -0.08,
        gap: 12,
        seconds: 1.2,
    });
    await d.dragHold(0.3);
    await d.dragEnd({ pause: 0.55 });
    d.expect((await obs.sliderValue('c')) === 9, 'slider c did not follow the line');

    // ---- 2. Shift: the line turns about the optimum.
    const top = (await obs.mathToClient(0, 3.08)).y;
    await d.beat({
        id: 'turn',
        caption: `Hold Shift. It turns about $(${OPTIMUM.join(', ')})$.`,
        focus: { x: pane.x + 1, y: top, width: pane.width - 1, height: pane.y + pane.height - 5 - top },
        pad: [0, 12, 0, 0],
        align: 'left',
        move: 0.7,
    });
    await d.rest(GRAB, { seconds: 0.7, pause: 0.1 });
    await d.keyDown('Shift', { side: 'left', offset: [-6, 9] });
    await obs.sleep(140);
    d.expect(await pivotShown(), 'Shift is held over the line, but the pivot ring does not show');
    const shiftTip = (await obs.editorState()).hint || '';
    d.expect(/turns around .*\(3, 1\)/.test(shiftTip), `with Shift the tip says "${shiftTip}"`);
    await d.callout({ at: OPTIMUM, text: 'the pivot', side: 'right', place: [49, 10], in: 93, looseness: 1.05, gap: 13, seconds: null, delay: 0.05 });
    await d.hold(0.55);
    await d.dragStart([GRAB, DIP], { seconds: 0.7, approach: 0 });
    await d.dragTo(TURNED, { seconds: 1.0 });
    await d.dragHold(0.4);
    d.calloutEnd();
    await d.dragEnd({ pause: 0 });
    const turned = await state();
    d.expect(turned.line === '2.5x + 3y = c' && turned.objective === '2.5x + 3y' && turned.c === 10.5, `after the turn: ${JSON.stringify(turned)}`);
    d.fact('line', [before.line, turned.line]);

    // ---- 3. The formula has followed: over to the line's card.
    const c1 = await field(d, 'C1', 0);
    d.expect(c1 && c1.value === turned.line, `the Equation field of C1 says "${c1 && c1.value}"`);
    await d.beat({
        id: 'result',
        caption: `Its formula follows: $${turned.line}$.`,
        // The panel at 100 %, its right edge on the frame's; the Equation field level with grid line 10,
        // where equation (b) stands in the margin (its middle is 13.5 px above its baseline).
        focus: { x: editor.x, y: c1.input.y + c1.input.height / 2 - 138.25, width: pane.x - 1 - editor.x, height: 300 },
        pad: 0,
        align: 'right top',
        zoom: 99,
        move: 0.85,
    });
    await d.move({ rect: c1.input, at: [0.72, 0.6] }, { seconds: 0.85 });
    await d.callout({
        at: { rect: { x: c1.card.x, y: c1.input.y, width: 0, height: c1.input.height }, at: [0, 0.5] },
        equations: [[before.line, 'a'], [turned.line.replace(/^(\d+(?:\.\d+)?)/, '[[$1]]'), 'b']],
        side: 'left',
        place: [5, 7],
        bend: 0.05,
        gap: 12,
        seconds: null,
    });
    await d.hold(2.2);
    d.calloutEnd();

    // ---- Pull back; the editor is taken off the page as the camera comes to rest.
    await d.beat({ id: 'back-1', focus: 'window', move: 0.85 });
    await d.hold(0.85);
}

/** §2 Dynamics: one slider, and everything built on it moves with it. */
async function partTwo(d) {
    const { obs, ui } = d;
    await d.section({ secno: '§2', text: 'Dynamics', lead: 'Move one number and [[everything built on it follows]].', seconds: 2.6 });

    // ---- Not filmed: the next chart, loaded while the section card is up.
    await obs.loadChart(tangentChart(d));
    await obs.blur();
    await d.figure('editor'); // the same modal, the same figure
    // The pointer waits straight under the tangent point. The curve is level at the minimum, so the way up
    // touches nothing before the tangent (the 'min' label it passes does not answer the hand).
    await d.park([1, -3.2]);
    await obs.waitForRender();

    const title = () => obs.call(() => {
        const M = window.__etzMedia;
        const t = Array.from(M.requireEditor().chartSvg.querySelectorAll('text')).find((n) => /slope/.test(n.textContent));
        return t ? { text: t.textContent.trim(), rect: M.rect(t) } : null;
    });
    /** A text of the chart by its content; of two (the 3 of both axes), the one highest up. */
    const label = (text) => obs.call((wanted) => {
        const M = window.__etzMedia;
        const all = Array.from(M.requireEditor().chartSvg.querySelectorAll('text')).filter((n) => n.textContent.trim() === wanted).map((n) => M.rect(n));
        return all.sort((p, q) => p.y - q.y)[0] || null;
    }, text);
    // The value of a as the chart has it. Not the slider's range input: the browser snaps that onto the
    // step (0.01), and play moves on a finer grid (0.005), so it read -0.76 where the chart said -0.765.
    const a = async () => (await obs.chart()).parameters.find((p) => p.name === 'a').value;
    /** The shaded area as the preview draws it: its extent in x (math units), or null when nothing is shaded. */
    const area = () => obs.call(() => {
        const M = window.__etzMedia;
        const path = M.requireEditor().chartSvg.querySelector('g.etz-fills path');
        const r = path ? path.getBoundingClientRect() : null;
        if (!r || r.width < 1 || r.height < 1) return null;
        return { x0: M.clientToMath(r.left, r.top).x, x1: M.clientToMath(r.right, r.bottom).x };
    });
    /** What the film shows at each picture of a moving stretch: a, the area, and the status chip (none may show). */
    const watch = (into) => async () => into.push({ a: await a(), area: await area(), chip: await obs.statusChip() });
    /**
     * What answers the hand where it is: the halo of a shape (the height of its box: a horizontal tangent is
     * 0 high, the curve hundreds), a ring on a point, the editor's tip, Obsidian's tooltip, and a control
     * under it (a button, a field).
     */
    const hover = () => obs.call((x, y) => {
        const m = window.__etzMedia.editor();
        const path = m.modalEl.querySelector('.etz-drag-halo:not(.is-ring) path');
        const r = path ? path.getBoundingClientRect() : null;
        const el = m.modalEl.querySelector('.etz-drag-hint');
        const tooltip = document.querySelector('.tooltip');
        const under = document.elementFromPoint(x, y);
        const control = under ? under.closest('button, input, select, textarea, a') : null;
        return {
            halo: r ? Math.round(r.height) : null,
            ring: !!m.modalEl.querySelector('.etz-drag-halo.is-ring circle'),
            hint: el && !el.classList.contains('tikz-hidden') ? el.textContent.trim() : null,
            tooltip: tooltip ? tooltip.textContent : null,
            control: control ? control.getAttribute('aria-label') || String(control.className) : null,
        };
    }, obs.mouse.x, obs.mouse.y);
    const watchHover = (into) => async (t) => into.push({ t: Math.round(t * 1000) / 1000, x: Math.round(obs.mouse.x), y: Math.round(obs.mouse.y), ...(await hover()) });
    /** A glide is clean when nothing answers the hand on its way, except what `allow` lets pass. */
    const stray = (list, allow = () => false) => list.filter((s) => (s.halo !== null || s.ring || s.hint || s.tooltip || s.control) && !allow(s));
    const glides = {};
    const chart = await obs.chart();
    const fn = (name) => chart.functions.find((f) => f.name === name);
    const r1 = chart.tools.find((t) => t.name === 'R1');
    d.expect(fn('f1').expression === 'x^3 - 3x' && fn('f1').tangent && fn('f1').tangentPoint === 'a' && fn('f2').hidden === true, `the functions are ${JSON.stringify(chart.functions)}`);
    d.expect(r1 && r1.conditions.length === 2, `R1 is ${JSON.stringify(r1)}`);
    d.expect((await a()) === 1 && (await title()).text === 'slope at x = 1: 0', `the chart starts at a = ${await a()}, "${(await title()).text}"`);
    d.expect((await obs.issues()).length === 0, `the chart has problems: ${JSON.stringify(await obs.issues())}`);

    const plot = await d.rect('preview');
    const pane = await d.rect('stage');
    const dock = await d.rect('dock');
    const modal = d.track.figure.rect;
    const L = stageLayout({ view: d.track.view, figure: d.track.figure });
    // The plot alone, the shot of the drag and of play: the frame's top edge on the top edge of the plot's
    // card, its left edge on the pane's, the band beginning just under the -4 tick of the y axis (the row of
    // the editor's tip and the dock under it stay out). The paper right of the editor is the margin for notes.
    const low = await label('-4');
    const plotShot = { focus: { x: pane.x + 1, y: plot.y, width: pane.width - 1, height: low.y + low.height + 6 - plot.y }, pad: 0, align: 'left top' };
    const cam = solveCamera(L, plotShot.focus, plotShot);
    d.expect(cam.z >= 1.4 && cam.z <= L.maxZ, `the plot would be shot at ${cam.z.toFixed(2)}x`);
    // The shot of the play button: the dock's lower edge on the band, the frame's top edge in the gap between
    // the tick labels 4 and 3 of the y axis (it then crosses only the axis and the curve), at 1.3x at least.
    const four = await label('4');
    const three = await label('3');
    const gap = (four.y + four.height + three.y) / 2;
    const dockLow = dock.y + dock.height;
    const zPlay = Math.max(1.3, L.safeBottom / ((dockLow - gap) * L.w0));
    const playShot = { focus: { x: pane.x + 1, y: gap, width: pane.width - 1, height: dockLow - gap }, pad: 0, align: 'left top', zoom: zPlay };
    const playBottom = gap + L.safeBottom / (zPlay * L.w0);
    d.expect(three.y - gap >= 8 && gap - (four.y + four.height) >= 8 && Math.abs(playBottom - dockLow) <= 4, `the play shot: top ${gap.toFixed(1)} between ${four.y + four.height} and ${three.y}, bottom ${playBottom.toFixed(1)} for the dock's ${dockLow}`);

    // The window comes back with the next chart; the push begins as it lands.
    await d.hold(0.35);
    await d.cardFigure('section', 'preview', { label: 'Figure 2.', text: 'Tangent and area, at $a = 1$.' });

    // ---- 4. Drag the tangent point along the curve: tangent, area and slope follow.
    /** A point of the plot (math), on the screen of this shot. */
    const seen = async (x, y) => windowToScreen(L, cam, await obs.mathToClient(x, y));
    const shown = figureOnScreen(L, cam);
    // The notes of this shot stand in one column of the margin, 1.5 units right of the editor's edge.
    const column = Math.ceil((shown.x + shown.width + 1.5 * L.u) / L.u);
    await d.beat({ id: 'follow', caption: 'Drag the point. Tangent and area follow.', ...plotShot, move: 0.8 });
    // Straight up onto the tangent point. Nothing but the tangent may light up on the way (it does, 8 px
    // under the point: its halo is the flat line y = -2), and the rest waits for the tangent's tip.
    const approach = [];
    d.probe(watchHover(approach));
    const tip = await d.rest([1, f1(1)], { seconds: 0.8, pause: 0.45, bow: 0, tip: /^f1 tangent: a.*a is also used by f2 and R1/ });
    d.probe(null);
    d.expect(/^f1 tangent: a/.test(tip || '') && /a is also used by f2 and R1/.test(tip || ''), `the hover tip says "${tip}"`);
    const wrongIn = stray(approach, (s) => !s.ring && !s.tooltip && !s.control && (s.halo === null || s.halo <= 4) && (!s.hint || /^f1 tangent: a/.test(s.hint)));
    d.expect(wrongIn.length === 0, `on the way to the tangent point something else answered the hand: ${JSON.stringify(wrongIn[0])}`);
    d.expect(approach.some((s) => s.halo !== null), 'the tangent did not light up under the hand');
    glides.approach = { pictures: approach.length, tangentLit: approach.filter((s) => s.halo !== null).length, other: 0 };
    // The way of the hand: along the curve, so that a follows sweep() in time (see there). The ease maps the
    // time onto the hand's way, measured on the screen.
    const DRAG = 3.4;
    const way = alongCurve(1, -1, 96);
    const pts = [];
    for (const [x, y] of way) pts.push(await obs.mathToClient(x, y));
    const run = [0];
    for (let i = 1; i < pts.length; i++) run.push(run[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const along = (x) => {
        const u = ((1 - x) / 2) * (pts.length - 1);
        const i = Math.max(0, Math.min(pts.length - 2, Math.floor(u)));
        return run[i] + (run[i + 1] - run[i]) * (u - i);
    };
    const aAt = sweep();
    const ease = (p) => along(aAt(p)) / run[run.length - 1];
    const when = (value) => {
        let i = 0;
        while (i < 1000 && aAt(i / 1000) > value) i++;
        return (i / 1000) * DRAG;
    };
    // The flip: at a = 0 the touching point and the crossing meet and the area is gone; then it grows on
    // the other side. The note comes as the area shrinks (a = 0.75: its arrow is drawn by a = 0.5) and
    // stays until the area has grown back over the minimum (a = -0.93). Its arrow points at the
    // inflection point, where a = 0.
    const flipOn = when(0.75);
    const flipOff = when(-0.93);
    const origin = await seen(0, 0);
    await d.callout({ at: [0, 0], text: 'at $a = 0$ the area flips', side: 'right', place: [column, Math.round((origin.y - 175) / L.u)], in: 40, looseness: [1.1, 0.8], gap: 14, seconds: flipOff - flipOn, delay: 1 / 30 + flipOn });
    const passed = [];
    d.probe(watch(passed));
    await d.dragStart(way, { seconds: DRAG, approach: 0, ease });
    d.probe(null);
    d.expect((await a()) === -1, `after the drag a is ${await a()}, expected -1`);
    // The flip, picture by picture: for a > 0 the area lies between -2a and a, for a < 0 between a and -2a
    // (a few px of antialiasing aside); near a = 0 nothing is shaded; no status chip at any time.
    const near = 0.08;
    const before0 = passed.filter((s) => s.a >= 0.3);
    const after0 = passed.filter((s) => s.a <= -0.3);
    const gone = passed.filter((s) => !s.area);
    d.expect(before0.length > 10 && before0.every((s) => s.area && s.area.x0 > -2 * s.a - near && s.area.x1 < s.a + near), `before a = 0 the area is not left of a: ${JSON.stringify(before0.filter((s) => !s.area || s.area.x1 >= s.a + near).slice(0, 3))}`);
    d.expect(after0.length > 10 && after0.every((s) => s.area && s.area.x0 > s.a - near && s.area.x1 < -2 * s.a + near), `after a = 0 the area is not right of a: ${JSON.stringify(after0.filter((s) => !s.area || s.area.x0 <= s.a - near).slice(0, 3))}`);
    d.expect(gone.length > 0 && gone.every((s) => Math.abs(s.a) < 0.3) && gone.some((s) => Math.abs(s.a) <= 0.05), `the area does not vanish at a = 0: ${JSON.stringify(gone.map((s) => s.a))}`);
    d.expect(passed.every((s) => !s.chip), `a status chip showed during the drag: ${(passed.find((s) => s.chip) || {}).chip}`);
    d.fact('flip', { pictures: passed.length, vanished: [Math.min(...gone.map((s) => s.a)), Math.max(...gone.map((s) => s.a))], gonePictures: gone.length, note: [Number(flipOn.toFixed(2)), Number(flipOff.toFixed(2))] });
    // At a = -1 the hand holds a moment on the maximum (the title says slope 0), then lets go and leaves it
    // straight down: the curve is level there. It lets go 22 px under the point (a stays -1: the slider
    // ends there): released on the point, the editor would hover the curve and show its tip. Then it rests
    // on free ground under the maximum, off the 'max' label, before the note comes.
    await d.dragHold(0.3);
    const flat = await title();
    d.expect(flat.text === 'slope at x = -1: 0', `at a = -1 the title says "${flat.text}"`);
    const top = await obs.mathToClient(-1, 2);
    const below = await obs.mathToClient(-1, 1);
    const STEPS = Math.round(0.7 * 30);
    const leave = [];
    let letGo = null;
    d.probe(async (t) => {
        if (letGo !== null) await watchHover(leave)(t);
    });
    for (let i = 1; i <= STEPS; i++) {
        const y = top.y + (below.y - top.y) * minJerk(i / STEPS);
        await obs.mouse.move({ x: top.x, y });
        if (letGo === null && y - top.y >= 22) {
            await obs.mouse.up();
            letGo = Math.round((y - top.y) * 10) / 10;
            d.expect((await a()) === -1, `letting go under the maximum moved a to ${await a()}`);
        }
        await d.frame();
    }
    d.probe(null);
    await obs.waitForRender();
    const wrongOut = stray(leave);
    d.expect(letGo !== null && wrongOut.length === 0, `leaving the maximum, something answered the hand: ${JSON.stringify(wrongOut[0])}`);
    glides.leaveMaximum = { pictures: leave.length, letGoPx: letGo, other: 0 };
    d.expect((await a()) === -1 && (await title()).text === 'slope at x = -1: 0', `after letting go: a = ${await a()}, "${(await title()).text}"`);
    d.expect(!!(await label('max')), 'the maximum is not marked');
    d.fact('a', [1, -1]);
    d.fact('title', ['slope at x = 1: 0', flat.text]);
    // The tangent lies flat on the maximum (-1, 2). The arrow comes down onto the flat line from above,
    // right of the y axis, where nothing else is: the note stands a row higher than the end of the curve,
    // so the arrow clears it (a row lower, it grazed the curve's end).
    const exit = await seen(Math.cbrt(2 + Math.sqrt(3)) + Math.cbrt(2 - Math.sqrt(3)), 4); // where the curve leaves the plot (x^3 - 3x = 4)
    await d.callout({ at: [1.25, 2], text: 'flat on the maximum', side: 'right', place: [column, Math.floor((exit.y - 40) / L.u)], in: 90, looseness: [0.9, 0.9], gap: 12, seconds: null, delay: 0.05 });
    await d.hold(2.0);
    d.poster();
    d.calloutEnd();

    // ---- 5. Play: the slider sweeps by itself, on the capture's clock.
    // Down to the dock (1.3x, see playShot): the hand leaves the maximum's column straight down, passes under
    // the plot and comes along the slider's row to the play button. It clicks, rests on it while the icon
    // turns to pause, and leaves under the dock's last buttons onto the paper right of the editor; the
    // camera sets off a moment later (so the hand never dips under the band), back up to the plot alone.
    await d.beat({ id: 'play', caption: 'Press play. The picture moves by itself.', ...playShot, move: 0.75 });
    const play = await d.point(ui.play('a'));
    const toPlay = [];
    d.probe(watchHover(toPlay));
    await d.move(ui.play('a'), { seconds: 1.1, via: [{ x: below.x, y: play.y }] });
    d.probe(null);
    const wrongToPlay = stray(toPlay, (s) => s.control === 'Play a' && s.halo === null && !s.ring && !s.hint && !s.tooltip);
    d.expect(wrongToPlay.length === 0, `on the way to play something answered the hand: ${JSON.stringify(wrongToPlay[0])}`);
    glides.toPlay = { pictures: toPlay.length, onPlay: toPlay.filter((s) => s.control === 'Play a').length, other: 0 };
    await d.clock('film');
    const before = await a();
    const clicking = [];
    d.probe(watchHover(clicking));
    await d.click(null, { pause: 0.3, settle: false });
    d.probe(null);
    d.expect(clicking.every((s) => !s.tooltip && !s.hint && s.halo === null), `while the hand is on play: ${JSON.stringify(clicking.find((s) => s.tooltip || s.hint || s.halo !== null))}`);
    const restAt = { x: modal.x + modal.width + 56, y: plot.y + 150 };
    await d.beat({ id: 'sweep', ...plotShot, move: 0.75, lead: -0.3 });
    const fromPlay = [];
    d.probe(watchHover(fromPlay));
    await d.move(restAt, { seconds: 0.9, via: [{ x: play.x + 2, y: dockLow - 3 }, { x: modal.x + modal.width + 21, y: dockLow - 3 }] });
    d.probe(null);
    const wrongFromPlay = stray(fromPlay, (s) => s.halo === null && !s.ring && !s.hint && !s.tooltip && (/^(Play|Pause) a$/.test(s.control) || /slider/.test(s.control)));
    d.expect(wrongFromPlay.length === 0, `on the way from play to the paper something answered the hand: ${JSON.stringify(wrongFromPlay[0])}`);
    glides.fromPlay = { pictures: fromPlay.length, controls: [...new Set(fromPlay.map((s) => s.control).filter(Boolean))], other: 0 };
    const moving = await a();
    d.expect(moving > before + 0.1, `play did not move slider a (${before} to ${moving})`);
    // In view up to the end of the sweep: the area grows over the minimum and the tangent lies flat on it.
    // Held a tick at a time until play has turned at the end of the slider.
    const played = [];
    d.probe(watch(played));
    let peak = moving;
    for (let i = 0; i < 150; i++) {
        await d.hold(1 / 30);
        const v = await a();
        if (v < peak - 1e-9) break;
        peak = v;
    }
    d.probe(null);
    // In view, every picture is a step of play: a moves by one tick of the sweep (2 in 4 s) each time, and
    // turns at most once, at the end of the slider (1).
    const steps = played.slice(1).map((s, i) => Math.round((s.a - played[i].a) * 1000) / 1000);
    const moved = steps.filter((s) => s !== 0);
    const turns = moved.slice(1).filter((s, i) => Math.sign(s) !== Math.sign(moved[i])).length;
    d.expect(steps.every((s) => Math.abs(s) < 0.03) && steps.length - moved.length <= 1 && turns <= 1, `play does not move a by one tick per picture: ${JSON.stringify(steps)}`);
    const highest = Math.max(...played.map((s) => s.a));
    d.expect(highest >= 0.97, `play is not filmed up to the end of the slider: a reaches ${highest}`);
    d.expect(played.every((s) => !s.chip), `a status chip showed during play: ${(played.find((s) => s.chip) || {}).chip}`);
    const emptyInPlay = played.filter((s) => !s.area).map((s) => s.a);
    d.fact('playInView', { pictures: played.length, a: [played[0].a, highest, played[played.length - 1].a], step: [Math.min(...moved.map(Math.abs)), Math.max(...moved.map(Math.abs))], noArea: emptyInPlay.length ? [Math.min(...emptyInPlay), Math.max(...emptyInPlay), emptyInPlay.length] : null });

    // ---- 6. The definitions: f1, f2 and R1, as equations (1) to (3) in the margin.
    const editor = d.track.figure.rect;
    const cards = await obs.call(() => {
        const M = window.__etzMedia;
        const m = M.editor();
        return Array.from(m.modalEl.querySelectorAll('.etz-card')).map((card) => ({
            name: ((card.querySelector('.etz-card-name') || {}).textContent || '').trim(),
            card: M.rect(card),
            inputs: Array.from(card.querySelectorAll('input.etz-expr-input')).filter(M.visible).map((i) => ({ value: i.value, r: M.rect(i) })),
        }));
    });
    const card = (name) => cards.find((c) => c.name === name);
    const f1Field = card('f1').inputs[0];
    const f2Field = card('f2').inputs[0];
    // R1's condition rows (its card also has a label slot per row and the Label field).
    const rows = r1.conditions.map((text) => card('R1').inputs.find((i) => i.value === text));
    d.expect(f1Field.value === 'x^3 - 3x' && f2Field.value === 'f1(a) + (3a^2 - 3)(x - a)' && rows.every(Boolean) && rows[0].r.y < rows[1].r.y, `the fields say ${JSON.stringify(cards.map((c) => c.inputs.map((i) => i.value)))}`);
    // The frame: its upper edge just under the + Add button (over the Functions heading), its lower edge
    // between the Outline row of R1 and its Label field, where the band begins; the panel's right edge on
    // the frame's. The equations need about 830 px of the paper beside it, which this zoom leaves.
    // The zoom is then set so that the middle of R1's second condition lies level with equation (3), on
    // grid line LAST (the middle of an equation at 0.85 of the size is 11.5 px above its baseline).
    const add = await d.rect(ui.add);
    const labelField = card('R1').inputs.filter((i) => i.value === '' && i.r.width > 300).pop();
    d.expect(!!labelField && labelField.r.y > rows[1].r.y, 'R1 has no Label field under its conditions');
    const SIZE = 0.85;
    const frameTop = add.y + add.height + 3;
    const rowMid = rows[1].r.y + rows[1].r.height / 2;
    const rough = L.safeBottom / ((labelField.r.y - 5 - frameTop) * L.w0);
    const LAST = Math.round(((rowMid - frameTop) * rough * L.w0 + 13.5 * SIZE) / L.u);
    const z = (LAST * L.u - 13.5 * SIZE) / ((rowMid - frameTop) * L.w0);
    const frameBottom = frameTop + L.safeBottom / (z * L.w0);
    d.expect(z >= 1.3 && z <= L.maxZ && frameBottom < labelField.r.y && frameBottom > labelField.r.y - 12, `the shot of the definitions would be at ${z.toFixed(2)}x, down to ${frameBottom.toFixed(1)} (the Label field begins at ${labelField.r.y})`);
    // The hand's way there may not cross the plot, where the playing tangent, the curve and the area would
    // answer it: along a lane over the plot (between the chart's title and the label of the y axis, above
    // y = 4, where nothing is drawn), into the panel, down its gutter right of the cards, and into f2's field.
    const heading = (await title()).rect;
    const yLabel = await label('y');
    const lane = (heading.y + heading.height + yLabel.y) / 2;
    d.expect(lane - (heading.y + heading.height) >= 8 && yLabel.y - lane >= 8, `no lane between the title (${heading.y + heading.height}) and the y label (${yLabel.y})`);
    const cardsRight = Math.max(...cards.map((c) => c.card.x + c.card.width));
    const gutter = (cardsRight + pane.x) / 2;
    d.expect(pane.x - cardsRight >= 10, `no gutter between the cards (${cardsRight}) and the stage (${pane.x})`);
    const toF2 = { x: f2Field.r.x + f2Field.r.width - 16, y: f2Field.r.y + f2Field.r.height * 0.55 };
    await d.beat({
        id: 'defs',
        // One slider (a) and three definitions; f1's card shows its options in the frame (Tangent at a, Extrema).
        caption: 'One slider, three definitions. The rest follows.',
        focus: { x: editor.x, y: frameTop, width: pane.x - 1 - editor.x, height: 200 },
        pad: 0,
        align: 'right top',
        zoom: z,
        move: 0.8,
        // The hand sets off first: it is over the plot, on the lane, while the camera still shows it, and
        // down the gutter before the frame's top edge has come down to the lane (it hugged that edge when
        // both set off together).
        lead: -0.25,
    });
    // The equations come as the camera arrives, while the hand is still on its way.
    await d.callout({
        at: { rect: { x: rows[1].r.x, y: rows[1].r.y, width: 0, height: rows[1].r.height }, at: [0, 0.5] },
        equations: [
            [`f1(x) = ${f1Field.value}`, '1'],
            [`f2(x) = ${f2Field.value}`, '2'],
            [rows[0].value, ''],
            [rows[1].value, '3'],
        ],
        side: 'left',
        place: [5, LAST - 9],
        bend: 0.05,
        gap: 12,
        seconds: null,
        size: SIZE,
        delay: 1.05,
    });
    const toDefs = [];
    d.probe(watchHover(toDefs));
    await d.move(toF2, { seconds: 1.0, via: [{ x: restAt.x - 40, y: lane }, { x: pane.x + 8, y: lane }, { x: gutter, y: lane + 28 }, { x: gutter, y: toF2.y }] });
    d.probe(null);
    const wrongToDefs = stray(toDefs, (s) => s.halo === null && !s.ring && !s.hint && !s.tooltip && /etz-expr-input/.test(s.control || ''));
    d.expect(wrongToDefs.length === 0, `on the way to the definitions something answered the hand: ${JSON.stringify(wrongToDefs[0])}`);
    glides.toDefs = { pictures: toDefs.length, inField: toDefs.filter((s) => s.control).length, other: 0 };
    d.fact('glides', glides);
    await d.hold(2.8);
    // Figure 3 is the picture the definitions are shown with, at a value its caption can print as the app
    // shows it (play moves on a grid of 0.005: a number such as -0.765 would not fit the line). A tick more
    // at a time, a few at most.
    const plain = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
    for (let i = 0; i < 12 && !plain(await a()); i++) await d.hold(1 / 30);
    const last = await a();
    d.expect(Math.abs(last) >= 0.6 && plain(last), `Figure 3 would show a = ${last}, where the area is small or the value long`);
    // Its caption prints what its picture shows: the value in the chart's title.
    const ending = await title();
    const shownA = Number((/^slope at x = (-?[\d.]+):/.exec(ending.text) || [])[1]);
    d.expect(shownA === last, `the picture's title says "${ending.text}", but a is ${last}`);
    d.fact('play', [before, moving, highest, last]);
    await d.cardFigure('end', 'preview', { label: 'Figure 3.', text: `Tangent and area, at $a = ${last}$.` });
    d.calloutEnd();

    // ---- Pull back: the whole editor, definitions and the playing chart together for a second, then it
    // leaves the page.
    await d.beat({ id: 'back-2', focus: 'window', move: 0.85 });
    await d.hold(0.85 + 1.0); // the pull back, then a second at rest before the window leaves
}

/** A card of the Build panel and its n-th visible formula field: { card, input, value } in window px. */
function field(d, name, index) {
    return d.obs.call((wanted, n) => {
        const M = window.__etzMedia;
        const m = M.editor();
        const card = Array.from(m.modalEl.querySelectorAll('.etz-card')).find((node) => ((node.querySelector('.etz-card-name') || {}).textContent || '').trim() === wanted);
        const input = card ? Array.from(card.querySelectorAll('input.etz-expr-input')).filter(M.visible)[n] : null;
        return input ? { card: M.rect(card), input: M.rect(input), value: input.value } : null;
    }, name, index);
}
