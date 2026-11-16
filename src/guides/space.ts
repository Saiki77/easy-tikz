/*
 * Guides of the category 3D (5.1): a surface coloured by height in a cube,
 * the view turned, a plane on a slider, a marked point and a label that
 * rides on the plane. Each step adds a line or two; the Help shows the
 * chart in words with the new lines lit.
 */
import type { Guide } from './types';
import { chart } from './chart';

/**
 * The saddle z = x^2 - y^2 where a surface is computed by default, -5..5, so
 * z runs from -25 to 25. tests/labels.test.ts reads the last step: the
 * centred label at (5, -5, h) with h = 1 sits on the right edge of the box
 * for this view (tilt 20, turn 60) and steps to the right.
 */
const S3_WINDOW = ['size 12 x 9', 'show x from -5 to 5, y from -5 to 5 and z from -25 to 25'];
const S3_SURFACE = 'plot $f(x, y) = x^2 - y^2$';
const S3_COLOURED = `${S3_SURFACE} in viridis`;
const S3_CUBE = 'cube';
const S3_TURN = ['set rotationX = 20', 'set rotationZ = 60'];
const S3_SLIDER = 'slider h from -20 to 20, starting at 1';
const S3_PLANE = 'draw the plane z = h, opacity 0.4';
const S3_POINT = 'mark (0, 0, 0), large, labelled "saddle point"';
const S3_LABEL = 'write "z = {h}" at (5, -5, h), center';
const S3_BOX = [S3_CUBE, ...S3_WINDOW];

const SURFACES_3D: Guide = {
    id: 'surfaces-3d',
    title: 'Surfaces, planes and points in 3D',
    summary: 'Plot a surface coloured by height in a cube, turn it, and cut it with a plane on a slider.',
    category: '3D',
    level: 'core',
    minutes: 3,
    outcomes: ['Plot a surface in a colour map inside a cube', 'Turn the view and keep its angles', 'Add a moving plane, a marked point and a label'],
    requires: ['sliders'],
    chart: chart(...S3_BOX, ...S3_TURN, S3_SLIDER, S3_COLOURED, S3_PLANE, S3_POINT, S3_LABEL),
    steps: [
        {
            title: 'Plot a surface in a cube',
            body: 'A formula in `x` and `y` is a surface, so the chart turns 3D. `cube` draws its box as a cube, whatever the ranges of x, y and z.',
            chart: chart(...S3_BOX, S3_SURFACE),
        },
        {
            title: 'Colour it by height',
            body: '`in viridis` colours the surface by its height. `heat`, `cool`, `diverging`, `rainbow` and `greyscale` work too.',
            chart: chart(...S3_BOX, S3_COLOURED),
        },
        {
            title: 'Turn the view',
            body: 'In the editor, drag the chart to turn it. The two angles are kept as lines: `rotationX` tilts the view, `rotationZ` turns it around the z-axis.',
            chart: chart(...S3_BOX, ...S3_TURN, S3_COLOURED),
            tip: 'Elevation and Azimuth under 3D view in the Chart tab set the two angles exactly.',
        },
        {
            title: 'Cut it with a plane on a slider',
            body: '`draw the plane z = h` lays a flat plane at the height `h`. Press play on `h`: the plane moves up and down through the saddle.',
            chart: chart(...S3_BOX, ...S3_TURN, S3_SLIDER, S3_COLOURED, S3_PLANE),
        },
        {
            title: 'Mark a point and add a label',
            body: 'A point in 3D has three coordinates. A label takes a height as well: `z = {h}` sits on a corner of the plane and rides with it.',
            chart: chart(...S3_BOX, ...S3_TURN, S3_SLIDER, S3_COLOURED, S3_PLANE, S3_POINT, S3_LABEL),
        },
    ],
    next: ['charts-in-notes', 'export-latex'],
};

export const SPACE_GUIDES: Guide[] = [SURFACES_3D];
