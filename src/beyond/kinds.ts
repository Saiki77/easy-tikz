/*
 * 6.2.1: the kinds of distribution and their parameters: which fields each
 * kind reads (in the order its line names them), whether it is drawn as
 * bars, and the density its numbers give, or the field of a number that is
 * out of range with the message that says so. Shared by the scene, the
 * auto-fit, the cards, the rename and the parser. Pure: no DOM, no Obsidian.
 */
import type { DistributionKind } from '../types';
import type { MessageKey } from '../i18n';
import { Density, betaDensity, chiSquare, exponential, gammaDensity, normalDensity, studentT, uniform } from './maths';

/** Every kind, in the order the cards offer them. */
export const DISTRIBUTION_KINDS: readonly DistributionKind[] = ['normal', 'binomial', 'studentT', 'chiSquare', 'exponential', 'uniform', 'poisson', 'gamma', 'beta'];

/** The formula fields of a distribution. */
export type DistributionField = 'mean' | 'sd' | 'n' | 'p' | 'df' | 'rate' | 'from' | 'to' | 'lambda' | 'shape' | 'alpha' | 'beta';

/** The fields each kind reads, in the order its line names them. */
export const KIND_FIELDS: Readonly<Record<DistributionKind, readonly DistributionField[]>> = {
    normal: ['mean', 'sd'],
    binomial: ['n', 'p'],
    studentT: ['df'],
    chiSquare: ['df'],
    exponential: ['rate'],
    uniform: ['from', 'to'],
    poisson: ['lambda'],
    gamma: ['shape', 'rate'],
    beta: ['alpha', 'beta'],
};

/** Every formula field of a distribution (each once). */
export const DISTRIBUTION_FIELDS: readonly DistributionField[] = ['mean', 'sd', 'n', 'p', 'df', 'rate', 'from', 'to', 'lambda', 'shape', 'alpha', 'beta'];

/** A Poisson bar this many times lower than the highest is too small to see: the fit leaves it out, and no label stands over it. */
export const POISSON_SEEN = 500;

/** Most λ a Poisson distribution draws (its bars reach about λ + 12 sqrt(λ) + 20). */
export const MAX_LAMBDA = 1000;

/** The kind of a stored distribution: one of the kinds, else normal (as the migration reads it). */
export function kindOf(kind: unknown): DistributionKind {
    return typeof kind === 'string' && (DISTRIBUTION_KINDS as readonly string[]).includes(kind) ? (kind as DistributionKind) : 'normal';
}

/** Drawn as bars at k = 0, 1, 2, ... (binomial, Poisson); every other kind is a density curve. */
export function isDiscrete(kind: unknown): boolean {
    return kind === 'binomial' || kind === 'poisson';
}

/** A parameter out of range: its field and the message that says what it must be. */
export interface BadParameter {
    field: DistributionField;
    message: MessageKey;
    values?: Record<string, string | number>;
}

/** The density of a kind other than normal, binomial and Poisson, from its parameter values; or the parameter that is out of range. */
export function densityFor(kind: DistributionKind, value: (field: DistributionField) => number): Density | BadParameter {
    const positive = (field: DistributionField, message: MessageKey): number | BadParameter => {
        const v = value(field);
        return v > 0 && Number.isFinite(v) ? v : { field, message };
    };
    const bad = (v: number | BadParameter): v is BadParameter => typeof v !== 'number';
    switch (kind) {
        case 'studentT':
        case 'chiSquare': {
            const df = positive('df', 'beyond.problem.dfPositive');
            if (bad(df)) return df;
            return kind === 'studentT' ? studentT(df) : chiSquare(df);
        }
        case 'exponential': {
            const rate = positive('rate', 'beyond.problem.ratePositive');
            return bad(rate) ? rate : exponential(rate);
        }
        case 'uniform': {
            const a = value('from');
            const b = value('to');
            if (!Number.isFinite(a)) return { field: 'from', message: 'beyond.problem.uniformOrder' };
            if (!(b > a) || !Number.isFinite(b)) return { field: 'to', message: 'beyond.problem.uniformOrder' };
            return uniform(a, b);
        }
        case 'gamma': {
            const shape = positive('shape', 'beyond.problem.shapePositive');
            if (bad(shape)) return shape;
            const rate = positive('rate', 'beyond.problem.ratePositive');
            return bad(rate) ? rate : gammaDensity(shape, rate);
        }
        case 'beta': {
            const a = positive('alpha', 'beyond.problem.alphaPositive');
            if (bad(a)) return a;
            const b = positive('beta', 'beyond.problem.betaPositive');
            return bad(b) ? b : betaDensity(a, b);
        }
        default: {
            // The normal one (binomial and Poisson are bars, read by the scene itself).
            const sd = positive('sd', 'beyond.problem.sdPositive');
            return bad(sd) ? sd : normalDensity(value('mean'), sd);
        }
    }
}

/** A result of densityFor is a parameter out of range. */
export function isBadParameter(d: Density | BadParameter): d is BadParameter {
    return 'message' in d;
}
