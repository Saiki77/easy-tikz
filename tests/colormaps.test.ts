/*
 * Colour maps by height for 3D surfaces (src/colormaps.ts): the stops are
 * pgfplots' own (checked against the installed pgfplots when there is one),
 * the preview's colour at a height mixes them linearly as pgfplots does, the
 * diverging map spreads over a range symmetric about z = 0, the export writes
 * the map with the same range (facet lines a darker shade of each facet), the
 * migration keeps a known map and drops an unknown one, and every map has a
 * name and a chart word.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { test, assert, near } from './_lib';
import { COLORMAPS, COLORMAP_NAMES, COLORMAP_STOPS, ColormapStop, colormapCss, colormapOption, colormapRange, colormapRgb, isColormap } from '../src/colormaps';
import { SettingsManager } from '../src/settings';
import { migrateSettings } from '../src/migrate';
import { EN } from '../src/i18n/en';
import { JA } from '../src/i18n/ja';
import { PIECES } from '../src/text/words';
import { Colormap } from '../src/types';

type Data = Record<string, unknown>;

function surface(over: Data = {}): Data {
    return { name: 'f1', expression: 'x*y', xDomain: '', yDomain: '', color: 'red', wireframe: false, opacity: 0.8, samples: 20, ...over };
}

function exportOf(data: Data): string {
    return SettingsManager.fromJSON(JSON.parse(JSON.stringify({ v: 4, dimension: true, ...data }))).generateTikzCode();
}

/** The `\addplot3` lines of surfaces. */
function surfaceLines(code: string): string[] {
    return code.split('\n').filter((l) => l.startsWith('\\addplot3[surf') || l.startsWith('\\addplot3[mesh'));
}

test('colormaps: six maps, each from 0 to 1 with its stops in order and channels 0..255', () => {
    assert.deepEqual([...COLORMAPS], ['viridis', 'heat', 'cool', 'diverging', 'rainbow', 'greyscale']);
    for (const map of COLORMAPS) {
        const stops = COLORMAP_STOPS[map];
        assert.equal(stops[0].at, 0, map);
        assert.equal(stops[stops.length - 1].at, 1, map);
        for (let i = 1; i < stops.length; i++) assert.ok(stops[i].at > stops[i - 1].at, `${map}: stop ${i} out of order`);
        for (const s of stops) for (const c of s.rgb) assert.ok(c >= 0 && c <= 255, `${map}: channel ${c}`);
    }
    assert.equal(COLORMAP_STOPS.viridis.length, 18);
    assert.ok(isColormap('viridis') && isColormap('greyscale'));
    for (const v of ['Viridis', 'plasma', 'grayscale', '', 3, null, undefined]) assert.equal(isColormap(v), false, String(v));
});

test('colormaps: the colour at a height mixes the two stops around it linearly, clamped to the ends', () => {
    // At the stops: the stops' colours.
    for (const map of COLORMAPS) for (const s of COLORMAP_STOPS[map]) assert.deepEqual(colormapRgb(map, s.at).map((c) => Number(c.toFixed(9))), s.rgb.map((c) => Number(c.toFixed(9))), `${map} at ${s.at}`);
    // Between them: the mix (heat is black, red at 3/8, yellow at 6/8, white).
    assert.deepEqual(colormapRgb('heat', 3 / 16), [127.5, 0, 0]);
    assert.deepEqual(colormapRgb('heat', 0.875), [255, 255, 127.5]);
    assert.deepEqual(colormapRgb('greyscale', 0.25), [63.75, 63.75, 63.75]);
    assert.deepEqual(colormapRgb('diverging', 0.75), [212.5, 135.5, 145]);
    const v = colormapRgb('viridis', 0.5 / 17);
    near(v[0], ((0.267 + 0.28192) / 2) * 255, 1e-9);
    // Outside 0..1 and not a number: the ends.
    assert.deepEqual(colormapRgb('rainbow', -2), [0, 0, 128]);
    assert.deepEqual(colormapRgb('rainbow', 7), [128, 0, 0]);
    assert.deepEqual(colormapRgb('cool', NaN), [255, 255, 255]);
    assert.equal(colormapCss('viridis', 0), 'rgb(68,1,84)');
    assert.equal(colormapCss('viridis', 1), 'rgb(253,231,37)');
    assert.equal(colormapCss('cool', 0.5), 'rgb(0,128,255)');
});

