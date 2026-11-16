/*
 * A guide's chart written in the chart language (5.1): the words a step of
 * the Help shows are the words the guide was written in. Read with the
 * built-in English words, whatever words a reader set up for their own
 * charts. Pure: tests/guides.test.ts checks that every chart reads without
 * a problem and draws without an issue.
 */
import { parseChartText } from '../text/parse';
import { NO_WORDS } from '../text/words';
import type { ChartData } from './types';

/** The chart these lines of chart text describe. */
export function chart(...lines: string[]): ChartData {
    return parseChartText(lines.join('\n'), { words: NO_WORDS }).data;
}

/** The problems of these lines, for the tests: empty when every line reads. */
export function chartProblems(...lines: string[]): string[] {
    return parseChartText(lines.join('\n'), { words: NO_WORDS }).problems.map((p) => p.message);
}
