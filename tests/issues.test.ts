// Problem text shared by the editor's status chip and the notes' problem line (src/issues.ts).
import { test, assert } from './_lib';
import { issueText, mergeViewErrors } from '../src/issues';
import type { SceneIssue } from '../src/scene';

const err = (source: string, field: string | undefined, message: string): SceneIssue => ({ source, field, message, severity: 'error' });

test('issueText names source, field and problem once each', () => {
    assert.equal(issueText(err('R1', 'condition:1', "condition 2: Unknown name 'k'")), "R1 condition 2: Unknown name 'k'");
    assert.equal(issueText(err('R1', 'conditionLabel:1', "Unknown name 'q'")), "R1 condition 2 label: Unknown name 'q'");
    assert.equal(issueText(err('P1', 'regionName', 'Rx does not exist')), 'P1: Rx does not exist');
    assert.equal(issueText(err('P1', 'points', "point 1: Unknown name 'w'")), "P1 point 1: Unknown name 'w'");
    assert.equal(issueText(err('P1', 'objective', 'objective is unbounded on R1')), 'P1: objective is unbounded on R1');
    assert.equal(issueText(err('chart', 'title', "Unknown name 'q'")), "Chart title: Unknown name 'q'");
    assert.equal(issueText(err('label:2', 'x', 'Enter a value')), 'Label 3 x: Enter a value');
    assert.equal(issueText(err('f1', 'expression', 'f1: Unknown name a')), 'f1: Unknown name a');
    assert.equal(issueText(err('chart', 'xmax', 'Enter a value'), ' · '), 'Chart xmax · Enter a value');
});

test('mergeViewErrors adds range fallbacks the renderer did not report', () => {
    const base = [err('chart', 'xmin', 'xmin: Unknown name b')];
    const out = mergeViewErrors(base, () => ['xmin: Unknown name b', 'ymax: Enter a value', 'zmin: Enter a value'], false);
    assert.deepEqual(
        out.map((i) => `${i.field}|${i.message}`),
        ['xmin|xmin: Unknown name b', 'ymax|ymax: Enter a value']
    );
    assert.equal(mergeViewErrors([], () => ['zmin: Enter a value'], true).length, 1, 'z ranges count in 3D');
    const thrown = mergeViewErrors([], () => {
        throw new Error('boom');
    }, false);
    assert.equal(thrown[0].message, 'Ranges could not be evaluated: boom');
});
