/* eslint-env browser */
// The stage page's script: draws one frame of a film.
//
//   await window.cinema.init(film)    once: texts, fonts, sizes (returns what it measured)
//   await window.cinema.draw(t)       the picture at film second t; resolves when every image it shows
//                                     is decoded. Returns a string that is equal for two times at which
//                                     the stage looks the same
//
// What is on the stage at t is decided by stateAt() in timeline.mjs; this file only writes that state
// into the page. Paper, callout arrow and pointer are the brand kit's (../brand).
//
// The page does not move: paper, grid, margin rule, running head and cards are laid out once. The camera
// is written into the transform of the figure (#window) alone.
import { callout } from '../brand/callout.mjs';
import { paperSVG } from '../brand/paper.mjs';
import { pointer as pointerSVG } from '../brand/pointer.mjs';
import { figureOnScreen, stateAt } from './timeline.mjs';

const FACES = [
    ['400', 'normal', 'NewCM'],
    ['400', 'italic', 'NewCM'],
    ['700', 'normal', 'NewCM'],
    ['400', 'normal', 'NewCM Book'],
    ['400', 'normal', 'NewCM Math'],
    ['400', 'normal', 'NewCM Mono'],
    ['400', 'normal', 'LM Roman 17'],
    ['400', 'normal', 'LM Roman Caps'],
    ['400', 'normal', 'LM Roman Demi'],
];

const $ = (id) => document.getElementById(id);
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const f4 = (v) => (Math.round(v * 10000) / 10000).toString();
let film = null;
let L = null;
let k = 1.2; // px per design px
const el = {};
/** What was written last, so nothing is written twice. */
const shown = {};
/** Boxes of the texts, measured once. */
const boxes = { title: [], end: [], endSide: [], sections: [], captions: [], chips: [], notes: [] };
/** The section cards: { root, lead, side } per section of the film. */
const sectionEls = [];

/** A section card in the shape of the title card (stage.html), on the page. */
function makeSectionCard(index) {
    const root = document.createElement('section');
    root.className = 'card';
    root.id = `section-${index}`;
    root.innerHTML =
        '<h1 class="title abs card-title"></h1><p class="lead abs card-lead"></p>' +
        '<div class="card-side"><figure class="fig card-fig"><div class="shot"><img alt=""></div></figure><p class="caption abs card-cap"></p></div>';
    root.style.visibility = 'hidden';
    el.page.appendChild(root);
    const q = (sel) => root.querySelector(sel);
    return { root, text: q('.card-title'), lead: q('.card-lead'), side: q('.card-side'), fig: q('.card-fig'), cap: q('.card-cap') };
}

/** Put the first baseline of a positioned block on y (px of its offset parent). Returns the offset used. */
function setBaseline(node, y) {
    node.style.top = '0px';
    const probe = document.createElement('span');
    probe.style.cssText = 'display: inline-block; width: 0; height: 0;';
    node.prepend(probe);
    const base = probe.getBoundingClientRect().bottom - node.getBoundingClientRect().top;
    probe.remove();
    node.style.top = `${f2(y - base)}px`;
    return base;
}
const chipHtml = (chip) => (chip.secno ? `<span class="secno">${chip.secno}</span>` : '') + chip.text;
const boxOf = (node) => {
    const r = node.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
};
/** The box of what a node says (a block is as wide as its parent; its text is not). */
const textBox = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
};

/**
 * Lay out the figure of a card: a crop of a picture of the capture, as large as its box allows, its right
 * edge on the right margin, with its caption under it. Returns the boxes that the grid fades behind.
 *   box   { right, top, width, height } px of the page
 */
