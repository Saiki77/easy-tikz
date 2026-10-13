/* eslint-env node */
// Charts and notes the promo images are captured from. Everything here is
// loaded into the real plugin (scripts/media/promo/capture.mjs); nothing is
// drawn by hand. Two charts are the plugin's own examples as they ship
// (EXAMPLES in src/migrate.ts: lp, surplus); the others are examples with a
// change that is named below (areas, lpDrag, plane3d), and the damped
// oscillation is built from the same defaults, so it keeps loading when a
// chart key is added.

const clone = (value) => JSON.parse(JSON.stringify(value));

/** { lp, lpDrag, areas, surplus, plane3d, wave }: chart objects that SettingsManager.fromJSON accepts. */
export function promoCharts(EXAMPLES) {
    const example = (id) => {
        const found = EXAMPLES.find((e) => e.id === id);
        if (!found) throw new Error(`promo: src/migrate.ts has no example "${id}" any more`);
        return clone(found.data);
    };
    const areas = example('areas');
    const fn = areas.functions[0];

    // A damped oscillation with three sliders: amplitude a, damping k, angular frequency w.
    const wave = {
        ...example('areas'),
        xmin: '0',
        xmax: '10',
        ymin: '-2.2',
        ymax: '2.2',
        size_x_cm: 12,
        size_y_cm: 6,
        axis_style: 'axes',
        axis_label_x: 't',
        axis_label_y: 'y',
        parameters: [
            { name: 'a', value: 2, min: 0, max: 2, step: 0.05 },
            { name: 'k', value: 0.25, min: 0, max: 1, step: 0.01 },
            { name: 'w', value: 3, min: 1, max: 6, step: 0.1 },
        ],
        functions: [
            { ...fn, name: 'f1', expression: 'a exp(-k x) cos(w x)', domain: '', showLegend: false, color: 'blue', thickness: 'thick' },
            { ...fn, name: 'f2', expression: 'a exp(-k x)', domain: '', showLegend: false, color: 'gray', thickness: 'thin', dashed: true },
            { ...fn, name: 'f3', expression: '-f2', domain: '', showLegend: false, color: 'gray', thickness: 'thin', dashed: true },
        ],
        tools: [],
        annotations: [],
    };

    // The example as it ships, with the axes on the left and bottom and room on the right:
    // the legend then sits beside the curves instead of on top of them, and no curve crosses a tick label.
    const areasWide = { ...areas, xmin: '0', xmax: '9', ymin: '-1.4', ymax: '1.4', axis_style: 'axes' };

    // The Linear program without its objective line (the curve C1): for the card about dragging a
    // constraint. With the line in the picture, the turned constraint runs through its label
    // "z = 9" and the line itself touches the label of the corner (0, 2.5).
    const lp = example('lp');
    const lpDrag = { ...lp, tools: lp.tools.filter((t) => t.name !== 'C1'), parameters: [] };
    if (lpDrag.tools.length !== lp.tools.length - 1) throw new Error('promo: the Linear program example has no curve C1 any more');

    // Surface and plane, turned by the drag that clip-3d shows (so the z axis stands beside the
    // surface instead of in front of it), and sampled twice as finely (Samples 60 instead of 30).
    const plane3d = example('plane3d');
    plane3d.rotationX = 42;
    plane3d.rotationZ = 58;
    plane3d.functions3D[0].samples = 60;

    return { lp, lpDrag, areas: areasWide, surplus: example('surplus'), plane3d, wave };
}

/** Text of the notes the captures open. `block` is the fenced easy-tikz block of the chart. */
export const NOTES = {
    lp: {
        name: 'Linear program',
        text: (block) =>
            `Maximise $z = 2x + 3y$ subject to $x + y \\le 4$ and $x + 3y \\le 6$.\n\n${block}\n\nThe dashed line is the objective $2x + 3y = c$. Move the slider and it slides across the region.\n`,
    },
    wave: {
        name: 'Damped oscillation',
        text: (block) =>
            `A mass on a spring with friction: $y(t) = a\\,e^{-kt}\\cos(\\omega t)$.\n\n${block}\n\nThe dashed envelope $\\pm a\\,e^{-kt}$ shows how fast the swing dies out.\n`,
    },
};