test('colormaps: the heights a map spreads over are the box, and symmetric about z = 0 for diverging', () => {
    assert.deepEqual(colormapRange('viridis', -1, 3), [-1, 3]);
    assert.deepEqual(colormapRange('heat', 2, 8), [2, 8]);
    assert.deepEqual(colormapRange('diverging', -1, 3), [-3, 3]);
    assert.deepEqual(colormapRange('diverging', -5, 2), [-5, 5]);
    assert.deepEqual(colormapRange('diverging', 2, 8), [-8, 8]);
    assert.deepEqual(colormapRange('diverging', -2, 2), [-2, 2]);
    // z = 0 is the middle of the diverging map, near white.
    const [lo, hi] = colormapRange('diverging', -1, 3);
    assert.equal(colormapCss('diverging', (0 - lo) / (hi - lo)), 'rgb(247,247,247)');
});

test('colormaps: what the export writes for each map', () => {
    assert.equal(colormapOption('viridis'), 'colormap/viridis');
    assert.equal(colormapOption('heat'), 'colormap/hot2');
    assert.equal(colormapOption('cool'), 'colormap/cool');
    assert.equal(colormapOption('diverging'), 'colormap={etDiverging}{rgb255=(33,102,172) rgb255=(247,247,247) rgb255=(178,24,43)}');
    assert.equal(colormapOption('rainbow'), 'colormap/jet');
    assert.equal(colormapOption('greyscale'), 'colormap/blackwhite');
});

/** pgfplots' own definition of a built-in colormap, as stops (null when pgfplots is not installed or the map not found). */
function pgfplotsStops(src: string, name: string): ColormapStop[] | null {
    const m = new RegExp(`/pgfplots/colormap/${name}/\\.style=\\{%?\\s*/pgfplots/colormap=\\{${name}\\}\\{([^}]*)\\}`).exec(src);
    if (!m) return null;
    const entries = [...m[1].matchAll(/(rgb255|rgb|gray)(?:\(([-\d.]+)cm\))?=\(([^)]*)\)/g)];
    const positions = entries.map((e, i) => (e[2] !== undefined ? Number(e[2]) : i));
    const first = positions[0];
    const last = positions[positions.length - 1];
    return entries.map((e, i) => {
        const values = e[3].split(',').map(Number);
        const rgb = e[1] === 'rgb255' ? values : e[1] === 'rgb' ? values.map((v) => v * 255) : [values[0] * 255, values[0] * 255, values[0] * 255];
        return { at: (positions[i] - first) / (last - first), rgb: [rgb[0], rgb[1], rgb[2]] as const };
    });
}

test('colormaps: the stops are the ones pgfplots prints', () => {
    const found = spawnSync('kpsewhich', ['pgfplots.code.tex'], { encoding: 'utf8' });
    const file = found.status === 0 ? String(found.stdout).trim() : '';
    if (!file || !fs.existsSync(file)) {
        console.log('  (pgfplots is not installed: the stops are not compared with its source)');
        return;
    }
    const src = fs.readFileSync(file, 'utf8');
    const PGF: Array<[Colormap, string]> = [
        ['viridis', 'viridis'],
        ['heat', 'hot2'],
        ['cool', 'cool'],
        ['rainbow', 'jet'],
        ['greyscale', 'blackwhite'],
    ];
    for (const [map, name] of PGF) {
        const theirs = pgfplotsStops(src, name);
        assert.ok(theirs, `colormap/${name} not found in ${file}`);
        const ours = COLORMAP_STOPS[map];
        assert.equal(ours.length, theirs.length, `${map}: number of stops`);
        ours.forEach((s, i) => {
            near(s.at, theirs[i].at, 1e-12, `${map} stop ${i} position`);
            for (let c = 0; c < 3; c++) near(s.rgb[c], theirs[i].rgb[c], 1e-9, `${map} stop ${i} channel ${c}`);
        });
    }
});

