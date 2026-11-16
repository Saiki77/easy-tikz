// Connected sliders (5.0): `slider a from 0 to 2, connected` reads and
// prints back, the flag survives normalisation, and sliders without it stay
// as they were (no key, the same line).
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, writeChartText } from '../src/text/print';
import { normalizeParameters } from '../src/migrate';

test('connected: the option reads in any place of the slider line', () => {
    for (const line of [
        'slider a from 0 to 2, connected',
        'slider a from 0 to 2, starting at 1, connected',
        'slider a from 0 to 2, connected, starting at 1',
        'slider a connected from 0 to 2',
    ]) {
        const got = parseChartText(line);
        assert.equal(got.problems.length, 0, `${line}: ${JSON.stringify(got.problems)}`);
        const p = (got.data.parameters as Array<Record<string, unknown>>)[0];
        assert.equal(p.connected, true, line);
    }
});

test('connected: a slider without it has no connected key and prints as before', () => {
    const got = parseChartText('slider c from 0 to 15, starting at 6');
    const p = (got.data.parameters as Array<Record<string, unknown>>)[0];
    assert.equal('connected' in p, false);
    assert.equal(printChartText(got.data), 'slider c from 0 to 15, starting at 6');
});

test('connected: printed at the end of the slider line, and read back the same', () => {
    const text = 'slider a from 0 to 2, starting at 1, connected\nplot a x^2';
    const data = parseChartText(text).data;
    const printed = printChartText(data);
    assert.ok(printed.split('\n').includes('slider a from 0 to 2, starting at 1, connected'), printed);
    assert.equal(JSON.stringify(parseChartText(printed).data.parameters), JSON.stringify(data.parameters));
});

test('connected: switching it on rewrites only the slider line', () => {
    const old = '# two charts share a\nslider a from 0 to 2, starting at 1\nplot a x^2 in blue';
    const data = parseChartText(old).data;
    const params = (data.parameters as Array<Record<string, unknown>>).map((p) => ({ ...p, connected: true }));
    const text = writeChartText(old, { ...data, parameters: params });
    assert.equal(text, '# two charts share a\nslider a from 0 to 2, starting at 1, connected\nplot a x^2 in blue');
});

test('connected: normalizeParameters keeps true and drops anything else', () => {
    const out = normalizeParameters([
        { name: 'a', value: 1, min: 0, max: 2, step: 0.1, connected: true },
        { name: 'b', value: 1, min: 0, max: 2, step: 0.1, connected: 'yes' },
        { name: 'c', value: 1, min: 0, max: 2, step: 0.1 },
    ]);
    assert.equal(out[0].connected, true);
    assert.equal('connected' in out[1], false);
    assert.equal('connected' in out[2], false);
});