async function cardFigure(fig, cap, figure, box) {
    if (!figure) {
        fig.style.display = 'none';
        cap.style.display = 'none';
        return [];
    }
    const scale = Math.min(box.width / figure.crop.width, box.height / figure.crop.height);
    const w = Math.round(figure.crop.width * scale);
    const h = Math.round(figure.crop.height * scale);
    const x = box.right - w;
    const y = box.top + Math.round((box.height - h) / 2 / L.u) * L.u;
    Object.assign(fig.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const img = fig.querySelector('img');
    Object.assign(img.style, { width: `${f4(L.view.width * scale)}px`, left: `${f4(-figure.crop.x * scale)}px`, top: `${f4(-figure.crop.y * scale)}px` });
    img.src = figure.src;
    await img.decode();
    cap.innerHTML = figure.captionHtml;
    cap.style.left = `${x}px`;
    // The caption stands 1.5 units under the figure, on a grid line when the figure ends on one.
    setBaseline(cap, y + h + 1.5 * L.u);
    return [{ ...textBox(cap), strength: 0.42 }];
}

async function init(data) {
    film = data;
    L = film.layout;
    k = L.width / 1600;
    const root = document.documentElement.style;
    root.setProperty('--W', String(L.width));
    root.setProperty('--H', String(L.height));
    const body = document.body.style;
    body.setProperty('--u', `${L.u}px`);
    body.setProperty('--right', `${L.right}px`);
    body.setProperty('--band-ramp', `${L.bandSolid - L.bandTop}px`);
    for (const id of ['paper', 'page', 'band', 'chip', 'caption', 'note', 'overlay', 'window', 'frame', 'title', 'end', 'end-side', 'head-main', 'head-end', 'title-text', 'title-lead', 'title-fig', 'title-cap', 'end-title', 'end-rule', 'end-rows', 'end-print', 'end-fig', 'end-cap']) el[id] = $(id);

    await Promise.all(FACES.map(([weight, style, family]) => document.fonts.load(`${style} ${weight} 40px "${family}"`)));
    await document.fonts.ready;
    const missing = FACES.filter(([weight, style, family]) => !document.fonts.check(`${style} ${weight} 40px "${family}"`)).map((f) => f.join(' '));

    // ---- the page
    const heads = [
        [el['head-main'], film.head.main],
        [el['head-end'], film.head.end],
    ];
    for (const [node, [left, right]] of heads) {
        node.children[0].textContent = left;
        node.children[1].textContent = right;
    }
    el['title-text'].innerHTML = (film.title.secno ? `<span class="secno">${film.title.secno}</span>` : '') + film.title.text;
    el['title-lead'].innerHTML = film.title.leadHtml;
    setBaseline(el['title-text'], 16 * L.u);
    setBaseline(el['title-lead'], 20 * L.u);
    el['end-title'].textContent = film.end.title;
    el['end-rows'].innerHTML = film.end.rows.map(([label, html]) => `<span class="label">${label}</span><span class="value">${html}</span>`).join('');
    el['end-print'].innerHTML = film.end.printHtml;
    setBaseline(el['end-title'], 16 * L.u);
    // The rows stand on lines 20, 22, ...: their line-height is two units, the first baseline is put on line 20.
    setBaseline(el['end-rows'], 20 * L.u);
    setBaseline(el['end-print'], L.captionBaseline);
    // The rule of the end card lies on grid line 18, between the title and the rows, and is as long as the rows are wide.
    const rows = boxOf(el['end-rows']);
    Object.assign(el['end-rule'].style, { top: `${18 * L.u}px`, width: `${Math.round(rows.width)}px` });
    // The figures of the cards: right of the text (the longest row of the end card ends near grid line 40),
    // 21 units wide at most, their right edge on the margin.
    const side = { right: L.width - L.right, top: 7 * L.u, width: 21 * L.u, height: 20 * L.u };
    const titleCap = await cardFigure(el['title-fig'], el['title-cap'], film.title.figure, side);
    boxes.endSide = await cardFigure(el['end-fig'], el['end-cap'], film.end.figure, side);
    boxes.title = [el['title-text'], el['title-lead']].filter((n) => n.textContent).map((n) => ({ ...textBox(n), strength: 0.42 })).concat(titleCap);
    boxes.end = [el['end-title'], el['end-rows'], el['end-print']].map((n) => ({ ...boxOf(n), strength: 0.42 }));
    // Section cards: set like the title card, their figure in the same place.
    for (const [i, s] of (film.sections || []).entries()) {
        const card = makeSectionCard(i);
        card.text.innerHTML = (s.secno ? `<span class="secno">${s.secno}</span>` : '') + s.text;
        card.lead.innerHTML = s.leadHtml;
        setBaseline(card.text, 16 * L.u);
        setBaseline(card.lead, 20 * L.u);
        const cap = await cardFigure(card.fig, card.cap, s.figure, side);
        sectionEls.push(card);
        boxes.sections.push({ text: [card.text, card.lead].filter((n) => n.textContent).map((n) => ({ ...textBox(n), strength: 0.42 })), side: cap });
    }

    // ---- the figure: the crop of the window, at its place in the wide shot
    const fig = L.fig;
    Object.assign(el.window.style, { width: `${fig.width}px`, height: `${fig.height}px`, borderRadius: `${f2(L.radius * L.w0)}px` });
    Object.assign(el.frame.style, { width: `${f4(L.view.width * L.w0)}px`, left: `${f4(-L.crop.x * L.w0)}px`, top: `${f4(-L.crop.y * L.w0)}px` });

    // ---- over the page
    Object.assign(el.band.style, { top: `${L.bandTop}px`, height: `${L.height - L.bandTop}px` });
    el.overlay.setAttribute('width', String(L.width));
    el.overlay.setAttribute('height', String(L.height));
    el.overlay.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);

    // The chip, captions and notes: their sizes, for the fade of the grid behind them and for the place of a note.
    const problems = [];
    // One chip per part of the film (the title of its section); the one of the part that is on is shown.
    boxes.chips = (film.chips || [film.chip]).map((chip) => {
        if (!chip) return null;
        el.chip.innerHTML = chipHtml(chip);
        setBaseline(el.chip, L.chipBaseline);
        return textBox(el.chip);
    });
    el.caption.textContent = 'Hxg';
    setBaseline(el.caption, L.captionBaseline);
    boxes.captions = film.captions.map((c) => {
        el.caption.innerHTML = c.html;
        const r = textBox(el.caption);
        if (r.x + r.width > L.width - L.right) problems.push(`the caption "${c.text}" is ${Math.round(r.width)} px wide: it does not fit the frame`);
        return r;
    });
    el.caption.innerHTML = '';
    boxes.notes = film.callouts.map((c) => {
        el.note.className = `note ${c.kind}`;
        el.note.style.setProperty('--note-size', String(c.size || 1));
        el.note.innerHTML = c.html;
        Object.assign(el.note.style, { left: '0px', top: '0px' });
        const outer = el.note.getBoundingClientRect();
        // The first baseline, and the line the arrow leaves from: the last row of equations, or the middle of a note.
        const probe = document.createElement('span');
        probe.style.cssText = 'display: inline-block; width: 0; height: 0;';
        const first = el.note.querySelector('.eq-row .eq-l') || el.note;
        first.prepend(probe);
        const base = probe.getBoundingClientRect().bottom - outer.top;
        probe.remove();
        const rowsOf = el.note.querySelectorAll('.eq-row');
        let anchor = outer.height / 2 + 2 * k;
        if (rowsOf.length) {
            const lastRow = rowsOf[rowsOf.length - 1].querySelector('.eq-r').getBoundingClientRect();
            anchor = lastRow.top + lastRow.height / 2 - outer.top + 2 * k;
        }
        return { width: outer.width, height: outer.height, base, anchor };
    });
    el.note.innerHTML = '';
    el.note.style.visibility = 'hidden';
    if (missing.length) problems.push(`fonts did not load: ${missing.join(', ')}`);
    return { problems, captions: boxes.captions.map((b) => Math.round(b.width)), unit: L.u, fig: L.fig };
}

