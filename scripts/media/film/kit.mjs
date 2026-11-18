/* eslint-env browser, node */
// The film kit: a frame-exact capture of the isolated Obsidian (../lib/obsidian.mjs) for clean takes with a
// drawn pointer (the 5.2 tour; see README.md in this folder).
//
// Every picture is one tick of a film clock (60 per second by default):
//   1. the page's requestAnimationFrame time moves on by exactly 1/fps (slider play, chart motion),
//   2. CSS transitions and animations are paused as they start and stepped by the same 1/fps,
//   3. the drawn pointer moves to the scripted mouse position (a ring shows a press),
//   4. the picture waits until the plugin reports nothing left to draw (window.__etzMedia.idle()),
//   5. the camera rectangle (3:2 by default, eased) is captured at the output size and piped into ffmpeg.
// So no step is late or doubled, however long a screenshot takes. Holds repeat the last picture.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Page side: the film clock, the stepped CSS animations and the pointer. */
function install() {
    if (window.__film) return true;
    const c = { now: performance.now(), raf: window.requestAnimationFrame.bind(window), anims: new Set() };
    window.__film = c;
    window.requestAnimationFrame = (cb) => c.raf(() => cb(c.now));
    const grab = () => {
        for (const a of document.getAnimations()) {
            if (c.anims.has(a)) continue;
            c.anims.add(a);
            try {
                a.pause();
            } catch {
                c.anims.delete(a);
            }
        }
    };
    c.grab = grab;
    document.addEventListener('transitionrun', grab, true);
    document.addEventListener('animationstart', grab, true);
    c.tick = (dt) => {
        grab();
        c.now += dt;
        for (const a of Array.from(c.anims)) {
            try {
                if (!a.effect || a.playState === 'idle' || a.playState === 'finished') {
                    c.anims.delete(a);
                    continue;
                }
                const end = a.effect.getComputedTiming().endTime;
                const t = (Number(a.currentTime) || 0) + dt;
                if (Number.isFinite(end) && t >= end) {
                    a.finish();
                    c.anims.delete(a);
                } else a.currentTime = t;
            } catch {
                c.anims.delete(a);
            }
        }
    };
    // The pointer: a macOS-like arrow, drawn above everything, never hit by the mouse.
    const NS = 'http://www.w3.org/2000/svg';
    const root = document.createElement('div');
    root.id = 'film-pointer';
    root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;transform-origin:0 0;will-change:transform;';
    const ring = document.createElement('div');
    ring.style.cssText = 'position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;border:2.5px solid rgba(124,92,255,0.9);background:rgba(124,92,255,0.18);box-sizing:border-box;opacity:0;transform-origin:50% 50%;';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;filter:drop-shadow(0 1.5px 2px rgba(0,0,0,0.35));';
    const arrow = document.createElementNS(NS, 'path');
    arrow.setAttribute('d', 'M1 1 L1 18.2 L5.6 14 L8.8 21.2 L11.9 19.9 L8.8 12.9 L15 12.9 Z');
    arrow.setAttribute('fill', '#111');
    arrow.setAttribute('stroke', '#fff');
    arrow.setAttribute('stroke-width', '1.4');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(arrow);
    root.appendChild(ring);
    root.appendChild(svg);
    document.body.appendChild(root);
    c.pointer = (x, y, scale, shown, ringScale, ringOpacity) => {
        root.style.display = shown ? 'block' : 'none';
        root.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        ring.style.opacity = String(ringOpacity);
        ring.style.transform = `scale(${ringScale})`;
    };
    return true;
}

const smooth = (u) => u * u * u * (u * (u * 6 - 15) + 10); // minimum jerk: still at both ends
const lerp = (a, b, u) => a + (b - a) * u;

