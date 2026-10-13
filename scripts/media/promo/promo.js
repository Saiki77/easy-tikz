/* eslint-env browser */
// Shared by every promo template. Places crops of the real captures
// (shots/*.png, described by shots/meta.js) into the frames of a page,
// fills in values read from the app, draws the pointer where it was during
// a capture, and reports layout problems to the build (window.promoReport).
//
//   <div class="shot" data-shot="lp-turn" data-rect="preview" data-pad="12" data-pointer="34"></div>
//
//   data-shot      name of a capture (see promo/capture.mjs)
//   data-rect      a rectangle recorded with it ('editor', 'stage', 'preview', 'dock', ...), 'window',
//                  or 'x,y,width,height' in CSS px of the captured window
//   data-pad       CSS px of the captured window added around the rectangle: 'all', 'x,y' or
//                  'left,top,right,bottom'; negative values cut into it
//   data-fit       'width' (default): the frame keeps its CSS width and gets the height of the crop;
//                  'height': the other way round; 'cover' / 'contain': the frame keeps both
//   data-anchor    for 'cover': which part stays visible, 'fx,fy' from 0 to 1 (default '0.5,0.5')
//   data-pointer   draw the pointer of that capture, this many px tall
//
// Elements with data-text="versions.plugin" or data-value="surplus-2.a" get their text from the metadata.
(() => {
    'use strict';
    const problems = [];
    const report = (text) => {
        problems.push(text);
        console.error(text);
    };
    const params = new URLSearchParams(window.location.search);
    const body = document.body;
    const W = Number(params.get('w')) || Number(body.dataset.width) || 1600;
    const H = Number(params.get('h')) || Number(body.dataset.height) || 1000;
    body.style.width = `${W}px`;
    body.style.height = `${H}px`;
    document.documentElement.style.setProperty('--W', String(W));
    document.documentElement.style.setProperty('--H', String(H));
    body.dataset.size = `${W}x${H}`;

    const meta = window.SHOTS;
    const placed = new Map();

    function numbers(text, count) {
        const parts = String(text).split(',').map((s) => Number(s.trim()));
        return parts.length === count && parts.every(Number.isFinite) ? parts : null;
    }

    function rectOf(shot, spec) {
        if (!spec || spec === 'window') return { x: 0, y: 0, width: shot.width, height: shot.height };
        if (shot.rects[spec]) return { ...shot.rects[spec] };
        const n = numbers(spec, 4);
        return n ? { x: n[0], y: n[1], width: n[2], height: n[3] } : null;
    }

    function padded(rect, spec) {
        if (!spec) return rect;
        const one = numbers(spec, 1);
        const two = numbers(spec, 2);
        const four = numbers(spec, 4);
        const [l, t, r, b] = four || (two ? [two[0], two[1], two[0], two[1]] : one ? [one[0], one[0], one[0], one[0]] : [0, 0, 0, 0]);
        return { x: rect.x - l, y: rect.y - t, width: rect.width + l + r, height: rect.height + t + b };
    }

    function pointerSvg(size) {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'pointer');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        const arrow = document.createElementNS(NS, 'path');
        // The arrow of scripts/media/lib/record.mjs (the videos), tip at (0, 0).
        arrow.setAttribute('d', 'M0.6 0.6 L0.6 17.4 L5.1 13.3 L8.2 20.4 L11 19.2 L7.9 12.2 L14 12.2 Z');
        arrow.setAttribute('fill', '#111111');
        arrow.setAttribute('stroke', '#ffffff');
        arrow.setAttribute('stroke-width', '1.3');
        arrow.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(arrow);
        return svg;
    }

    function place(el) {
        const name = el.dataset.shot;
        const shot = meta.shots[name];
        if (!shot) return report(`unknown capture "${name}"`);
        const base = rectOf(shot, el.dataset.rect);
        if (!base) return report(`capture "${name}" has no rectangle "${el.dataset.rect}"`);
        const r = padded(base, el.dataset.pad);
        const fit = el.dataset.fit || 'width';
        let w = el.clientWidth;
        let h = el.clientHeight;
        let s;
        let ox = 0;
        let oy = 0;
        if (fit === 'width') {
            s = w / r.width;
            h = r.height * s;
            el.style.height = `${h}px`;
        } else if (fit === 'height') {
            s = h / r.height;
            w = r.width * s;
            el.style.width = `${w}px`;
        } else {
            const anchor = numbers(el.dataset.anchor || '0.5,0.5', 2) || [0.5, 0.5];
            s = fit === 'cover' ? Math.max(w / r.width, h / r.height) : Math.min(w / r.width, h / r.height);
            ox = (w - r.width * s) * anchor[0];
            oy = (h - r.height * s) * anchor[1];
        }
        const img = document.createElement('img');
        img.src = `shots/${shot.file}`;
        img.alt = '';
        img.style.width = `${shot.width * s}px`;
        img.style.height = `${shot.height * s}px`;
        img.style.left = `${ox - r.x * s}px`;
        img.style.top = `${oy - r.y * s}px`;
        el.appendChild(img);
        if (el.dataset.pointer !== undefined) {
            if (!shot.pointer) report(`capture "${name}" recorded no pointer`);
            else {
                const svg = pointerSvg(Number(el.dataset.pointer) || 30);
                svg.style.left = `${ox + (shot.pointer.x - r.x) * s}px`;
                svg.style.top = `${oy + (shot.pointer.y - r.y) * s}px`;
                el.appendChild(svg);
            }
        }
        placed.set(el, { shot, r, s, ox, oy });
    }

    /** Where a recorded rectangle of a placed capture sits on the page: { x, y, width, height } in page px. */
    function locate(el, rectName) {
        const p = placed.get(el);
        if (!p) return null;
        const rect = rectOf(p.shot, rectName);
        if (!rect) return null;
        const box = el.getBoundingClientRect();
        return { x: box.left + el.clientLeft + p.ox + (rect.x - p.r.x) * p.s, y: box.top + el.clientTop + p.oy + (rect.y - p.r.y) * p.s, width: rect.width * p.s, height: rect.height * p.s };
    }

    function lookup(pathText, root) {
        return pathText.split('.').reduce((value, key) => (value === null || value === undefined ? value : value[key]), root);
    }

    /** Text that leaves the canvas, is cut off by its own box or lies under a capture; frames outside the canvas. */
    function layoutProblems() {
        const out = [];
        const tolerance = 1;
        const frames = Array.from(body.querySelectorAll('.shot, .frame')).map((el) => ({ el, box: el.getBoundingClientRect() }));
        for (const el of body.querySelectorAll('*')) {
            if (el.closest('.shot') || el.closest('svg') || el.closest('[data-unchecked]')) continue;
            const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!own) continue;
            const label = `"${el.textContent.trim().slice(0, 40)}"`;
            const range = document.createRange();
            range.selectNodeContents(el);
            let outside = false;
            let covered = false;
            for (const b of range.getClientRects()) {
                if (b.width === 0 || b.height === 0) continue;
                if (b.left < -tolerance || b.top < -tolerance || b.right > W + tolerance || b.bottom > H + tolerance) outside = true;
                if (frames.some((f) => b.left < f.box.right - tolerance && b.right > f.box.left + tolerance && b.top < f.box.bottom - tolerance && b.bottom > f.box.top + tolerance)) covered = true;
            }
            if (outside) out.push(`text ${label} leaves the canvas`);
            if (covered) out.push(`text ${label} and a capture overlap`);
            if (el.scrollWidth > el.clientWidth + tolerance && getComputedStyle(el).overflowX !== 'visible') out.push(`text ${label} is cut off`);
        }
        for (const el of body.querySelectorAll('.shot, .frame')) {
            if (el.dataset.bleed !== undefined) continue;
            const b = el.getBoundingClientRect();
            if (b.left < -tolerance || b.top < -tolerance || b.right > W + tolerance || b.bottom > H + tolerance) out.push(`a frame (${el.dataset.shot || el.className}) leaves the canvas`);
        }
        return out;
    }

    /**
     * The frame every feature card shares: brand strip, card number, two
     * hairlines and the footer. <body class="card" data-index="3" data-note="...">.
     */
    function cardChrome() {
        const CARDS = 7;
        const two = (n) => String(n).padStart(2, '0');
        const add = (html) => body.insertAdjacentHTML('beforeend', html);
        const version = meta && meta.versions ? meta.versions.plugin : '';
        const note = body.dataset.note || `Real screenshots of Easy TikZ ${version}`;
        add(
            '<header class="brand">' +
                '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#0f172a"/>' +
                '<g stroke="#ffffff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M9 28 L31 28"/><path d="M9 28 L9 10"/><path d="M11 24 Q20 -2 29 24"/></g></svg>' +
                '<span class="name">Easy TikZ <span class="accent">4</span></span>' +
                '</header>'
        );
        add(`<div class="crumb is-top">${two(Number(body.dataset.index) || 1)} / ${two(CARDS)}</div>`);
        add('<div class="rule is-top"></div><div class="rule is-bottom"></div>');
        add('<div class="crumb is-left is-url">github.com/Saiki77/easy-tikz</div>');
        const right = document.createElement('div');
        right.className = 'crumb is-right';
        right.textContent = note;
        body.appendChild(right);
    }

    window.promo = { W, H, meta, locate };
    window.promoReport = () => problems.concat(layoutProblems());

    if (!meta || !meta.shots) {
        report('shots/meta.js is missing: run "node scripts/media/build-promo.mjs" once');
        return;
    }
    if (body.classList.contains('card')) cardChrome();
    for (const el of document.querySelectorAll('[data-text]')) {
        const value = lookup(el.dataset.text, meta);
        if (value === undefined || value === null) report(`no metadata "${el.dataset.text}"`);
        else el.textContent = String(value);
    }
    for (const el of document.querySelectorAll('[data-value]')) {
        const [name, key] = el.dataset.value.split('.');
        const shot = meta.shots[name];
        const value = shot ? shot.values[key] : undefined;
        if (typeof value !== 'number') report(`no value "${el.dataset.value}"`);
        else el.textContent = String(Math.round(value * 1000) / 1000);
    }
    for (const el of document.querySelectorAll('[data-shot]')) place(el);
})();