/** Write a style value only when it changed. */
function put(node, name, prop, value) {
    const key = `${name}.${prop}`;
    if (shown[key] === value) return;
    shown[key] = value;
    node.style[prop] = value;
}
function putVar(node, name, prop, value) {
    const key = `${name}.${prop}`;
    if (shown[key] === value) return;
    shown[key] = value;
    node.style.setProperty(prop, value);
}
const fade = (b, strength, pad = 0.5) => ({ x: b.x - L.u * pad, y: b.y, width: b.width + 2 * L.u * pad, height: b.height, strength: Math.round(strength * 1000) / 1000, feather: L.u * 2 });

async function draw(t) {
    const s = stateAt(film, t);
    const cam = s.cam;
    const fig = figureOnScreen(L, cam);

    // ---- the figure under the camera
    put(el.window, 'window', 'visibility', s.window.opacity > 0 ? 'visible' : 'hidden');
    put(el.window, 'window', 'opacity', String(s.window.opacity));
    put(el.window, 'window', 'transform', `translate(${f4(fig.x)}px, ${f4(fig.y + s.window.drop)}px) scale(${cam.z})`);
    putVar(el.window, 'window', '--lift', String(s.window.lift));
    if (s.frame && shown.frame !== s.frame) {
        shown.frame = s.frame;
        el.frame.src = s.frame;
        await el.frame.decode();
    }

    // ---- the page: cards and running head
    put(el.title, 'title', 'visibility', s.title.opacity > 0 ? 'visible' : 'hidden');
    put(el.title, 'title', 'opacity', String(s.title.opacity));
    put(el.title, 'title', 'transform', `translateY(${s.title.dy}px)`);
    putVar(el['title-lead'], 'lead', '--ink', String(s.title.highlight));
    put(el.end, 'end', 'visibility', s.end.opacity > 0 ? 'visible' : 'hidden');
    put(el.end, 'end', 'opacity', String(s.end.opacity));
    put(el.end, 'end', 'transform', `translateY(${s.end.dy}px)`);
    put(el['end-rule'], 'end-rule', 'transform', `scaleX(${s.end.rule})`);
    put(el['end-side'], 'end-side', 'opacity', String(s.end.figure));
    put(el['end-side'], 'end-side', 'transform', `translateY(${s.end.figureDy - s.end.dy}px)`);
    put(el['head-main'], 'head-main', 'opacity', String(s.head.main));
    put(el['head-end'], 'head-end', 'opacity', String(s.head.end));
    sectionEls.forEach((card, i) => {
        const on = s.section && s.section.index === i ? s.section : null;
        const name = `section-${i}`;
        put(card.root, name, 'visibility', on && on.opacity > 0 ? 'visible' : 'hidden');
        if (!on) return;
        put(card.root, name, 'opacity', String(on.opacity));
        put(card.root, name, 'transform', `translateY(${on.dy}px)`);
        putVar(card.lead, `${name}-lead`, '--ink', String(on.highlight));
        put(card.side, `${name}-side`, 'opacity', String(on.figure));
        put(card.side, `${name}-side`, 'transform', `translateY(${on.figureDy}px)`);
    });

    // ---- the paper: always the same page; its grid fades behind the texts that are on
    const fades = [];
    if (s.title.opacity > 0) for (const b of boxes.title) fades.push(fade({ ...b, y: b.y + s.title.dy }, 1 - s.title.opacity * (1 - b.strength)));
    if (s.end.opacity > 0) {
        for (const b of boxes.end) fades.push(fade({ ...b, y: b.y + s.end.dy }, 1 - s.end.opacity * (1 - b.strength)));
        for (const b of boxes.endSide) fades.push(fade({ ...b, y: b.y + s.end.figureDy }, 1 - s.end.opacity * s.end.figure * (1 - b.strength)));
    }
    if (s.section && s.section.opacity > 0) {
        const sb = boxes.sections[s.section.index];
        for (const b of sb.text) fades.push(fade({ ...b, y: b.y + s.section.dy }, 1 - s.section.opacity * (1 - b.strength)));
        for (const b of sb.side) fades.push(fade({ ...b, y: b.y + s.section.dy + s.section.figureDy }, 1 - s.section.opacity * s.section.figure * (1 - b.strength)));
    }
    const paper = { width: L.width, height: L.height, unit: L.u, origin: [L.marginX, 0], margin: L.marginX, line: 1, ink: Math.min(1, L.u / 36) };
    const paperKey = JSON.stringify(fades);
    if (shown.paper !== paperKey) {
        shown.paper = paperKey;
        el.paper.innerHTML = paperSVG({ ...paper, fades, id: 'paper' });
    }
    // The band is the same page once more, over the lower edge of the figure: its grid is that of the page and stands still.
    const under = [];
    const chipBox = boxes.chips[s.chipIndex] || null;
    if (s.chip > 0 && chipBox) under.push(fade(chipBox, 1 - s.chip * 0.5));
    if (chipBox && shown.chipIndex !== s.chipIndex) {
        shown.chipIndex = s.chipIndex;
        el.chip.innerHTML = chipHtml((film.chips || [film.chip])[s.chipIndex]);
    }
    if (s.caption) {
        const b = boxes.captions[s.caption.index];
        under.push(fade({ x: b.x, y: b.y - L.u * 0.25, width: b.width, height: b.height + L.u * 0.5 }, 1 - s.caption.opacity * 0.65, 1));
    }
    const bandKey = JSON.stringify(under);
    if (shown.bandPaper !== bandKey) {
        shown.bandPaper = bandKey;
        el.band.innerHTML = `<div style="position: absolute; left: 0; top: ${-L.bandTop}px">${paperSVG({ ...paper, fades: under, id: 'band' })}</div>`;
    }
    put(el.band, 'band', 'visibility', s.band > 0 ? 'visible' : 'hidden');
    put(el.band, 'band', 'opacity', String(s.band));
    put(el.chip, 'chip', 'visibility', s.chip > 0 ? 'visible' : 'hidden');
    put(el.chip, 'chip', 'opacity', String(s.chip));

    // ---- caption
    if (s.caption) {
        if (shown.caption !== s.caption.index) {
            shown.caption = s.caption.index;
            el.caption.innerHTML = film.captions[s.caption.index].html;
        }
        put(el.caption, 'caption', 'visibility', 'visible');
        put(el.caption, 'caption', 'opacity', String(s.caption.opacity));
        put(el.caption, 'caption', 'transform', `translateY(${s.caption.dy}px)`);
    } else put(el.caption, 'caption', 'visibility', 'hidden');

    // ---- callout: the note, and its arrow on the overlay
    let ink = '';
    if (s.callout) {
        const c = film.callouts[s.callout.index];
        const box = boxes.notes[s.callout.index];
        if (shown.note !== s.callout.index) {
            shown.note = s.callout.index;
            el.note.className = `note ${c.kind}`;
            el.note.style.setProperty('--note-size', String(c.size || 1));
            el.note.innerHTML = c.html;
        }
        const right = c.side !== 'left'; // the note stands right of the spot: the arrow leaves its left end
        let left;
        let top;
        if (c.place) {
            // A note of the page: its left edge and first baseline on the grid.
            left = c.place[0] * L.u - 12 * k;
            top = c.place[1] * L.u - box.base;
        } else {
            const ax = s.callout.x + c.dx;
            left = right ? ax : ax - box.width;
            top = s.callout.y + c.dy - box.anchor + 2 * k;
        }
        put(el.note, 'note', 'visibility', 'visible');
        put(el.note, 'note', 'left', `${f2(left)}px`);
        put(el.note, 'note', 'top', `${f2(top)}px`);
        put(el.note, 'note', 'opacity', String(s.callout.note));
        // The arrow leaves the note sideways at its near end and arrives with a slight curve (the house style).
        const from = [right ? left + 2 * k : left + box.width - 2 * k, top + box.anchor];
        const to = [s.callout.x, s.callout.y];
        const shape = { from, to, looseness: c.looseness || 1 };
        if (c.bend !== null && c.bend !== undefined) shape.bend = c.bend;
        else {
            const chord = (Math.atan2(-(from[1] - to[1]), from[0] - to[0]) * 180) / Math.PI;
            shape.out = c.out === null || c.out === undefined ? (right ? 180 : 0) : c.out;
            shape.in = c.in === null || c.in === undefined ? chord + (right ? 26 : -26) * (from[1] <= to[1] ? 1 : -1) : c.in;
        }
        // Over the figure the arrow lies on a white casing, as a road on a map; beside it, on the paper, it has none (it would wipe the grid).
        ink += callout({ ...shape, width: 1.75 * k, gap: c.gap * k, casing: 2.5 * k, casingColor: '#FFFFFF', casingClip: { x: fig.x, y: fig.y, width: fig.width, height: fig.height, radius: fig.radius }, progress: s.callout.progress, opacity: s.callout.opacity }).svg;
    } else put(el.note, 'note', 'visibility', 'hidden');

    // ---- pointer
    if (s.pointer) {
        const p = s.pointer;
        let svg = pointerSVG({
            x: p.x,
            y: p.y,
            scale: p.scale,
            ring: p.ring,
            ringAt: p.ringX === undefined ? null : [p.ringX, p.ringY],
            held: p.held,
            keycap: p.keycap ? p.keycap.label : '',
            keycapSide: p.keycap ? p.keycap.side : 'right',
            keycapOffset: p.keycap ? [p.keycap.offset[0] * p.scale, p.keycap.offset[1] * p.scale] : [0, 0],
            opacity: p.opacity,
        });
        if (p.keycap && p.keycap.opacity < 1) svg = svg.replace('<g class="pointer-keycap">', `<g class="pointer-keycap" opacity="${p.keycap.opacity}">`);
        ink += svg;
    }
    if (shown.ink2 !== ink) {
        shown.ink2 = ink;
        el.overlay.innerHTML = ink;
    }

    return JSON.stringify({ ...s, cam: [cam.z, cam.tx, cam.ty] });
}

window.cinema = { init, draw, get film() { return film; } };
window.cinemaReady = true;