export async function createFilm(obs, { out, fps = 60, width = 1800, height = 1200, crf = 16, stills = null, say = () => {} }) {
    const view = await obs.call(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await obs.call(install);
    // How many output pixels one CSS pixel gives at clip scale 1 (the device scale).
    const probe = await obs.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 100, height: 100, scale: 1 } });
    const device = Buffer.from(probe.data, 'base64').readUInt32BE(16) / 100;
    say(`view ${view.w} x ${view.h}, device scale ${device}`);

    const aspect = width / height;
    const fullW = Math.min(view.w, view.h * aspect);
    const full = { cx: view.w / 2, cy: view.h / 2, w: fullW };
    let cam = { ...full };
    let move = null; // { from, to, start, frames }
    let frame = 0;
    let down = false;
    let shown = true;
    let pressAt = -1e9;
    let releaseAt = -1e9;
    let last = null;
    let captureMs = 0;
    // The event track for the sound (sound.mjs): what happens, at which second of the film.
    const events = [];
    const mark = (type, data = {}) => events.push({ t: Math.round((frame / fps) * 1e4) / 1e4, type, ...data });

    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (stills) fs.mkdirSync(stills, { recursive: true });
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-vf', `scale=${width}:${height}:flags=lanczos,setsar=1`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
    const write = (buf) => new Promise((resolve) => (ff.stdin.write(buf) ? resolve() : ff.stdin.once('drain', resolve)));

    const clampCam = (c) => {
        const w = Math.min(Math.max(c.w, 200), fullW);
        const h = w / aspect;
        const cx = Math.min(Math.max(c.cx, w / 2), view.w - w / 2);
        const cy = Math.min(Math.max(c.cy, h / 2), view.h - h / 2);
        return { cx, cy, w };
    };
    const camAt = (f) => {
        if (!move) return cam;
        const u = Math.min(1, Math.max(0, (f - move.start) / move.frames));
        const e = smooth(u);
        // Zoom in log space, so a push-in feels even; the centre follows.
        const w = Math.exp(lerp(Math.log(move.from.w), Math.log(move.to.w), e));
        const c = { cx: lerp(move.from.cx, move.to.cx, e), cy: lerp(move.from.cy, move.to.cy, e), w };
        if (u >= 1) {
            cam = move.to;
            move = null;
        }
        return clampCam(c);
    };

    async function idle() {
        await obs.waitFor(() => obs.call(() => !window.__etzMedia || window.__etzMedia.idle()), { timeout: 20000, interval: 8, message: 'the plugin to finish drawing' });
        await obs.frames(2);
    }

    /** One picture: the clock moves on by 1/fps, then the camera's rectangle is captured. */
    async function tick(n = 1) {
        for (let i = 0; i < n; i++) {
            const c = camAt(frame);
            const zoom = fullW / c.w;
            const t = frame / fps;
            // The press: a ring that grows and fades; it stays while the button is held.
            const sincePress = t - pressAt;
            const sinceRelease = t - releaseAt;
            let ringScale = 0.6;
            let ringOpacity = 0;
            if (down) {
                ringScale = 0.6 + 0.4 * Math.min(1, sincePress / 0.15);
                ringOpacity = 1;
            } else if (sinceRelease < 0.3) {
                ringScale = 1 + sinceRelease * 1.2;
                ringOpacity = 1 - sinceRelease / 0.3;
            }
            await obs.call(
                (dt, x, y, s, on, rs, ro) => {
                    window.__film.tick(dt);
                    window.__film.pointer(x, y, s, on, rs, ro);
                },
                1000 / fps,
                obs.mouse.x,
                obs.mouse.y,
                1 / Math.sqrt(zoom),
                shown,
                ringScale,
                ringOpacity,
            );
            await idle();
            // Output pixels per CSS px; the rectangle's edges on whole output pixels, so the picture is exactly width x height.
            const t0 = Date.now();
            const S = width / c.w;
            const x = Math.round((c.cx - c.w / 2) * S) / S;
            const y = Math.round((c.cy - c.w / aspect / 2) * S) / S;
            const r = await obs.cdp.send(
                'Page.captureScreenshot',
                { format: 'png', clip: { x, y, width: width / S, height: height / S, scale: S / device }, optimizeForSpeed: true, captureBeyondViewport: false },
                { timeout: 30000 },
            );
            const got = Buffer.from(r.data, 'base64');
            // Chromium may round a zoomed rectangle to a pixel more or less: ffmpeg scales it to the exact size.
            if (Math.abs(got.readUInt32BE(16) - width) > 3 || Math.abs(got.readUInt32BE(20) - height) > 3) {
                throw new Error(`frame ${frame}: ${got.readUInt32BE(16)} x ${got.readUInt32BE(20)}, expected ${width} x ${height}`);
            }
            captureMs += Date.now() - t0;
            last = got;
            await write(last);
            if (stills && frame % Math.round(fps) === 0) fs.writeFileSync(path.join(stills, `s-${String(frame / fps).padStart(5, '0')}.png`), last);
            frame++;
        }
    }

    /** Seconds of film. Still: the last picture again (nothing moves, the camera rests); else real ticks. */
    async function hold(seconds, { still = true } = {}) {
        const n = Math.max(1, Math.round(seconds * fps));
        if (still && !move && last) {
            for (let i = 0; i < n; i++) await write(last);
            frame += n;
            return;
        }
        await tick(n);
    }

    const film = {
        fps,
        view,
        full,
        frame: () => frame,
        seconds: () => frame / fps,
        tick,
        hold,
        idle,
        /** Note an event for the sound at this moment: 'pop' when something opens, or any type sound.mjs knows. */
        mark,
        pointer(on) {
            shown = on;
        },
        /** Ease the camera to a rectangle {x, y, width, height} (padded, 3:2) or {cx, cy, w} over `seconds`. */
        camera(target, seconds = 0.8, { pad = 24 } = {}) {
            let to;
            if (target === 'full') to = { ...full };
            else if ('cx' in target) to = { cx: target.cx, cy: target.cy, w: target.w };
            else {
                const w = Math.max(target.width + 2 * pad, (target.height + 2 * pad) * aspect);
                to = { cx: target.x + target.width / 2, cy: target.y + target.height / 2, w };
            }
            to = clampCam(to);
            const from = camAt(frame);
            if (seconds <= 0) {
                cam = to;
                move = null;
                return;
            }
            move = { from, to, start: frame, frames: Math.max(1, Math.round(seconds * fps)) };
            mark('camera', { seconds, zoom: Math.round((from.w / to.w) * 1000) / 1000 });
        },
        async cameraWait() {
            while (move) await tick();
        },
        /** Where the camera rests or goes to, {cx, cy, w}: what the next part of a film in parts starts from (parts.mjs). */
        cameraNow() {
            return { ...(move ? move.to : cam) };
        },
        /** The pointer's position: what the next part of a film in parts starts from. */
        pointerNow() {
            return { x: obs.mouse.x, y: obs.mouse.y };
        },
        /** Glide the pointer to (x, y) in `seconds`, on a slight arc, still at both ends. */
        async move(x, y, seconds = 0.6, { arc = 0.08 } = {}) {
            const x0 = obs.mouse.x;
            const y0 = obs.mouse.y;
            const n = Math.max(1, Math.round(seconds * fps));
            const dx = x - x0;
            const dy = y - y0;
            // The control point: off the straight line by `arc` of its length.
            const mx = (x0 + x) / 2 - dy * arc;
            const my = (y0 + y) / 2 + dx * arc;
            for (let i = 1; i <= n; i++) {
                const u = smooth(i / n);
                const px = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x;
                const py = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * y;
                await obs.mouse.move({ x: px, y: py });
                await tick();
            }
        },
        async press() {
            mark('press');
            await obs.mouse.down();
            down = true;
            pressAt = frame / fps;
        },
        async release() {
            mark('release');
            await obs.mouse.up();
            down = false;
            releaseAt = frame / fps;
        },
        async click(x, y, seconds = 0.5) {
            if (x !== undefined) await film.move(x, y, seconds);
            await film.press();
            await tick(4);
            await film.release();
            await tick(2);
        },
        /** A drag along points [[x, y], ...], `seconds` in all, still at both ends of the whole path. */
        async drag(points, seconds = 1.2, { settle = 0.15 } = {}) {
            await film.press();
            await tick(Math.round(settle * fps));
            const segs = [];
            let total = 0;
            let [px, py] = [obs.mouse.x, obs.mouse.y];
            for (const [x, y] of points) {
                const len = Math.hypot(x - px, y - py);
                segs.push({ x0: px, y0: py, x, y, len, at: total });
                total += len;
                [px, py] = [x, y];
            }
            const n = Math.max(1, Math.round(seconds * fps));
            mark('drag', { seconds, length: Math.round(total) });
            for (let i = 1; i <= n; i++) {
                const d = smooth(i / n) * total;
                const s = segs.find((g) => d <= g.at + g.len + 1e-9) ?? segs[segs.length - 1];
                const u = s.len ? Math.min(1, (d - s.at) / s.len) : 1;
                await obs.mouse.move({ x: lerp(s.x0, s.x, u), y: lerp(s.y0, s.y, u) });
                await tick();
            }
            await tick(Math.round(settle * fps));
            await film.release();
            await tick(2);
        },
        /** Type text: one key at a time, about `cps` keys a second (a little uneven, as a hand types). */
        async type(text, cps = 16) {
            let seed = 7;
            const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
            for (const ch of Array.from(text)) {
                mark('key', { key: ch === '\n' ? 'Enter' : ch === ' ' ? 'Space' : 'char' });
                if (ch === '\n') await obs.key('Enter');
                else await obs.type(ch);
                const frames = Math.max(1, Math.round((fps / cps) * (0.7 + 0.6 * rnd())));
                await tick(frames);
            }
        },
        async key(name, mods) {
            mark('key', { key: name === 'Enter' ? 'Enter' : 'char' });
            await obs.key(name, mods);
            await tick();
        },
        /** Wheel steps spread over `seconds` at (x, y): `total` deltaY in all (negative zooms in). */
        async wheel(x, y, total, seconds = 0.8) {
            const n = Math.max(1, Math.round(seconds * fps));
            mark('wheel', { seconds, zoom: total < 0 ? 'in' : 'out' });
            let sent = 0;
            for (let i = 1; i <= n; i++) {
                const want = smooth(i / n) * total;
                const step = want - sent;
                sent = want;
                await obs.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: step });
                await tick();
            }
        },
        /** Scroll an element (selector) to scrollTop `top` over `seconds`, eased, one step per picture. */
        async scroll(selector, top, seconds = 1) {
            const from = await obs.call((s) => document.querySelector(s).scrollTop, selector);
            const n = Math.max(1, Math.round(seconds * fps));
            mark('scroll', { seconds });
            for (let i = 1; i <= n; i++) {
                await obs.call((s, v) => {
                    document.querySelector(s).scrollTop = v;
                }, selector, lerp(from, top, smooth(i / n)));
                await tick();
            }
        },
        async finish() {
            ff.stdin.end();
            await done;
            fs.writeFileSync(out.replace(/\.mp4$/i, '') + '-events.json', JSON.stringify({ fps, seconds: frame / fps, events }, null, 1));
            await obs.call(() => {
                document.getElementById('film-pointer')?.remove();
            });
            return { frames: frame, seconds: frame / fps, captureMs };
        },
    };
    return film;
}

/** The rectangle of the first element a selector finds, in CSS px of the window. */
export function rectOf(obs, selector) {
    return obs.call((s) => {
        const el = Array.from(document.querySelectorAll(s)).find((e) => e.getClientRects().length);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, selector);
}
