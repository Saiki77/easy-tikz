/* eslint-env node */
// Keep the pictures in docs/ still when what they show did not change.
//
// No capture is byte stable: text is antialiased a little differently from
// run to run, and the PNG encoder then writes other bytes for the same
// picture. Without a check, every run of a build script would rewrite every
// image, and each run would add megabytes to the history of the repository
// for nothing. So a build script writes a new file next to the old one and
// asks here whether the two show the same picture; the old file stays when
// they do.
//
//   installImage(fresh, target)   moves `fresh` to `target` unless both show the same picture
//   sameImage(a, b)
//
// "The same" is strict on purpose. The noise between two runs is faint (a
// few percent of a channel at glyph edges) and is ignored by FUZZ_PERCENT;
// what is left may differ in at most MAX_PIXELS pixels. One changed digit in
// a label is already more than that, so a real change always replaces the
// file. A wrongly kept picture would be worse than a rewritten one.
//
// Videos have no such check. Two takes of one scenario differ in most of
// their frames (a drag is drawn at slightly different moments), so nothing
// could tell a deliberate small change from a new take: a filmed scenario
// always replaces its MP4 and GIF. Film only the scenarios that changed
// (`node scripts/media/build-video.mjs clip-sliders`).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** A pixel counts as different when a channel is off by more than this share of its range. */
const FUZZ_PERCENT = 6;
/** Two pictures are the same when at most this many pixels differ. */
const MAX_PIXELS = 24;

async function imageSize(file) {
    const { stdout } = await run('magick', ['identify', '-format', '%w %h\n', file]);
    const [w, h] = stdout.trim().split('\n')[0].split(/\s+/).map(Number);
    return { width: w, height: h };
}

/**
 * Do two image files show the same picture? Same size, and all but
 * MAX_PIXELS pixels within FUZZ_PERCENT of each other. False when either
 * file is missing or cannot be read.
 */
export async function sameImage(a, b) {
    if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
    try {
        const [sa, sb] = [await imageSize(a), await imageSize(b)];
        if (sa.width !== sb.width || sa.height !== sb.height) return false;
        // `compare` exits with 1 when the images differ and prints the number of different pixels either way.
        const out = await run('magick', ['compare', '-metric', 'AE', '-fuzz', `${FUZZ_PERCENT}%`, a, b, 'null:']).then(
            (r) => r.stderr || r.stdout,
            (e) => (e && e.code === 1 ? e.stderr || e.stdout : null)
        );
        if (out === null || out === undefined) return false;
        // ImageMagick 7.1 prints "<summed error> (<pixels>)", older versions the number of pixels alone.
        const text = String(out).trim();
        const inBrackets = /\(([0-9.e+-]+)\)/.exec(text);
        const different = Number(inBrackets ? inBrackets[1] : text.split(/\s/)[0]);
        if (!Number.isFinite(different)) return false;
        return different <= MAX_PIXELS;
    } catch {
        return false;
    }
}

async function install(fresh, target, same) {
    const existed = fs.existsSync(target);
    if (existed && (await same(fresh, target))) {
        if (path.resolve(fresh) !== path.resolve(target)) fs.rmSync(fresh, { force: true });
        return 'kept';
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (path.resolve(fresh) !== path.resolve(target)) {
        fs.copyFileSync(fresh, target);
        fs.rmSync(fresh, { force: true });
    }
    return existed ? 'changed' : 'new';
}

/**
 * Put the image `fresh` at `target`, unless the file that is there shows
 * the same picture: then it stays as it is and `fresh` is deleted.
 * Returns 'new', 'changed' or 'kept'.
 */
export function installImage(fresh, target) {
    return install(fresh, target, sameImage);
}

