/* eslint-env node */
// Files of docs/media that the first-round scripts made and that the new pipelines have replaced.
//
// build-promo.mjs and build-video.mjs made every image and video of the 4.0 relaunch. Since 4.2 the
// hero picture and the drag page come from the brand kit (brand/), and the drag clip and the overview
// film from the cinema pipeline (cinema/), in the "Math notebook" design. The first-round scripts
// still make the other files, but a run of them would put the old design back over these, so they
// never write these names into docs/media. With --out <another dir> they still make them, for a
// comparison.
//
//   const names = keepReplaced('promo', outDir, wanted, { explicit, log });   // the names a run may make
//   guardReplaced('promo', outDir, 'hero');                                    // throws before a write
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './obsidian.mjs';

export const DOCS_MEDIA = path.join(REPO, 'docs', 'media');

/** Per first-round script: the names (file name without suffix) it must not write into docs/media. */
export const REPLACED = {
    promo: { names: ['hero', 'card-drag'], by: 'scripts/media/brand (npm run media:brand)' },
    video: { names: ['overview', 'clip-drag'], by: 'scripts/media/cinema (npm run media:film)' },
};

/** True when `dir` is the repository's docs/media folder (also through a symlink or another spelling). */
export function isDocsMedia(dir) {
    const a = path.resolve(dir);
    if (a === DOCS_MEDIA) return true;
    try {
        const s = fs.statSync(a);
        const d = fs.statSync(DOCS_MEDIA);
        return s.dev === d.dev && s.ino === d.ino;
    } catch {
        return false;
    }
}

function why(kind, names) {
    const { by } = REPLACED[kind];
    return `${names.join(', ')} in docs/media ${names.length > 1 ? 'are' : 'is'} made by ${by} now; this script makes the first-round design and does not write ${names.length > 1 ? 'them' : 'it'} there. Pass --out <dir> to make the old version somewhere else.`;
}

/**
 * The names a run may make into `outDir`. For docs/media the replaced names are left out of the
 * default set (with a line on the log); naming one of them (`explicit`) is an error.
 */
export function keepReplaced(kind, outDir, names, { explicit = false, log = () => {} } = {}) {
    if (!isDocsMedia(outDir)) return names;
    const hit = names.filter((n) => REPLACED[kind].names.includes(n));
    if (!hit.length) return names;
    if (explicit) throw new Error(why(kind, hit));
    log(`left out: ${why(kind, hit)}`);
    return names.filter((n) => !hit.includes(n));
}

/** Throws when `name` is a replaced name and `outDir` is docs/media: the last check before a write. */
export function guardReplaced(kind, outDir, name) {
    if (isDocsMedia(outDir) && REPLACED[kind].names.includes(name)) throw new Error(why(kind, [name]));
}