test('colormaps: a surface with a map exports the map over the box, facets a darker shade of their own colour, and its opacity', () => {
    const code = exportOf({
        zmin: '-1',
        zmax: '3',
        functions3D: [
            surface({ name: 'f1', colormap: 'viridis' }),
            surface({ name: 'f2', colormap: 'diverging', opacity: 0.5 }),
            surface({ name: 'f3', colormap: 'rainbow', wireframe: true }),
            surface({ name: 'f4', colormap: 'heat', meshOpacity: 0 }),
        ],
    });
    const [viridis, diverging, mesh, smooth] = surfaceLines(code);
    // The fill takes the surface's opacity, the mesh lines theirs (40 % when left out), in pgfplots' own facet colour.
    assert.ok(
        viridis.startsWith('\\addplot3[surf, colormap/viridis, point meta min=-1, point meta max=3, faceted color=mapped color!80!black, fill opacity=0.8, draw opacity=0.4, '),
        viridis
    );
    assert.ok(
        diverging.startsWith(
            '\\addplot3[surf, colormap={etDiverging}{rgb255=(33,102,172) rgb255=(247,247,247) rgb255=(178,24,43)}, point meta min=-3, point meta max=3, faceted color=mapped color!80!black, fill opacity=0.5, draw opacity=0.4, '
        ),
        diverging
    );
    assert.ok(mesh.startsWith('\\addplot3[mesh, colormap/jet, point meta min=-1, point meta max=3, domain='), mesh);
    // Without mesh lines: pgfplots' smooth shading, no facet colour.
    assert.ok(smooth.startsWith('\\addplot3[surf, colormap/hot2, point meta min=-1, point meta max=3, shader=interp, fill opacity=0.8, domain='), smooth);
    // The surfaces' own colour is not used, so it is not defined; nor is the light grey facet line of 4.8.
    assert.ok(!code.includes('\\definecolor{etRed}'), code);
    assert.ok(!code.includes('black!16'), code);
});

test('colormaps: a surface without a map keeps its colour ramp and draws its facets in its colour', () => {
    const code = exportOf({ zmin: '-1', zmax: '1', functions3D: [surface(), surface({ name: 'f2', wireframe: true, color: 'blue' })] });
    const [surf, mesh] = surfaceLines(code);
    assert.ok(
        surf.startsWith('\\addplot3[surf, colormap={etSurface1}{color=(etRed!30!white) color=(etRed)}, point meta min=-1, point meta max=1, faceted color=etRed, fill opacity=0.8, draw opacity=0.4, '),
        surf
    );
    assert.ok(mesh.startsWith('\\addplot3[mesh, colormap={etSurface2}{color=(etBlue) color=(etBlue)}, domain='), mesh);
});

test('colormaps: the migration keeps a known map and drops anything else; the editor keeps it', () => {
    const migrated = migrateSettings({
        v: 4,
        functions3D: [{ expression: 'x', colormap: 'heat' }, { expression: 'y', colormap: 'plasma' }, { expression: 'x*y', colormap: 'Viridis' }, { expression: '1', colormap: 7 }, { expression: '2' }],
    });
    const list = migrated.functions3D as Data[];
    assert.equal(list[0].colormap, 'heat');
    for (const s of list.slice(1)) assert.ok(!('colormap' in s), JSON.stringify(s));
    const settings = SettingsManager.fromJSON({ v: 4, dimension: true, functions3D: [{ expression: 'x', colormap: 'cool' }] });
    const saved = settings.serialize().functions3D as Data[];
    assert.equal(saved[0].colormap, 'cool');
    assert.equal(settings.toRendererConfig().functions3D[0].colormap, 'cool');
});

test('colormaps: every map has a name in every language and a chart word in the colours', () => {
    for (const map of COLORMAPS) {
        const key = COLORMAP_NAMES[map];
        assert.ok(EN[key] && JA[key], `${map}: no name`);
        const piece = PIECES.find((p) => p.id === map);
        assert.ok(piece && piece.builtin === map && piece.group === 'colours', `${map}: no chart word`);
        assert.ok(EN[piece.what] && JA[piece.what], `${map}: no description`);
    }
    assert.equal(EN['build.colormap.viridis'], 'Viridis');
    assert.equal(JA['build.colormap.viridis'], 'Viridis');
    const cube = PIECES.find((p) => p.id === 'cube');
    assert.ok(cube && cube.builtin === 'cube' && cube.group === 'lines');
});
