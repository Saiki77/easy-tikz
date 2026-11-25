/* 日本語: the machine learning pack (6.0 ML): the Help home section and the problems of the new NumPy calls. */
import type { Messages } from '../types';
import type { ml as en } from '../en/ml';

export const ml: Messages<typeof en> = {
    'ml.home.section': '機械学習',
    'ml.home.about': '最適化手法、分類器、学習するネットワーク、k-means、PCA、損失曲面。',

    'ml.numpy.real': '{name} は実数を取ります',
    'ml.numpy.matrix': '{name} は 2 次元の配列を取ります',
    'ml.numpy.covShapes': 'x と y の観測の数が同じである必要があります',
    'ml.numpy.bincount': 'bincount は 0 以上の整数を取ります',
    'ml.numpy.mvnShapes': '平均と共分散の大きさが合いません',
};
