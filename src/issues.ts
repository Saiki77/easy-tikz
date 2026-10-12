/*
 * Problem text shared by the editor's status chip and the problem line
 * under charts in notes: both format the same SceneIssue list. Pure, so
 * tests can load it.
 */
import type { SceneIssue } from './scene';
import { errorText } from './util';

/**
 * A SceneIssue field id in words ('' when the location needs none).
 * 'condition:N' and 'conditionLabel:N' are 0-based, people count from 1.
 * The expression and the reference fields (regionName, ref1, ref2) get no
 * words: the source ('f1: ...') or the message ('R2 is empty
 * (infeasible)', 'Q does not exist') already says where.
 */
function fieldText(field: string | undefined): string {
    if (!field || field === 'expression' || field === 'regionName' || field === 'ref1' || field === 'ref2') return '';
    const condition = /^condition(Label)?:(\d+)$/.exec(field);
    if (condition) return `condition ${Number(condition[2]) + 1}${condition[1] ? ' label' : ''}`;
    if (field === 'expressionY') return 'y(t)';
    if (field === 'tangentPoint') return 'tangent point';
    if (field === 'xDomain') return 'x domain';
    if (field === 'yDomain') return 'y domain';
    // Plain words already: domain, equation, levels, points, path, objective, value, label, text, title, x, y, z.
    return field;
}

/** 'objective is unbounded ...' starts with the field's name; 'objectives ...' does not. */
function startsWithWord(message: string, word: string): boolean {
    return message.toLowerCase().startsWith(word.toLowerCase()) && !/[a-z0-9]/i.test(message.charAt(word.length));
}

/** 'chart' -> 'Chart', 'label:2' -> 'Label 3' (annotations), tool / function names as they are. */
function issueSource(source: string): string {
    if (source === 'chart') return 'Chart';
    const label = /^label:(\d+)$/.exec(source);
    return label ? `Label ${Number(label[1]) + 1}` : source;
}

/**
 * One line per issue, naming source, field and problem once each:
 * 'R1 condition 2: Unknown name k' (the message's own 'condition 2: '
 * moves into the location), 'P1 point 1: ...', 'P1: objective is unbounded
 * on R1' (the message names its field), 'Chart xmax: ...', 'Label 3 x: ...'.
 */
export function issueText(issue: SceneIssue, separator = ': '): string {
    let message = issue.message;
    if (message.startsWith(`${issue.source}: `)) message = message.slice(issue.source.length + 2);
    let field = fieldText(issue.field);
    // Point lists name the entry: 'point 2: ...'.
    const entry = field === 'points' ? /^(point \d+): /.exec(message) : null;
    if (entry) field = entry[1];
    if (field && message.startsWith(`${field}: `)) message = message.slice(field.length + 2);
    else if (field && startsWithWord(message, field)) field = '';
    const where = [issueSource(issue.source), field].filter((s) => s).join(' ');
    return where ? `${where}${separator}${message}` : message;
}

/**
 * Add the axis-range fallbacks of resolveView ('xmax: Unknown name b') that
 * the renderer did not report itself. z ranges only count in 3D.
 */
export function mergeViewErrors(issues: SceneIssue[], resolveErrors: () => string[], is3D: boolean): SceneIssue[] {
    const out = issues.slice();
    let errors: string[];
    try {
        errors = resolveErrors();
    } catch (e) {
        errors = [`Ranges could not be evaluated: ${errorText(e)}`];
    }
    for (const text of errors) {
        const m = /^([xyz](?:min|max))\s*:\s*/.exec(text);
        const field = m ? m[1] : undefined;
        if (field && field.startsWith('z') && !is3D) continue;
        const known = out.some((i) => i.source === 'chart' && (i.message === text || (field !== undefined && i.field === field)));
        if (!known) out.push({ source: 'chart', field, message: text, severity: 'error' });
    }
    return out;
}
