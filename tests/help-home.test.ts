/*
 * 6.0: the Help home (src/guides/home.ts, drawn by src/ui/helpPanel.ts):
 * Start here, the language tour, New in 6, topic sections, the Reference.
 * Every guide is on the home, each in one place of its own; the sections
 * and New in 6 have their texts in English and Japanese.
 */
import { test, assert } from './_lib';
import { GUIDES, guidesIn, localGuides, stepChart } from '../src/guides';
import { NEW_IN_6, SECTION_FIRST, TOUR_ID, homeSections, newInSix } from '../src/guides/home';
import { EN } from '../src/i18n/en';
import { JA } from '../src/i18n/ja';
import { setLanguage } from '../src/i18n';

test('every guide is on the home, in one place of its own', () => {
    const places = new Map<string, string[]>();
    const put = (id: string, where: string) => places.set(id, [...(places.get(id) ?? []), where]);
    for (const g of guidesIn('Getting started')) put(g.id, 'start');
    put(TOUR_ID, 'tour');
    for (const { guide } of newInSix()) put(guide.id, 'new');
    const sections = homeSections();
    for (const s of sections) {
        for (const g of s.guides) {
            // The 3D section shows the 3D guides of other sections as well: those count where they belong.
            if (s.id === 'space' && g.category !== '3D') continue;
            put(g.id, s.id);
        }
    }
    for (const g of guidesIn('Reference')) put(g.id, 'reference');
    const missing = GUIDES.filter((g) => !places.has(g.id)).map((g) => g.id);
    assert.deepEqual(missing, [], 'guides the home does not show');
    const twice = [...places].filter(([, at]) => at.length > 1).map(([id, at]) => `${id}: ${at.join(', ')}`);
    assert.deepEqual(twice, [], 'guides in two places');
});

test('New in 6: four Showcase pages of version 6, each with a picture', () => {
    const fresh = newInSix();
    assert.equal(fresh.length, 4);
    const v6 = guidesIn('Showcase').slice(0, 11).map((g) => g.id);
    for (const { guide, chart } of fresh) {
        assert.ok(v6.includes(guide.id), `${guide.id} is a Showcase page of version 6`);
        assert.ok(Array.isArray(chart.tools) || Array.isArray(chart.functions), `${guide.id}: a chart`);
    }
    assert.deepEqual(fresh.map((f) => f.guide.id), ['lorenz-butterfly', 'complex-two-ways', 'fourier-circles', 'mandelbrot-orbit']);
    // The complex functions show their coloured plane, not the grid of the finished chart.
    const complex = fresh[1];
    const step = NEW_IN_6[1].step;
    assert.ok(step !== undefined);
    assert.equal(complex.chart, stepChart(complex.guide, step));
    assert.ok(((complex.chart.tools as Array<{ type: string }>) ?? []).some((t) => t.type === 'colourPlane'));
});

test('sections: the order, Python and GeoGebra in Scripting, the let values with linear algebra, 3D guides in 3D', () => {
    const sections = homeSections();
    assert.deepEqual(
        sections.map((s) => s.id),
        ['basics', 'showcase', 'calculus', 'regions', 'linear', 'dynamics', 'scripting', 'space', 'notes']
    );
    const of = (id: string) => sections.find((s) => s.id === id)?.guides.map((g) => g.id) ?? [];
    assert.deepEqual(of('scripting').slice(0, 2), ['python-chart', 'geogebra-commands']);
    for (const id of ['python-heart', 'python-plot', 'python-wave']) assert.ok(of('scripting').includes(id), id);
    assert.equal(of('linear')[0], 'values-let');
    assert.ok(of('space').includes('surfaces-3d') && of('space').includes('systems'));
    // The Showcase section leaves out the pages of New in 6, just above it.
    for (const { id } of NEW_IN_6) assert.ok(!of('showcase').includes(id), id);
    for (const s of sections) assert.ok(s.guides.length > 0, s.id);
    assert.ok(SECTION_FIRST === 4);
});

test('sections in Japanese: the same guides, and every text of the home in both languages', () => {
    const en = homeSections().map((s) => `${s.id}: ${s.guides.map((g) => g.id).join(' ')}`);
    try {
        setLanguage('ja');
        const ja = homeSections(localGuides()).map((s) => `${s.id}: ${s.guides.map((g) => g.id).join(' ')}`);
        assert.deepEqual(ja, en);
    } finally {
        setLanguage('en');
    }
    const keys = ['help.home.new', 'help.home.about.new', 'help.home.showAll', 'help.home.showFewer', 'help.home.openAi', 'help.home.about.reference'];
    for (const s of homeSections()) keys.push(s.title, s.about);
    for (const k of keys) {
        const en = (EN as Record<string, string>)[k];
        const ja = (JA as Record<string, string>)[k];
        assert.ok(en && ja, `${k}: English and Japanese`);
        // '3D' reads the same in both.
        if (k !== 'help.category.threeD') assert.notEqual(en, ja, `${k}: translated`);
    }
});
