import { test, assert, near } from './_lib';
import {
    BinaryNode,
    CallNode,
    CompileHook,
    ExprError,
    NumNode,
    applyEdits,
    closestName,
    compile,
    dollarMath,
    editDistance,
    isReservedName,
    linearForm,
    normalizeImplicitCalls,
    numberTokenSpan,
    parse,
    parseList,
    parseTuples,
    renameIdentifier,
    scanTemplate,
    splitName,
    texName,
    tokenize,
    topLevelColon,
    BUILTIN_FUNCTION_NAMES,
    CONSTANT_NAMES,
} from '../src/expr';
import { MathContext, ValidateResult } from '../src/mathcontext';
import { BUILT_IN_2D, BUILT_IN_3D } from '../src/templates';

/*
 * Backward compatibility: every entry was evaluated with the 3.19.6
 * closure compiler (git a42a47c, src/math.ts) at XS (one variable) or
 * PAIRS (two variables). The new engine must give bit-identical values.
 * Not included on purpose: relational chains such as `3 > 2 > 1`, which
 * 3.19.6 evaluated JavaScript-style ((3 > 2) > 1 = 0) and v4 reads as
 * `3 > 2 && 2 > 1` (see the chain tests below).
 */
const XS = [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7];
const PAIRS: Array<[number, number]> = [[-1, 2], [0.5, -1], [2, 0.5], [0, 0], [3, 3]];

const CORPUS: Array<[string, number[], 2?]> = [
    ['x^2', [6.25, 1, 0.25, 0, 0.09, 1, 4, 13.690000000000001]],
    ['x^3 - 3*x', [-8.125, 2, 1.375, 0, -0.8729999999999999, -2, 2, 39.553000000000004]],
    ['sin(x)', [-0.5984721441039564, -0.8414709848078965, -0.479425538604203, 0, 0.29552020666133955, 0.8414709848078965, 0.9092974268256817, -0.5298361409084934]],
    ['cos(x)', [-0.8011436155469337, 0.5403023058681398, 0.8775825618903728, 1, 0.955336489125606, 0.5403023058681398, -0.4161468365471424, -0.848100031710408]],
    ['sin(x) * exp(-x/5)', [-0.9867137539057053, -1.0277749817561193, -0.5298471626481189, 0, 0.2783104495911372, 0.6889381730850401, 0.6095202930098793, -0.2527921957734058]],
    ['exp(-x^2)', [0.0019304541362277093, 0.36787944117144233, 0.7788007830714049, 1, 0.9139311852712282, 0.36787944117144233, 0.01831563888873418, 1.1337271387479642e-06]],
    ['1 / (1 + exp(-x))', [0.07585818002124355, 0.2689414213699951, 0.3775406687981454, 0.5, 0.574442516811659, 0.7310585786300049, 0.8807970779778823, 0.9758729785823308]],
    ['1 / x', [-0.4, -1, -2, Infinity, 3.3333333333333335, 1, 0.5, 0.27027027027027023]],
    ['tan(x)', [0.7470222972386603, -1.5574077246549023, -0.5463024898437905, 0, 0.30933624960962325, 1.5574077246549023, -2.185039863261519, 0.6247330752245639]],
    ['sqrt(1 - x^2)', [NaN, 0, 0.8660254037844386, 1, 0.9539392014169457, 0, NaN, NaN]],
    ['1 + 2 * 3', [7, 7, 7, 7, 7, 7, 7, 7]],
    ['(1 + 2) * 3', [9, 9, 9, 9, 9, 9, 9, 9]],
    ['2 ^ 3 ^ 2', [512, 512, 512, 512, 512, 512, 512, 512]],
    ['2 ** 3 ** 2', [512, 512, 512, 512, 512, 512, 512, 512]],
    ['-x^2', [-6.25, -1, -0.25, -0, -0.09, -1, -4, -13.690000000000001]],
    ['-x**2', [-6.25, -1, -0.25, -0, -0.09, -1, -4, -13.690000000000001]],
    ['2^-x', [5.65685424949238, 2, 1.4142135623730951, 1, 0.8122523963562356, 0.5, 0.25, 0.07694652583405726]],
    ['2**-x', [5.65685424949238, 2, 1.4142135623730951, 1, 0.8122523963562356, 0.5, 0.25, 0.07694652583405726]],
    ['-2^2', [-4, -4, -4, -4, -4, -4, -4, -4]],
    ['(-2)^2', [4, 4, 4, 4, 4, 4, 4, 4]],
    ['x - -x', [-5, -2, -1, 0, 0.6, 2, 4, 7.4]],
    ['x - - - x', [0, 0, 0, 0, 0, 0, 0, 0]],
    ['+x', [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7]],
    ['- +x', [2.5, 1, 0.5, -0, -0.3, -1, -2, -3.7]],
    ['10 % 3', [1, 1, 1, 1, 1, 1, 1, 1]],
    ['x % 2', [-0.5, -1, -0.5, 0, 0.3, 1, 0, 1.7000000000000002]],
    ['-x % 3', [2.5, 1, 0.5, -0, -0.3, -1, -2, -0.7000000000000002]],
    ['7 / 2 / 2', [1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 1.75]],
    ['2 * 3 % 4', [2, 2, 2, 2, 2, 2, 2, 2]],
    ['x * -2', [5, 2, 1, -0, -0.6, -2, -4, -7.4]],
    ['1 - 2 - 3', [-4, -4, -4, -4, -4, -4, -4, -4]],
    ['2 / x * 3', [-2.4000000000000004, -6, -12, Infinity, 20, 6, 3, 1.6216216216216215]],
    ['x ^ 0.5', [NaN, NaN, NaN, 0, 0.5477225575051661, 1, 1.4142135623730951, 1.9235384061671346]],
    ['x ** 2 * 3', [18.75, 3, 0.75, 0, 0.27, 3, 12, 41.07000000000001]],
    ['3 * x ** 2', [18.75, 3, 0.75, 0, 0.27, 3, 12, 41.07000000000001]],
    ['(x)', [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7]],
    ['((((x))))', [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7]],
    ['!x', [0, 0, 0, 1, 0, 0, 0, 0]],
    ['!!x', [1, 1, 1, 0, 1, 1, 1, 1]],
    ['!0', [1, 1, 1, 1, 1, 1, 1, 1]],
    ['!(x > 1)', [1, 1, 1, 1, 1, 1, 0, 0]],
    ['-!x', [-0, -0, -0, -1, -0, -0, -0, -0]],
    ['!-x', [0, 0, 0, 1, 0, 0, 0, 0]],
    ['x^2^0.5', [NaN, NaN, NaN, 0, 0.1821955590293646, 1, 2.6651441426902256, 6.3614861258794235]],
    ['2^x^2', [76.10925536017415, 2, 1.189207115002721, 1, 1.0643701824533598, 2, 16, 13216.018583095329]],
    ['-(x)^2', [-6.25, -1, -0.25, -0, -0.09, -1, -4, -13.690000000000001]],
    ['x^-1', [-0.4, -1, -2, Infinity, 3.3333333333333335, 1, 0.5, 0.27027027027027023]],
    ['4 % -3', [1, 1, 1, 1, 1, 1, 1, 1]],
    ['-7 % 2.5', [-2, -2, -2, -2, -2, -2, -2, -2]],
    ['x - 1 - 2 * 3 / 4', [-5, -3.5, -3, -2.5, -2.2, -1.5, -0.5, 1.2000000000000002]],
    ['x > 1', [0, 0, 0, 0, 0, 0, 1, 1]],
    ['x >= 1', [0, 0, 0, 0, 0, 1, 1, 1]],
    ['x < 1', [1, 1, 1, 1, 1, 0, 0, 0]],
    ['x <= 1', [1, 1, 1, 1, 1, 1, 0, 0]],
    ['x == 1', [0, 0, 0, 0, 0, 1, 0, 0]],
    ['x != 1', [1, 1, 1, 1, 1, 0, 1, 1]],
    ['x === 1', [0, 0, 0, 0, 0, 1, 0, 0]],
    ['x !== 1', [1, 1, 1, 1, 1, 0, 1, 1]],
    ['(x > 1) + (x < 3)', [1, 1, 1, 1, 1, 1, 2, 1]],
    ['(x > 1) == (x < 3)', [0, 0, 0, 0, 0, 0, 1, 0]],
    ['x > 1 == 1', [0, 0, 0, 0, 0, 0, 1, 1]],
    ['x == 1 > 0', [0, 0, 0, 0, 0, 1, 0, 0]],
    ['x + 1 > 2 * x', [1, 1, 1, 1, 1, 0, 0, 0]],
    ['1 + (x > 0)', [1, 1, 1, 1, 2, 2, 2, 2]],
    ['x * (x > 0)', [-0, -0, -0, 0, 0.3, 1, 2, 3.7]],
    ['x >= x', [1, 1, 1, 1, 1, 1, 1, 1]],
    ['(x > 0) !== (x > 1)', [0, 0, 0, 0, 1, 1, 0, 0]],
    ['x > 0 && x < 2', [0, 0, 0, 0, 1, 1, 0, 0]],
    ['x < 0 || x > 1', [1, 1, 1, 0, 0, 0, 1, 1]],
    ['x < 0 || x > 1 && x > 5', [1, 1, 1, 0, 0, 0, 0, 0]],
    ['x && 0', [0, 0, 0, 0, 0, 0, 0, 0]],
    ['x || 5', [-2.5, -1, -0.5, 5, 0.3, 1, 2, 3.7]],
    ['0 || x', [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7]],
    ['x && x + 1', [-1.5, 0, 0.5, 0, 1.3, 2, 3, 4.7]],
    ['!(x > 0 && x < 1)', [1, 1, 1, 1, 0, 1, 1, 1]],
    ['x > 0 && x < 2 || x > 5', [0, 0, 0, 0, 1, 1, 0, 0]],
    ['(x < 0 || x > 1) && x < 3', [1, 1, 1, 0, 0, 0, 1, 0]],
    ['x < 0 ? -x : x', [2.5, 1, 0.5, 0, 0.3, 1, 2, 3.7]],
    ['x < 0 ? -1 : x < 1 ? 0 : 1', [-1, -1, -1, 0, 0, 1, 1, 1]],
    ['x < 0 ? (x < -1 ? -2 : -1) : 1', [-2, -1, -1, 1, 1, 1, 1, 1]],
    ['x > 0 ? x : x > -1 ? 0 : -x', [2.5, 1, 0, 0, 0.3, 1, 2, 3.7]],
    ['(x < 1 ? 1 : 2) * 10', [10, 10, 10, 10, 10, 20, 20, 20]],
    ['x < 1 ? x < 0 ? 0 : x : 1', [0, 0, 0, 0, 0.3, 1, 1, 1]],
    ['true ? x : 0', [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7]],
    ['false ? x : 2', [2, 2, 2, 2, 2, 2, 2, 2]],
    ['x ? 1 : 2', [1, 1, 1, 2, 1, 1, 1, 1]],
    ['1 + (x > 2 ? x^2 : 0)', [1, 1, 1, 1, 1, 1, 1, 14.690000000000001]],
    ['x <= 0 ? 0 : x <= 1 ? x^2 : 2*x - 1', [0, 0, 0, 0, 0.09, 1, 3, 6.4]],
    ['x > 0 && x < 1 ? 1 : 0', [0, 0, 0, 0, 1, 0, 0, 0]],
    ['Math.sin(x)', [-0.5984721441039564, -0.8414709848078965, -0.479425538604203, 0, 0.29552020666133955, 0.8414709848078965, 0.9092974268256817, -0.5298361409084934]],
    ['Math.cos(x) + Math.PI', [2.3404490380428595, 3.681894959457933, 4.019175215480166, 4.141592653589793, 4.096929142715399, 3.681894959457933, 2.7254458170426505, 2.293492621879385]],
    ['Math.pow(x, 3)', [-15.625, -1, -0.125, 0, 0.026999999999999996, 1, 8, 50.653000000000006]],
    ['Math.abs(x - 2)', [4.5, 3, 2.5, 2, 1.7, 1, 0, 1.7000000000000002]],
    ['Math.max(x, 1, 2)', [2, 2, 2, 2, 2, 2, 2, 3.7]],
    ['Math.min(x, 0)', [-2.5, -1, -0.5, 0, 0, 0, 0, 0]],
    ['Math.hypot(x, 3)', [3.905124837953328, 3.1622776601683795, 3.0413812651491092, 3, 3.0149626863362666, 3.1622776601683795, 3.6055512754639896, 4.763402145525822]],
    ['Math.hypot(x, 3, 4)', [5.5901699437494745, 5.0990195135927845, 5.024937810560445, 5, 5.008991914547277, 5.0990195135927845, 5.385164807134504, 6.220128616033595]],
    ['Math.log1p(x)', [NaN, -Infinity, -0.6931471805599453, 0, 0.26236426446749106, 0.6931471805599453, 1.0986122886681096, 1.547562508716013]],
    ['Math.expm1(x)', [-0.9179150013761013, -0.6321205588285577, -0.3934693402873666, 0, 0.3498588075760031, 1.718281828459045, 6.38905609893065, 39.4473043600674]],
    ['Math.fround(x)', [-2.5, -1, -0.5, 0, 0.30000001192092896, 1, 2, 3.700000047683716]],
    ['Math.E', [2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045]],
    ['Math.SQRT1_2 * x', [-1.7677669529663689, -0.7071067811865476, -0.3535533905932738, 0, 0.21213203435596426, 0.7071067811865476, 1.4142135623730951, 2.616295090390226]],
    ['Math.LN2', [0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453]],
    ['Math.LN10', [2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046]],
    ['Math.LOG2E', [1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634]],
    ['Math.LOG10E', [0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518]],
    ['Math.SQRT2', [1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951]],
    ['Math.sign(x)', [-1, -1, -1, 0, 1, 1, 1, 1]],
    ['Math.trunc(x)', [-2, -1, -0, 0, 0, 1, 2, 3]],
    ['Math.round(x)', [-2, -1, -0, 0, 0, 1, 2, 4]],
    ['Math.floor(x)', [-3, -1, -1, 0, 0, 1, 2, 3]],
    ['Math.ceil(x)', [-2, -1, -0, 0, 1, 1, 2, 4]],
    ['Math.cbrt(x)', [-1.3572088082974532, -1, -0.7937005259840998, 0, 0.6694329500821695, 1, 1.2599210498948732, 1.5466803737720356]],
    ['Math.atan2(x, 2)', [-0.8960553845713439, -0.4636476090008061, -0.24497866312686414, 0, 0.14888994760949725, 0.4636476090008061, 0.7853981633974483, 1.075244653309068]],
    ['Math.asinh(x)', [-1.6472311463710958, -0.881373587019543, -0.48121182505960347, 0, 0.29567304756342244, 0.881373587019543, 1.4436354751788103, 2.0192606561549606]],
    ['Math.acosh(x + 2)', [NaN, 0, 0.9624236501192069, 1.3169578969248166, 1.475044781241425, 1.7627471740390859, 2.0634370688955608, 2.42582831808226]],
    ['Math.atanh(x / 10)', [-0.25541281188299536, -0.10033534773107558, -0.05004172927849127, 0, 0.030009004863126472, 0.10033534773107558, 0.2027325540540822, 0.38842309971829614]],
    ['Math.log(x)', [NaN, NaN, NaN, -Infinity, -1.2039728043259361, 0, 0.6931471805599453, 1.308332819650179]],
    ['Math.log2(x)', [NaN, NaN, NaN, -Infinity, -1.7369655941662063, 0, 1, 1.8875252707415875]],
    ['Math.log10(x)', [NaN, NaN, NaN, -Infinity, -0.5228787452803376, 0, 0.3010299956639812, 0.568201724066995]],
    ['Math.exp(Math.sin(x))', [0.549650782071877, 0.43107595064559234, 0.6191389610977313, 1, 1.3438252437316534, 2.319776824715853, 2.4825777280150003, 0.588701425856338]],
    ['Math.sqrt(Math.abs(x))', [1.5811388300841898, 1, 0.7071067811865476, 0, 0.5477225575051661, 1, 1.4142135623730951, 1.9235384061671346]],
    ['sin(x)', [-0.5984721441039564, -0.8414709848078965, -0.479425538604203, 0, 0.29552020666133955, 0.8414709848078965, 0.9092974268256817, -0.5298361409084934]],
    ['cos(x)', [-0.8011436155469337, 0.5403023058681398, 0.8775825618903728, 1, 0.955336489125606, 0.5403023058681398, -0.4161468365471424, -0.848100031710408]],
    ['tan(x)', [0.7470222972386603, -1.5574077246549023, -0.5463024898437905, 0, 0.30933624960962325, 1.5574077246549023, -2.185039863261519, 0.6247330752245639]],
    ['asin(x/10)', [-0.25268025514207865, -0.1001674211615598, -0.050020856805770016, 0, 0.030004501823476935, 0.1001674211615598, 0.2013579207903308, 0.3790090206959508]],
    ['acos(x/10)', [1.8234765819369754, 1.6709637479564565, 1.6208171836006666, 1.5707963267948966, 1.5407918249714196, 1.4706289056333368, 1.369438406004566, 1.191787306098946]],
    ['atan(x)', [-1.1902899496825317, -0.7853981633974483, -0.4636476090008061, 0, 0.2914567944778671, 0.7853981633974483, 1.1071487177940904, 1.3068326031691921]],
    ['atan2(1, x)', [2.761086276477428, 2.356194490192345, 2.0344439357957027, 1.5707963267948966, 1.2793395323170296, 0.7853981633974483, 0.4636476090008061, 0.2639637236257045]],
    ['sinh(x)', [-6.0502044810397875, -1.1752011936438014, -0.5210953054937474, 0, 0.3045202934471426, 1.1752011936438014, 3.626860407847019, 20.21129041679853]],
    ['cosh(x)', [6.132289479663686, 1.5430806348152437, 1.1276259652063807, 1, 1.0453385141288605, 1.5430806348152437, 3.7621956910836314, 20.23601394326887]],
    ['tanh(x)', [-0.9866142981514303, -0.7615941559557649, -0.46211715726000974, 0, 0.2913126124515909, 0.7615941559557649, 0.9640275800758169, 0.9987782412811312]],
    ['asinh(x)', [-1.6472311463710958, -0.881373587019543, -0.48121182505960347, 0, 0.29567304756342244, 0.881373587019543, 1.4436354751788103, 2.0192606561549606]],
    ['acosh(x+2)', [NaN, 0, 0.9624236501192069, 1.3169578969248166, 1.475044781241425, 1.7627471740390859, 2.0634370688955608, 2.42582831808226]],
    ['atanh(x/10)', [-0.25541281188299536, -0.10033534773107558, -0.05004172927849127, 0, 0.030009004863126472, 0.10033534773107558, 0.2027325540540822, 0.38842309971829614]],
    ['exp(x)', [0.0820849986238988, 0.36787944117144233, 0.6065306597126334, 1, 1.3498588075760032, 2.718281828459045, 7.38905609893065, 40.4473043600674]],
    ['log(x)', [NaN, NaN, NaN, -Infinity, -1.2039728043259361, 0, 0.6931471805599453, 1.308332819650179]],
    ['log2(x)', [NaN, NaN, NaN, -Infinity, -1.7369655941662063, 0, 1, 1.8875252707415875]],
    ['log10(x)', [NaN, NaN, NaN, -Infinity, -0.5228787452803376, 0, 0.3010299956639812, 0.568201724066995]],
    ['sqrt(x)', [NaN, NaN, NaN, 0, 0.5477225575051661, 1, 1.4142135623730951, 1.9235384061671346]],
    ['cbrt(x)', [-1.3572088082974532, -1, -0.7937005259840998, 0, 0.6694329500821695, 1, 1.2599210498948732, 1.5466803737720356]],
    ['pow(x, 2)', [6.25, 1, 0.25, 0, 0.09, 1, 4, 13.690000000000001]],
    ['abs(x)', [2.5, 1, 0.5, 0, 0.3, 1, 2, 3.7]],
    ['sign(x)', [-1, -1, -1, 0, 1, 1, 1, 1]],
    ['floor(x)', [-3, -1, -1, 0, 0, 1, 2, 3]],
    ['ceil(x)', [-2, -1, -0, 0, 1, 1, 2, 4]],
    ['round(x)', [-2, -1, -0, 0, 0, 1, 2, 4]],
    ['trunc(x)', [-2, -1, -0, 0, 0, 1, 2, 3]],
    ['min(x, 1)', [-2.5, -1, -0.5, 0, 0.3, 1, 1, 1]],
    ['max(x, 1, 3)', [3, 3, 3, 3, 3, 3, 3, 3.7]],
    ['hypot(x, 1)', [2.6925824035672523, 1.4142135623730951, 1.118033988749895, 1, 1.044030650891055, 1.4142135623730951, 2.23606797749979, 3.83275357934736]],
    ['min(x)', [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7]],
    ['max(1, 2, 3, x)', [3, 3, 3, 3, 3, 3, 3, 3.7]],
    ['round(x + 0.5)', [-2, -0, 0, 1, 1, 2, 3, 4]],
    ['round(-2.5 + x - x)', [-2, -2, -2, -2, -2, -2, -2, -2]],
    ['PI', [3.141592653589793, 3.141592653589793, 3.141592653589793, 3.141592653589793, 3.141592653589793, 3.141592653589793, 3.141592653589793, 3.141592653589793]],
    ['E', [2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045, 2.718281828459045]],
    ['LN2', [0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453, 0.6931471805599453]],
    ['LN10', [2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046, 2.302585092994046]],
    ['LOG2E', [1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634, 1.4426950408889634]],
    ['LOG10E', [0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518, 0.4342944819032518]],
    ['SQRT2', [1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951, 1.4142135623730951]],
    ['PI * x', [-7.853981633974483, -3.141592653589793, -1.5707963267948966, 0, 0.9424777960769379, 3.141592653589793, 6.283185307179586, 11.623892818282235]],
    ['2*PI', [6.283185307179586, 6.283185307179586, 6.283185307179586, 6.283185307179586, 6.283185307179586, 6.283185307179586, 6.283185307179586, 6.283185307179586]],
    ['E^x', [0.08208499862389881, 0.36787944117144233, 0.6065306597126334, 1, 1.3498588075760032, 2.718281828459045, 7.3890560989306495, 40.44730436006739]],
    ['true', [1, 1, 1, 1, 1, 1, 1, 1]],
    ['false', [0, 0, 0, 0, 0, 0, 0, 0]],
    ['true + 1', [2, 2, 2, 2, 2, 2, 2, 2]],
    ['x * true', [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7]],
    ['sin(cos(tan(x)))', [0.6696336019973689, 0.013387802193205699, 0.7542107560326126, 0.8414709848078965, 0.8148879447955204, 0.013387802193205699, -0.5449592372801408, 0.7250584537666713]],
    ['sqrt(abs(sin(x) * cos(x)) + 1)', [1.2163314257765312, 1.2060881864162507, 1.1919460945881521, 1, 1.1323962366139857, 1.2060881864162507, 1.1740533410599214, 1.2038912109928428]],
    ['((x + 1) * (x - 1)) / ((x + 2) * (x - 2))', [2.3333333333333335, 0, 0.2, 0.25, 0.23273657289002558, -0, Infinity, 1.3095975232198143]],
    ['exp(-((x - 1)^2) / (2 * 0.5^2)) / (0.5 * sqrt(2 * PI))', [1.826944081672919e-11, 0.00026766045152977074, 0.008863696823876015, 0.10798193302637613, 0.29945493127148975, 0.7978845608028654, 0.10798193302637613, 3.7147236891105794e-07]],
    ['max(min(x, 2), -2)', [-2, -1, -0.5, 0, 0.3, 1, 2, 2]],
    ['pow(sin(x), 2) + pow(cos(x), 2)', [0.9999999999999999, 1, 1, 1, 1, 1, 1, 1]],
    ['log(exp(x))', [-2.5, -1, -0.5, 0, 0.30000000000000004, 1, 2, 3.7]],
    ['1/(1+1/(1+1/(1+x)))', [0.25000000000000006, 1, 0.75, 0.6666666666666666, 0.6388888888888888, 0.6000000000000001, 0.5714285714285714, 0.5480769230769231]],
    ['sin(sin(sin(sin(sin(sin(x))))))', [-0.46826220283253217, -0.5540163907556296, -0.40534569446004987, 0, 0.2758152173834237, 0.5540163907556296, 0.5699658928122394, -0.4339125009404368]],
    ['(((((x + 1) * 2) - 3) / 4) ^ 2)', [2.25, 0.5625, 0.25, 0.0625, 0.009999999999999995, 0.0625, 0.5625, 2.5600000000000005]],
    ['  x  ^  2  ', [6.25, 1, 0.25, 0, 0.09, 1, 4, 13.690000000000001]],
    ['x\t+\n1', [-1.5, 0, 0.5, 1, 1.3, 2, 3, 4.7]],
    ['2*x+1', [-4, -1, 0, 1, 1.6, 3, 5, 8.4]],
    [' sin ( x ) ', [-0.5984721441039564, -0.8414709848078965, -0.479425538604203, 0, 0.29552020666133955, 0.8414709848078965, 0.9092974268256817, -0.5298361409084934]],
    ['\r\nx', [-2.5, -1, -0.5, 0, 0.3, 1, 2, 3.7]],
    ['x  *  x', [6.25, 1, 0.25, 0, 0.09, 1, 4, 13.690000000000001]],
    ['.5 * x', [-1.25, -0.5, -0.25, 0, 0.15, 0.5, 1, 1.85]],
    ['2. * x', [-5, -2, -1, 0, 0.6, 2, 4, 7.4]],
    ['1e3 * x', [-2500, -1000, -500, 0, 300, 1000, 2000, 3700]],
    ['1E-3 + x', [-2.499, -0.999, -0.499, 0.001, 0.301, 1.001, 2.001, 3.701]],
    ['1.5e+2', [150, 150, 150, 150, 150, 150, 150, 150]],
    ['0.1 + 0.2', [0.30000000000000004, 0.30000000000000004, 0.30000000000000004, 0.30000000000000004, 0.30000000000000004, 0.30000000000000004, 0.30000000000000004, 0.30000000000000004]],
    ['00012', [12, 12, 12, 12, 12, 12, 12, 12]],
    ['3.14159 * x', [-7.853975, -3.14159, -1.570795, 0, 0.9424769999999999, 3.14159, 6.28318, 11.623883]],
    ['1e-7 * x', [-2.5e-07, -1e-07, -5e-08, 0, 3e-08, 1e-07, 2e-07, 3.7e-07]],
    ['sin(sqrt(x^2 + y^2))', [0.786749131547214, 0.8992421466037851, 0.8819765842751007, 0, -0.8916822544789358], 2],
    ['x^2 + y^2', [5, 1.25, 4.25, 0, 18], 2],
    ['x*y', [-2, -0.5, 1, 0, 9], 2],
    ['exp(-(x^2 + y^2) / 4)', [0.2865047968601901, 0.7316156289466418, 0.3455907525769745, 1, 0.011108996538242306], 2],
    ['cos(x) + sin(y)', [1.4495997326938215, 0.036111577082476254, 0.0632787020570606, 1, -0.8488724885405782], 2],
    ['x^2 - y^2', [-3, -0.75, 3.75, 0, 0], 2],
    ['x*y + y', [0, -1.5, 1.5, 0, 12], 2],
    ['x / y', [-0.5, -0.5, 4, NaN, 1], 2],
    ['atan2(y, x)', [2.0344439357957027, -1.1071487177940904, 0.24497866312686414, 0, 0.7853981633974483], 2],
    ['x > y ? x : y', [2, 0.5, 2, 0, 3], 2],
    ['hypot(x, y)', [2.23606797749979, 1.118033988749895, 2.0615528128088303, 0, 4.242640687119286], 2],
    ['x^2 + y^2 <= 4', [0, 1, 0, 1, 0], 2],
    ['sin(x) * cos(y)', [0.35017548837401463, 0.2590347239999257, 0.7979835653540055, 0, -0.13970774909946293], 2],
    ['x*y > 0 && x + y < 2', [0, 0, 0, 0, 0], 2],
    ['x - y * 2', [-5, 2.5, 1, 0, -3], 2],
    ['min(x, y)', [-1, -1, 0.5, 0, 3], 2],
    ['Math.max(x, y)', [2, 0.5, 2, 0, 3], 2],
    ['(x + y) % 2', [1, -0.5, 0.5, 0, 0], 2],
];

const plain = () => MathContext.create({});

function withParams(names: string[], extra: Partial<Parameters<typeof MathContext.create>[0]> = {}): MathContext {
    return MathContext.create({
        parameters: names.map((name, i) => ({ name, value: i + 2, min: -10, max: 10, step: 0.1 })),
        ...extra,
    });
}

function fail(r: ValidateResult): Exclude<ValidateResult, { ok: true }> {
    if (r.ok) throw new Error('expected a validation error');
    return r;
}

function throws(fn: () => unknown, message: string | RegExp): ExprError {
    try {
        fn();
    } catch (e) {
        assert.ok(e instanceof ExprError, `expected ExprError, got ${String(e)}`);
        if (typeof message === 'string') assert.equal(e.message, message);
        else assert.match(e.message, message);
        return e;
    }
    throw new Error(`expected ExprError: ${String(message)}`);
}

// ---------------------------------------------------------------- corpus

test('3.19.6 corpus: identical values (212 expressions)', () => {
    assert.ok(CORPUS.length >= 120);
    const ctx = plain();
    for (const [src, expected, dim] of CORPUS) {
        if (dim === 2) {
            const f = ctx.fn2(src);
            PAIRS.forEach(([x, y], i) => {
                assert.ok(Object.is(f(x, y), expected[i]), `${JSON.stringify(src)} at (${x}, ${y}): ${f(x, y)} != ${expected[i]}`);
            });
        } else {
            const f = ctx.fn1(src);
            XS.forEach((x, i) => {
                assert.ok(Object.is(f(x), expected[i]), `${JSON.stringify(src)} at ${x}: ${f(x)} != ${expected[i]}`);
            });
        }
    }
});

test('current built-in templates compile, domains resolve', () => {
    const ctx = plain();
    for (const t of BUILT_IN_2D) {
        assert.ok(ctx.validate(t.expression, 'fn1').ok, t.expression);
        const [lo, hi] = ctx.domain(t.domain);
        assert.ok(lo < hi, t.domain);
        assert.ok(Number.isFinite(ctx.fn1(t.expression)((lo + hi) / 2 + 0.01)) || t.expression === 'tan(x)');
    }
    for (const t of BUILT_IN_3D) {
        assert.ok(ctx.validate(t.expression, 'fn2').ok, t.expression);
        ctx.domain(t.xDomain);
        ctx.domain(t.yDomain);
    }
    // 'x^3 - 3x' (implicit multiplication) is new in v4.
    near(ctx.fn1('x^3 - 3x')(2), 2);
});

// ------------------------------------------------------------- tokenizer

test('tokenizer: numbers, exponents only with digits, unicode', () => {
    const texts = (s: string) => tokenize(s).map((t) => t.text);
    assert.deepEqual(texts('2e'), ['2', 'e', '']);
    assert.deepEqual(texts('2e-x'), ['2', 'e', '-', 'x', '']);
    assert.deepEqual(texts('2e3 + 1.5E-2 + .5 + 3.'), ['2e3', '+', '1.5E-2', '+', '.5', '+', '3.', '']);
    assert.deepEqual(texts('x ≤ 2 ≥ y ≠ π θ'), ['x', '<=', '2', '>=', 'y', '!=', 'π', 'θ', '']);
    assert.deepEqual(texts('a === b !== c ** d'), ['a', '===', 'b', '!==', 'c', '**', 'd', '']);
    const ctx = plain();
    near(ctx.fn1('2e')(0), 2 * Math.E);
    near(ctx.fn1('2e-x')(1), 2 * Math.E - 1);
    near(ctx.fn1('2e3')(0), 2000);
    near(ctx.fn1('2πx')(1), 2 * Math.PI);
    throws(() => tokenize('x # 2'), "Unexpected character '#'");
});

test("tokenizer: a '.'-led number glued to an operand is a typo, not a product", () => {
    const ctx = plain();
    const typos: Array<[string, 'value' | 'fn1', number]> = [
        ['1..5', 'value', 2],
        ['1.2.3', 'value', 3],
        ['.5.5', 'value', 2],
        ['1.5e3.2', 'value', 5],
        ['x.5', 'fn1', 1],
        ['sin(x).5', 'fn1', 6],
    ];
    for (const [src, kind, pos] of typos) {
        const r = fail(ctx.validate(src, kind));
        assert.equal(r.message, "Unexpected '.': write one decimal point per number, or * to multiply", src);
        assert.equal(r.pos, pos, src);
    }
    throws(() => ctx.values('1..5, 2'), "Unexpected '.': write one decimal point per number, or * to multiply");
    // Spaced, explicit and member forms keep working.
    near(ctx.value('3 .5'), 1.5);
    near(ctx.value('2^.5'), Math.SQRT2);
    near(ctx.fn1('x*.5')(4), 2);
    near(ctx.fn1('2.x')(3), 6);
    near(ctx.value('Math.PI'), Math.PI);
    assert.equal(ctx.value('3 4'), 12);
});

// ------------------------------------------------------------ precedence

test('precedence: unary minus, right-assoc powers, !', () => {
    const f = (s: string, x = 3) => plain().fn1(s)(x);
    assert.equal(f('-x^2'), -9);
    assert.equal(f('-x**2'), -9);
    assert.equal(f('2^-x', 1), 0.5);
    assert.equal(f('2^3^2'), 512);
    assert.equal(f('2**3**2'), 512);
    assert.equal(f('-2^2'), -4);
    assert.equal(f('(-2)^2'), 4);
    assert.equal(f('--x'), 3);
    assert.equal(f('-+-x'), 3);
    assert.equal(f('!x', 0), 1);
    assert.equal(f('!x', 2), 0);
    assert.equal(f('!x + 1', 0), 2);
    assert.equal(f('!(x > 1) * 5', 0), 5);
    assert.equal(f('2 * 3 + 4 * 5'), 26);
    assert.equal(f('10 - 4 - 3'), 3);
    assert.equal(f('64 / 4 / 2'), 8);
    assert.equal(f('7 % 4 * 2'), 6);
    assert.equal(f('1 + 2 < 4'), 1);
});

test('implicit multiplication', () => {
    const ctx = withParams(['a', 'b']);
    const f = (s: string, x = 3) => ctx.fn1(s)(x);
    assert.equal(f('2x'), 6);
    assert.equal(f('3(x+1)'), 12);
    assert.equal(f('(x+1)(x-1)'), 8);
    near(f('2 pi'), 2 * Math.PI);
    near(f('2pi'), 2 * Math.PI);
    assert.equal(ctx.fn2('x y')(2, 5), 10);
    assert.equal(f('1/2x', 4), 2);
    assert.equal(f('2 a b'), 2 * 2 * 3);
    assert.equal(f('2x^2'), 18);
    assert.equal(f('2 sin(x)', 0), 0);
    near(f('2 sin(x) cos(x)', 1), Math.sin(2));
    assert.equal(f('x(x+1)'), 12);
    assert.equal(f('a(x+1)'), 8);
    assert.equal(f('-2x'), -6);
    assert.equal(f('x 2'), 6);
    assert.equal(f('(x)(2)(3)'), 18);
    assert.equal(f('2(3)(4)'), 24);
    // `ax` is ONE identifier (and an error with a quick fix), never a*x.
    assert.equal(fail(ctx.validate('ax', 'fn1')).message, "Unknown name 'ax'. Did you mean a*x?");
});

test('comparison chains mean AND (value 1 / 0)', () => {
    const ctx = plain();
    const f = ctx.fn1('0 < x < 2');
    assert.equal(f(1), 1);
    assert.equal(f(3), 0);
    assert.equal(f(-1), 0);
    assert.equal(ctx.fn1('3 > 2 > 1')(0), 1);
    assert.equal(ctx.fn1('1 < 2 <= 2 < 3')(0), 1);
    assert.equal(ctx.fn1('1 < 2 <= 1.5')(0), 0);
    assert.equal(ctx.fn1('0 <= x <= 1 ? 5 : 7')(0.5), 5);
    assert.equal(ctx.fn2('0 <= x <= y <= 4')(1, 2), 1);
    assert.equal(ctx.fn2('0 <= x <= y <= 4')(3, 2), 0);
    assert.equal(ctx.fn1('x ≤ 1')(1), 1);
});

test('and / or keywords and && / || precedence', () => {
    const ctx = plain();
    assert.equal(ctx.fn1('x > 0 and x < 1')(0.5), 1);
    assert.equal(ctx.fn1('x > 0 and x < 1')(2), 0);
    assert.equal(ctx.fn1('x < 0 or x > 1')(2), 1);
    // and binds tighter than or (pgfmath does not: the printer parenthesises).
    assert.equal(ctx.fn1('x < 0 or x > 1 and x > 5')(-1), 1);
    assert.equal(ctx.fn1('x < 0 || x > 1 && x > 5')(2), 0);
    assert.equal(ctx.fn1('(x < 0 or x > 1) and x < 5')(2), 1);
    throws(() => ctx.fn1('x and'), 'Unexpected end of expression');
    throws(() => ctx.fn1('and x'), "Unexpected 'and'");
});

test('Math members, constants and own-property lookups', () => {
    const ctx = plain();
    near(ctx.fn1('Math.PI + Math.E + Math.SQRT1_2')(0), Math.PI + Math.E + Math.SQRT1_2);
    near(ctx.fn1('Math.log1p(x) + Math.expm1(x) + Math.fround(x)')(0.5), Math.log1p(0.5) + Math.expm1(0.5) + Math.fround(0.5));
    near(ctx.fn1('pi + e + PI + E + π')(0), 3 * Math.PI + 2 * Math.E);
    near(ctx.fn1('ln(x) + sec(x) + csc(x) + cot(x)')(1), Math.log(1) + 1 / Math.cos(1) + 1 / Math.sin(1) + 1 / Math.tan(1));
    assert.equal(ctx.fn1('true + true + false')(0), 2);
    const r = ctx.fn1('random()')(0);
    assert.ok(r >= 0 && r < 1);
    throws(() => ctx.fn1('constructor'), "Unknown name 'constructor'");
    throws(() => ctx.fn1('toString(x)'), /^Unknown function 'toString'/);
    throws(() => ctx.fn1('Math.constructor'), "Unknown name 'Math.constructor'");
    throws(() => ctx.fn1('Math.ln(x)'), "Unknown function 'Math.ln'");
    throws(() => ctx.fn1('Math.hasOwnProperty(x)'), /^Unknown function 'Math.hasOwnProperty'/);
    throws(() => ctx.fn1('__proto__'), "Unknown name '__proto__'");
    throws(() => ctx.fn1('sin'), 'sin is a function: write sin(...)');
    throws(() => ctx.fn1('Math'), 'Write Math.name, e.g. Math.PI');
    throws(() => ctx.fn1('sin(x, 2)'), 'sin takes 1 argument');
    throws(() => ctx.fn1('atan2(x)'), 'atan2 takes 2 arguments');
    throws(() => ctx.fn1('max()'), 'max takes at least 1 argument');
});

test('syntax errors are positioned', () => {
    const ctx = plain();
    let e = throws(() => ctx.fn1('(x + 1'), "Missing ')'");
    assert.equal(e.pos, 0);
    e = throws(() => ctx.fn1('x + * 2'), "Unexpected '*'");
    assert.equal(e.pos, 4);
    throws(() => ctx.fn1('x +'), 'Unexpected end of expression');
    throws(() => ctx.fn1('x)'), "Unexpected ')'");
    throws(() => ctx.fn1('x = 2'), 'Use == to compare (= is only for equations)');
    throws(() => ctx.fn1('x ? 1'), "Missing ':' in a ? b : c");
    throws(() => ctx.fn1('   '), 'Enter an expression');
});

// ------------------------------------------------------------ quick fixes

test('quick fix rule 1: unknown function -> closest name, no slider', () => {
    const ctx = MathContext.create({ functions: [{ name: 'growth', expression: 'x^2', domain: '' } as never] });
    let r = fail(ctx.validate('sni(x)', 'fn1'));
    assert.equal(r.message, "Unknown function 'sni'");
    assert.deepEqual(r.fix, { label: 'Use sin', rewrite: 'sin(x)' });
    assert.equal(r.unknown, undefined);
    r = fail(ctx.validate('2 + sqr(x)', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Use sqrt', rewrite: '2 + sqrt(x)' });
    r = fail(ctx.validate('grwth(x)', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Use growth', rewrite: 'growth(x)' });
    r = fail(ctx.validate('qqqqq(x)', 'fn1'));
    assert.equal(r.message, "Unknown function 'qqqqq'");
    assert.equal(r.fix, undefined);
    r = fail(ctx.validate('Math.sni(x)', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Use Math.sin', rewrite: 'Math.sin(x)' });
    // A known name in front of a function: x*sin.
    r = fail(ctx.validate('xsin(x)', 'fn1'));
    assert.equal(r.message, "Unknown function 'xsin'. Did you mean x*sin?");
    assert.deepEqual(r.fix, { label: 'Use x*sin', rewrite: 'x*sin(x)' });
});

test('quick fix: a product written as a call (ax(x - 2)) is not max(x - 2)', () => {
    const ctx = withParams(['a', 'k']);
    let r = fail(ctx.validate('ax(x+1)', 'fn1'));
    assert.equal(r.message, "Unknown function 'ax'. Did you mean a*x?");
    assert.deepEqual(r.fix, { label: 'Use a*x', rewrite: 'a*x(x+1)' });
    assert.equal(ctx.fn1(r.fix?.rewrite ?? '')(2), 2 * 2 * 3, 'a*x*(x + 1) with a = 2');
    assert.deepEqual(fail(ctx.validate('ax(x - 2)', 'fn1')).fix, { label: 'Use a*x', rewrite: 'a*x(x - 2)' });
    assert.deepEqual(fail(ctx.validate('2ax(x+1)', 'fn1')).fix, { label: 'Use a*x', rewrite: '2a*x(x+1)' });
    assert.deepEqual(fail(ctx.validate('kx(x-1)', 'fn1')).fix, { label: 'Use k*x', rewrite: 'k*x(x-1)' });
    assert.deepEqual(fail(ctx.validate('pix(x)', 'fn1')).fix, { label: 'Use pi*x', rewrite: 'pi*x(x)' });
    // A new letter gets its slider in the same step.
    r = fail(plain().validate('kx(x-1)', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Use k*x, add slider k', rewrite: 'k*x(x-1)', addParameter: 'k' });
    // Close builtin names still win where the product has no axis variable.
    assert.deepEqual(fail(ctx.validate('ex(x - 1)', 'fn1')).fix, { label: 'Use exp', rewrite: 'exp(x - 1)' });
    assert.deepEqual(fail(withParams(['a', 'b']).validate('ab(x)', 'fn1')).fix, { label: 'Use abs', rewrite: 'abs(x)' });
    assert.deepEqual(fail(withParams(['a', 'c']).validate('ac(x)', 'fn1')).fix, { label: 'Use a*c', rewrite: 'a*c(x)' });
    assert.deepEqual(fail(ctx.validate('xsin(x)', 'fn1')).fix, { label: 'Use x*sin', rewrite: 'x*sin(x)' });
});

test('quick fix: builtins written without parentheses (sinx), never a slider', () => {
    const ctx = plain();
    const call = (src: string, kind: 'fn1' | 'fn2' = 'fn1', c: MathContext = ctx, fnKind?: 'parametric') => {
        const r = fail(c.validate(src, kind, fnKind));
        assert.equal(r.unknown, undefined, src);
        assert.equal(r.fix?.addParameter, undefined, src);
        return r.fix?.rewrite;
    };
    let r = fail(ctx.validate('sinx', 'fn1'));
    assert.equal(r.message, "Unknown name 'sinx'. Did you mean sin(x)?");
    assert.deepEqual(r.fix, { label: 'Use sin(x)', rewrite: 'sin(x)' });
    assert.equal(call('cosx'), 'cos(x)');
    assert.equal(call('lnx'), 'ln(x)');
    assert.equal(call('sqrtx'), 'sqrt(x)');
    assert.equal(call('2sinx'), '2sin(x)');
    assert.equal(call('sinx^2'), 'sin(x)^2');
    assert.equal(call('sin2x'), 'sin(2*x)');
    assert.equal(call('xsinx'), 'x*sin(x)');
    assert.equal(call('sinxcosx'), 'sin(x)*cos(x)');
    assert.equal(call('sinhx'), 'sinh(x)', 'longest builtin first');
    assert.equal(call('log10x'), 'log10(x)');
    assert.equal(call('expx'), 'exp(x)', 'not e*x*p*x');
    assert.equal(call('sinax', 'fn1', withParams(['a'])), 'sin(a*x)');
    assert.equal(call('sinxy', 'fn2'), 'sin(x*y)');
    assert.equal(call('sint', 'fn1', ctx, 'parametric'), 'sin(t)');
    for (const src of ['sinx', '2sinx', 'sin2x', 'xsinx', 'sinxcosx', 'expx']) {
        assert.ok(ctx.validate(call(src) ?? '', 'fn1').ok, `${src} rewrite validates`);
    }
    near(ctx.fn1('sin(2*x)')(1), Math.sin(2));
    // Names that only start like a builtin stay slider names.
    assert.deepEqual(fail(ctx.validate('cost', 'fn1')).fix, { label: 'Add slider cost', addParameter: 'cost' });
    assert.deepEqual(fail(ctx.validate('minx', 'fn1')).fix, { label: 'Add slider minx', addParameter: 'minx' });
    assert.deepEqual(fail(ctx.validate('sinq', 'fn1')).fix, { label: 'Add slider sinq', addParameter: 'sinq' });
    assert.deepEqual(fail(ctx.validate('sint', 'fn1')).fix, { label: 'Add slider sint', addParameter: 'sint' }, 'no t in f(x)');
    // `sin x`: a builtin used as a value, followed by a simple operand.
    r = fail(ctx.validate('sin x + 1', 'fn1'));
    assert.equal(r.message, 'sin is a function: write sin(...)');
    assert.deepEqual(r.fix, { label: 'Use sin(x)', rewrite: 'sin(x) + 1' });
    assert.deepEqual(fail(ctx.validate('2 sin 2x', 'fn1')).fix, { label: 'Use sin(2x)', rewrite: '2 sin(2x)' });
    assert.equal(fail(ctx.validate('sin x^2', 'fn1')).fix, undefined, 'ambiguous: sin(x^2) or sin(x)^2');
    assert.equal(fail(ctx.validate('sin', 'fn1')).fix, undefined);
});

test('quick fix rule 2: names that split into known names', () => {
    const ctx = withParams(['a', 'b']);
    let r = fail(ctx.validate('ax + by', 'fn2'));
    assert.equal(r.message, "Unknown name 'ax'. Did you mean a*x?");
    assert.deepEqual(r.fix, { label: 'Use a*x', rewrite: 'a*x + by' });
    assert.equal(r.unknown, undefined);
    r = fail(ctx.validate(r.fix?.rewrite ?? '', 'fn2'));
    assert.deepEqual(r.fix, { label: 'Use b*y', rewrite: 'a*x + b*y' });
    assert.ok(ctx.validate('a*x + b*y', 'fn2').ok);
    r = fail(ctx.validate('xy', 'fn2'));
    assert.deepEqual(r.fix, { label: 'Use x*y', rewrite: 'x*y' });
    r = fail(ctx.validate('2pix', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Use pi*x', rewrite: '2pi*x' });
    // New single letters: 'cx' (c unknown, x known) and two-letter names.
    r = fail(plain().validate('cx', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Use c*x, add slider c', rewrite: 'c*x', addParameter: 'c' });
    assert.equal(r.unknown, undefined);
    // A split that needs a variable this field does not have only trades one error for another.
    r = fail(plain().validate('tx', 'fn1'));
    assert.equal(r.message, "Unknown name 'tx'. t is not available here: f(x) uses x only");
    assert.equal(r.fix, undefined);
    r = fail(plain().validate('xy', 'fn1'));
    assert.equal(r.message, "Unknown name 'xy'. y is not available here: f(x) uses x only");
    assert.equal(r.fix, undefined);
    r = fail(plain().validate('cy', 'fn1'));
    assert.equal(r.message, "Unknown name 'cy'. y is not available here: f(x) uses x only");
    r = fail(withParams(['k']).validate('kx', 'value'));
    assert.equal(r.message, "Unknown name 'kx'. x is not available here: this field takes a number");
    assert.equal(r.fix, undefined);
    // The rewrite replaces the name only, never the parentheses around it.
    r = fail(withParams(['a']).validate('(ax)^2', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Use a*x', rewrite: '(a*x)^2' });
    assert.equal(r.pos, 1);
    r = fail(plain().validate('2pq', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Use p*q', rewrite: '2p*q' });
    // Greek names and long words are slider names, not products.
    r = fail(plain().validate('alpha*x', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Add slider alpha', addParameter: 'alpha' });
    r = fail(plain().validate('rate*x', 'fn1'));
    assert.deepEqual(r.fix, { label: 'Add slider rate', addParameter: 'rate' });
});

test('quick fix rule 3: variable not available in this field', () => {
    const ctx = plain();
    assert.equal(fail(ctx.validate('y + x', 'fn1')).message, 'y is not available here: f(x) uses x only');
    assert.equal(fail(ctx.validate('t^2', 'fn1')).message, 't is not available here: f(x) uses x only');
    assert.equal(fail(ctx.validate('x + y', 'fn1', 'parametric')).message, 'y is not available here: x(t) and y(t) use t only');
    assert.equal(fail(ctx.validate('y', 'fn1', 'polar')).message, 'y is not available here: r(theta) uses theta only');
    assert.equal(fail(ctx.validate('z + x', 'fn2')).message, 'z is not available here: use x and y');
    assert.equal(fail(ctx.validate('x + 1', 'value')).message, 'x is not available here: this field takes a number');
    const r = fail(ctx.validate('theta', 'fn2'));
    assert.equal(r.fix, undefined);
    const custom = MathContext.create({ variables: 'x1, x2' });
    assert.equal(fail(custom.validate('x2', 'fn1')).message, 'x2 is not available here: f(x1) uses x1 only');
});

test('quick fix rule 4: indexed variable names while axes are x, y', () => {
    const r = fail(plain().validate('2x1 + 3x2', 'fn2'));
    assert.equal(r.message, "Unknown name 'x1'. Set axis variables to x1, x2 in Chart > Axes?");
    assert.equal(r.fix, undefined);
    assert.equal(r.unknown, undefined);
    // With custom variables the same text just works.
    const ctx = MathContext.create({ variables: 'x1, x2' });
    assert.equal(ctx.fn2('2x1 + 3x2')(1, 2), 8);
    // Only x1 / x2 (y1 / y2) in fields that take variables: x0, y0 are ordinary slider names.
    let s = fail(plain().validate('(x - x0)^2 + y0', 'fn1'));
    assert.deepEqual(s.fix, { label: 'Add slider x0', addParameter: 'x0' });
    assert.equal(s.pos, 5);
    s = fail(plain().validate('y0', 'value'));
    assert.equal(s.fix?.addParameter, 'y0');
    s = fail(plain().validate('x1', 'value'));
    assert.ok(!s.message.includes('Set axis variables'), s.message);
    assert.equal(s.fix?.addParameter, 'x1');
    assert.equal(fail(plain().validate('x1', 'fn1')).message, "Unknown name 'x1'. Set axis variables to x1, x2 in Chart > Axes?");
    assert.equal(fail(plain().validate('X1', 'fn1')).fix?.addParameter, 'X1');
});

test('quick fix rule 5: add slider (never for reserved or derived-looking names)', () => {
    const r = fail(plain().validate('k*x', 'fn1'));
    assert.equal(r.message, "Unknown name 'k'");
    assert.equal(r.unknown, 'k');
    assert.deepEqual(r.fix, { label: 'Add slider k', addParameter: 'k' });
    const ctx = MathContext.create({ toolNames: ['P1'] });
    const d = fail(ctx.validate('P1_q', 'value'));
    assert.equal(d.fix, undefined);
    assert.equal(d.unknown, undefined);
    const t = fail(ctx.validate('P1 + 1', 'value'));
    assert.equal(t.message, "'P1' is a tool: use P1_x, P1_y or P1_val");
    assert.equal(t.fix, undefined);
    for (const name of ['sin', 'pi', 'and', 'Math', 'x', 'theta', 'true']) assert.ok(isReservedName(name), name);
    assert.ok(!isReservedName('k'));
    assert.ok(BUILTIN_FUNCTION_NAMES.includes('cot') && BUILTIN_FUNCTION_NAMES.includes('log1p'));
    assert.ok(CONSTANT_NAMES.includes('SQRT1_2') && CONSTANT_NAMES.includes('π'));
});

test('edit distance, closest names, name splitting', () => {
    assert.equal(editDistance('sni', 'sin'), 1);
    assert.equal(editDistance('sqr', 'sqrt'), 1);
    assert.equal(editDistance('kitten', 'sitting'), 3);
    assert.equal(closestName('cso', ['sin', 'cos', 'tan']), 'cos');
    assert.equal(closestName('zz', ['sin', 'cos']), null);
    assert.deepEqual(splitName('ax', ['x'], () => false, false), ['a', 'x']);
    assert.deepEqual(splitName('pix', ['pi', 'x'], () => false, false), ['pi', 'x']);
    assert.equal(splitName('abc', [], () => false, false), null);
    assert.equal(splitName('beta', ['b', 'e'], () => false, false), null);
});

// ------------------------------------------------------------- printers

test('pgf: mapping table', () => {
    const ctx = plain();
    const p = (s: string) => ctx.pgf(s, 'fn1');
    assert.equal(p('log(x)'), 'ln(x)');
    assert.equal(p('ln(x) + log10(x) + log2(x)'), '(ln(x)+log10(x))+log2(x)');
    assert.equal(p('csc(x)'), 'cosec(x)');
    assert.equal(p('sec(x) + cot(x)'), 'sec(x)+cot(x)');
    assert.equal(p('round(x)'), 'floor(x+0.5)');
    assert.equal(p('round(x - 1)'), 'floor((x-1)+0.5)');
    assert.equal(p('trunc(x)'), 'int(x)');
    assert.equal(p('x % 3'), 'x-(3*int(x/3))');
    assert.equal(p('(x + 1) % -2'), '(x+1)-((-2)*int((x+1)/(-2)))');
    assert.equal(p('cbrt(x)'), 'sign(x)*(abs(x)^(1/3))');
    assert.equal(p('hypot(x, 4, 12)'), 'veclen(veclen(x,4),12)');
    assert.equal(p('hypot(x)'), 'abs(x)');
    assert.equal(p('asinh(x)'), 'sign(x)*ln(abs(x)+sqrt((x)^2+1))');
    assert.equal(p('acosh(x)'), 'ln((x)+sqrt((x)^2-1))');
    assert.equal(p('atanh(x)'), '0.5*ln((1+(x))/(1-(x)))');
    assert.equal(p('log1p(x)'), 'ln(1+(x))');
    assert.equal(p('expm1(x)'), '(exp(x)-1)');
    assert.equal(p('fround(x)'), '(x)');
    assert.equal(p('random()'), 'rnd');
    assert.equal(p('min(x, 1, 2)'), 'min(x,1,2)');
    assert.equal(p('atan2(1, x)'), 'atan2(1,x)');
    assert.equal(p('pow(x, 2)'), 'pow(x,2)');
    assert.equal(p('Math.sin(x)'), 'sin(x)');
    assert.equal(p('PI + pi + π + E + e'), '(((pi+pi)+pi)+e)+e');
    assert.equal(p('LN2'), '0.693147');
    assert.equal(p('true + false'), '1+0');
    assert.equal(p('x === 1'), 'x==1');
    assert.equal(p('x !== 1'), 'x!=1');
    assert.equal(p('!x'), '(x==0) || (x!=x)');
    assert.equal(p('!(x > 0)'), '!(x>0)');
    assert.equal(p('asin(x)'), '((abs(x)<1) || (abs(x)==1)) ? asin(max(-1,min(1,x))) : nan');
    assert.equal(p('acos(x/2)'), '((abs(x/2)<1) || (abs(x/2)==1)) ? acos(max(-1,min(1,x/2))) : nan');
    assert.equal(p('.5 + 2. + 1e3'), '(0.5+2)+1000');
    for (const s of ['x % 2', 'log(x)', 'csc(x)', 'round(x)']) {
        const out = p(s);
        assert.ok(!/\b[Mm]od\(|\blog\(|\bcsc\(|\bround\(|deg\(/.test(out), out);
    }
});

test('pgf: full parenthesisation of ^, ?:, && / ||, unary minus', () => {
    const p = (s: string) => plain().pgf(s, 'fn1');
    assert.equal(p('2^x^2'), '2^(x^2)');
    assert.equal(p('-x^2'), '-(x^2)');
    assert.equal(p('2^-x'), '2^(-x)');
    assert.equal(p('x^2 - 2x + 1'), '((x^2)-(2*x))+1');
    assert.equal(p('x < 0 ? -1 : x < 1 ? 0 : 1'), '(x<0) ? (-1) : ((x<1) ? 0 : 1)');
    assert.equal(p('x < 0 ? (x < -1 ? -2 : -1) : 1'), '(x<0) ? ((x<(-1)) ? (-2) : (-1)) : 1');
    assert.equal(p('x < 0 || x > 1 && x > 5'), '(x<0) || ((x>1) && (x>5))');
    assert.equal(p('0 < x < 2'), '(0<x) && (x<2)');
    assert.equal(p('!(x > 0) && x < 5'), '(!(x>0)) && (x<5)');
    assert.equal(p('(x < 1 ? 1 : 2) * 10'), '((x<1) ? 1 : 2)*10');
    assert.equal(p('1/2x'), '(1/2)*x');
    assert.equal(p('3 * -x'), '3*(-x)');
});

test('pgf: JavaScript semantics where pgfmath differs or aborts', () => {
    const ctx = MathContext.create({ parameters: [{ name: 'k', value: 0, min: -5, max: 5, step: 1 }] });
    const p = (s: string, kind: 'fn1' | 'fn2' = 'fn1') => ctx.pgf(s, kind);
    // Remainder: a divisor that is not a nonzero number gets a b = 0 guard.
    assert.equal(p('x % k'), '(0==0) ? nan : (x-(0*int(x/0)))');
    assert.equal(p('x % y', 'fn2'), '(y==0) ? nan : (x-(y*int(x/y)))');
    assert.equal(p('x % pi'), 'x-(pi*int(x/pi))');
    // Logic on non-boolean operands keeps JavaScript values (a && b -> b, a || b -> a).
    assert.equal(p('x > 0 && x < 1'), '(x>0) && (x<1)');
    assert.equal(p('x && 2'), '((x!=0) && (x==x)) ? 2 : x');
    assert.equal(p('x || 2'), '((x!=0) && (x==x)) ? x : 2');
    assert.equal(p('true && x > 1'), '1 && (x>1)');
    // Ternary tests that are not comparisons: NaN counts as false.
    assert.equal(p('x ? 1 : 2'), '((x!=0) && (x==x)) ? 1 : 2');
    assert.equal(p('x > 1 ? 1 : 2'), '(x>1) ? 1 : 2');
    assert.equal(p('(x > 1 ? x < 2 : x > 0) ? 1 : 2'), '((x>1) ? (x<2) : (x>0)) ? 1 : 2');
    // A leading 0 is an octal prefix in pgfmath ('010' is 8, '09' aborts the document).
    assert.equal(p('09*x'), '9*x');
    assert.equal(p('010*x'), '10*x');
    assert.equal(p('x + 010.'), 'x+10');
    assert.equal(p('x^02'), 'x^2');
    assert.equal(p('sin(090)'), 'sin(90)');
    assert.equal(p('00.5'), '0.5');
    assert.equal(p('0'), '0');
    assert.equal(p('0.5 + .5'), '0.5+0.5');
    assert.equal(ctx.tex('09 x'), '9 x');
});

test('pgf: sliders, user functions, guards, variables', () => {
    const ctx = MathContext.create({
        parameters: [
            { name: 'a', value: -1.5, min: -5, max: 5, step: 0.1 },
            { name: 'b', value: 2, min: -5, max: 5, step: 0.1 },
        ],
        functions: [
            { name: 'f1', expression: 'x^2', domain: '' } as never,
            { name: 'f2', expression: 'sin(x)', domain: '0:b' } as never,
            { name: 'h', expression: 'f1(x) + a', domain: '' } as never,
        ],
    });
    assert.equal(ctx.pgf('a*x + b', 'fn1'), '((-1.5)*x)+2');
    assert.equal(ctx.pgf('f1(x - 1)', 'fn1'), '(x-1)^2');
    assert.equal(ctx.pgf('f1 + 1', 'fn1'), '(x^2)+1');
    assert.equal(ctx.pgf('h(2x)', 'fn1'), '((2*x)^2)+(-1.5)');
    assert.equal(ctx.pgf('f2(x)', 'fn1'), '(((x)>=(0)) && ((x)<=(2))) ? (sin(x)) : nan');
    assert.equal(ctx.pgf('f2(x - 1) + 1', 'fn1'), '((((x-1)>=(0)) && ((x-1)<=(2))) ? (sin((x-1))) : nan)+1');
    assert.equal(ctx.pgf('x*y', 'fn2'), 'x*y');
    assert.equal(ctx.pgf('x*y', 'fn2', { outVars: ['u', 'v'] }), 'u*v');
    assert.equal(ctx.pgf('a + b', 'value'), '(-1.5)+2');
    const polar = MathContext.create({ polar: true });
    assert.equal(polar.pgf('theta + θ + t', 'fn1', { fnKind: 'polar' }), '(x+x)+x');
    assert.equal(polar.pgf('t^2', 'fn1', { fnKind: 'parametric' }), 'x^2');
    const vars = MathContext.create({ variables: 'q, p' });
    assert.equal(vars.pgf('2q + p', 'fn2'), '(2*x)+y');
    throws(() => ctx.pgf('k*x', 'fn1'), "Unknown name 'k'");
});

test('tex: legend LaTeX', () => {
    const ctx = withParams(['alpha']);
    const t = (s: string) => ctx.tex(s);
    assert.equal(t('2x^2 + sin(x)'), '2 x^{2} + \\sin(x)');
    assert.equal(t('x <= 4'), 'x \\le 4');
    assert.equal(t('0 <= x <= 4'), '0 \\le x \\le 4');
    assert.equal(t('x >= 0 && x != 1'), 'x \\ge 0 \\land x \\ne 1');
    assert.equal(t('x < 0 || x > 1'), 'x < 0 \\lor x > 1');
    assert.equal(t('x % 3'), 'x \\bmod 3');
    assert.equal(t('sqrt(x)'), '\\sqrt{x}');
    assert.equal(t('abs(x)'), '\\left|x\\right|');
    assert.equal(t('1/x'), '\\frac{1}{x}');
    assert.equal(t('(x+1)/2'), '(x + 1) / 2');
    assert.equal(t('2 * 3'), '2 \\cdot 3');
    assert.equal(t('pi x + theta'), '\\pi x + \\theta');
    assert.equal(t('x_1 + x1'), 'x_{1} + x_{1}');
    assert.equal(t('alpha * rate'), '\\alpha \\mathit{rate}');
    assert.equal(t('e^(-x^2)'), 'e^{-x^{2}}');
    assert.equal(t('log(x) + atan(x)'), '\\ln(x) + \\arctan(x)');
    assert.equal(t('sign(x)'), '\\mathop{\\mathrm{sign}}(x)');
    assert.equal(t('2x + 3y = 12'), '2 x + 3 y = 12');
    assert.equal(t('(x + 1'), '\\mbox{(x + 1}');
    // LaTeX has no \omicron: it is a Latin o.
    assert.equal(texName('omicron'), 'o');
    assert.equal(texName('omicron_1'), 'o_{1}');
    assert.equal(texName('upsilon'), '\\upsilon');
    assert.equal(withParams(['omicron']).tex('omicron*x'), 'o x');
});

// ---------------------------------------------------------- parse helpers

test('parse modes: lists, tuples, equations, conditions', () => {
    assert.equal(parseList('').length, 0);
    assert.equal(parseList('1, max(2, 3), c').length, 3);
    const items = parseTuples('(1, 2); (max(3, 4), 5);', false);
    assert.equal(items.length, 2);
    assert.equal(items[1].kind === 'tuple' && items[1].items.length, 2);
    const path = parseTuples('P1; (0, 0)', true);
    assert.deepEqual(path[0], { kind: 'name', name: 'P1', s: 0, e: 2 });
    const eq = parse('2x + 3y = 12', 'eq');
    assert.ok(eq.t === 'binary' && eq.equation);
    const eq2 = parse('x^2 + y^2 == 4', 'eq');
    assert.ok(eq2.t === 'binary' && eq2.equation);
    throws(() => parse('x = y = 2', 'eq'), 'An equation has only one =');
    const cond = parse('x >= 0, y >= 0; x + y <= 4', 'cond');
    assert.ok(cond.t === 'logic' && cond.op === '&&');
    throws(() => parse('x = 2', 'cond'), 'Use <= or >= in a condition, not =');
});

test('topLevelColon skips ternaries and parentheses', () => {
    assert.equal(topLevelColon('0:2*pi'), 1);
    assert.equal(topLevelColon('x > 0 ? 1 : 2 : 5'), 14);
    assert.equal(topLevelColon('(a ? b : c):d'), 11);
    assert.equal(topLevelColon('-5 5'), -1);
    assert.equal(topLevelColon('#'), null);
});

test('scanTemplate: placeholders, decimals, literal braces, LaTeX groups', () => {
    const parts = scanTemplate('z = {c:2} {{x}} $x^{2} + \\frac{a}{b} = {k}$ {x > 0 ? 1 : 2}').parts;
    const exprs = parts.filter((p) => p.kind === 'expr');
    assert.deepEqual(
        exprs.map((p) => (p.kind === 'expr' ? [p.expr, p.decimals] : null)),
        [['c', 2], ['k', null], ['x > 0 ? 1 : 2', null]]
    );
    const text = parts.map((p) => (p.kind === 'text' ? p.text : '#')).join('');
    assert.equal(text, 'z = # {x} $x^{2} + \\frac{a}{b} = #$ #');
    assert.ok(scanTemplate('open {x').error);
    const exprsOf = (src: string) => scanTemplate(src).parts.flatMap((p) => (p.kind === 'expr' ? [p.expr] : []));
    // A brace after a placeholder or after a command without arguments is another placeholder.
    assert.deepEqual(exprsOf('$A = {w}\\cdot{h}$'), ['w', 'h']);
    assert.deepEqual(exprsOf('${w}{h}$'), ['w', 'h']);
    assert.deepEqual(exprsOf('$x\\approx{v}$'), ['v']);
    // Groups of commands with arguments stay LaTeX.
    assert.deepEqual(exprsOf('$\\frac{a}{b}$'), []);
    assert.deepEqual(exprsOf('$\\mathcal{A} + \\mathbf{x}_{1}$'), []);
    // Outside math too, a command's argument is LaTeX ('\\textbf{A}' in a title), other braces interpolate.
    assert.deepEqual(exprsOf('\\textbf{Revenue} in {w}'), ['w']);
    assert.deepEqual(exprsOf('\\textcolor{red}{hot} {w}'), ['w']);
    assert.deepEqual(exprsOf('x_{w} and \\alpha{w}'), ['w', 'w']);
    assert.equal(scanTemplate('\\textit{EUR}').parts.map((p) => (p.kind === 'text' ? p.text : '#')).join(''), '\\textit{EUR}');
    // Dollar signs pair like in Obsidian: prices are text, `$$...$$` is math.
    assert.deepEqual(exprsOf('costs $5 and {w}'), ['w']);
    assert.equal(scanTemplate('$$a^{2} = {w}$$').parts.map((p) => (p.kind === 'text' ? p.text : '#')).join(''), '$$a^{2} = #$$');
});

test('dollarMath: Pandoc / Obsidian pairing of $', () => {
    assert.deepEqual(dollarMath('$x$ and', 0), { close: 2, end: 3 });
    assert.deepEqual(dollarMath('$$a$$', 0), { close: 3, end: 5 });
    assert.equal(dollarMath('$5 and $10', 0), null, 'a closing $ is never preceded by whitespace');
    assert.equal(dollarMath('$5-$10', 0), null, 'a span starting with a digit never closes before a digit');
    assert.deepEqual(dollarMath('$\\$$5', 0), { close: 3, end: 4 }, 'the migrated dollar sign');
    assert.equal(dollarMath('$ x $', 0), null, 'no whitespace inside the delimiters');
    assert.equal(dollarMath('Revenue ($)', 9), null);
    assert.deepEqual(dollarMath('$a \\$ b$', 0), { close: 7, end: 8 }, 'escaped dollars never close');
});

test('renameIdentifier: tokens only', () => {
    assert.equal(renameIdentifier('a*x + ab + a(2) + Math.a + 2a', 'a', 'k'), 'k*x + ab + k(2) + Math.a + 2k');
    assert.equal(renameIdentifier('f1(x) + f10 + f1', 'f1', 'g'), 'g(x) + f10 + g');
    assert.equal(renameIdentifier('0:a', 'a', 'b'), '0:b');
    assert.equal(renameIdentifier('(a, 1); (2, a)', 'a', 'c'), '(c, 1); (2, c)');
    assert.equal(renameIdentifier('z = {a:2} and a', 'a', 'c'), 'z = {c:2} and a');
    assert.equal(renameIdentifier('a # b', 'a', 'c'), 'a # b');
    assert.equal(renameIdentifier('2e + e', 'e', 'k'), '2k + k');
    // A new name like e1 must not merge with a number in front of it (2e1 is 20).
    assert.equal(renameIdentifier('2k + x', 'k', 'e1'), '2 e1 + x');
    assert.equal(renameIdentifier('2.5k', 'k', 'E2'), '2.5 E2');
    assert.equal(renameIdentifier('x/2k', 'k', 'e1'), 'x/2 e1');
    assert.equal(renameIdentifier('2*k', 'k', 'e1'), '2*e1');
    assert.equal(renameIdentifier('{2k}', 'k', 'e1', true), '{2 e1}');
    const e1 = MathContext.create({ parameters: [{ name: 'e1', value: 3, min: 0, max: 5, step: 1 }] });
    assert.equal(e1.fn1(renameIdentifier('2k + x', 'k', 'e1'))(0), 6);
});

// ------------------------------------- Phase 0: implicit calls and powers

/** a = 2, h = 0, b = 3; user function f(x) = x^2 + 1; tool P1 (P1_x = 2). */
function phase0(): MathContext {
    const ctx = new MathContext({
        parameters: [
            { name: 'a', value: 2, min: -5, max: 5, step: 0.1 },
            { name: 'h', value: 0, min: -5, max: 5, step: 0.1 },
            { name: 'b', value: 3, min: -5, max: 5, step: 0.1 },
        ],
        functions: [{ name: 'f', expression: 'x^2 + 1', domain: '' } as never],
        toolNames: ['P1'],
    });
    ctx.setDerived({ P1_x: 2 });
    return ctx;
}

test('Phase 0: name(A)^E is name * (A^E) when the call is a product (SPEC3 4.1 regressions)', () => {
    const ctx = phase0();
    const f = (s: string, x: number) => ctx.fn1(s)(x);
    assert.equal(f('a(x - h)^2', 3), 18);
    assert.equal(f('a (x - 1)^2', 3), 8);
    assert.equal(f('x(x+1)^2', 3), 48);
    assert.equal(f('(a(x - h))^2', 3), 36, 'parentheses around the product keep squaring it');
    assert.equal(f('2(x+1)^2', 1), 8, 'numbers already worked this way');
    assert.equal(f('a(x - h)**2', 3), 18, '** is ^');
    // pgf: no squared slider; tex keeps the text.
    assert.equal(ctx.pgf('a(x - h)^2', 'fn1'), '2*((x-0)^2)');
    assert.equal(ctx.pgf('(a(x - h))^2', 'fn1'), '(2*(x-0))^2');
    assert.equal(ctx.tex('a(x - h)^2'), 'a(x - h)^{2}');
    assert.equal(ctx.tex('(a(x - h))^2'), '(a(x - h))^{2}');
    assert.equal(ctx.tex('(f(x))^2'), '(f(x))^{2}');
    assert.equal(ctx.tex('f(x)^2'), 'f(x)^{2}');
    assert.equal(ctx.tex('sin(x)^2'), '\\sin(x)^{2}');
    assert.equal(ctx.tex('(sin(x))^2'), '\\sin(x)^{2}', 'builtins print as before');
    // Affine detection: a(x - 1) stays affine, a(x - 1)^2 is not, a(x)^0 is the constant a.
    const fn2 = ctx.envFor('fn2');
    const lin = (s: string) => linearForm(parse(s, 'eq'), fn2);
    assert.deepEqual(lin('a(x - 1) + y'), { a: 2, b: 1, c: -2 });
    assert.equal(lin('a(x - 1)^2 + y'), null);
    assert.deepEqual(lin('a(x)^0 + y'), { a: 0, b: 1, c: 2 });
    assert.deepEqual(ctx.equation('a(x - 1) + y = 0').affine, { a: 2, b: 1, c: -2 });
    assert.equal(ctx.equation('a(x - 1)^2 + y = 0').affine, null);
    assert.deepEqual(ctx.conditions(['y <= a(x)^0'])[0].disjuncts[0][0].affine, { a: 0, b: 1, c: -2 });
    near(ctx.equation('a(x - 1)^2 + y = 0').F(3, 1), 9);
});

test('Phase 0: every precedence interaction of call-as-product with ^, unary minus and juxtaposition', () => {
    const ctx = phase0();
    const f = (s: string, x: number) => ctx.fn1(s)(x);
    // Base of a power: only the unparenthesized call splits.
    assert.equal(f('a(x)^2', 3), 18);
    assert.equal(f('a(x)^2^2', 2), 32, 'right-associative exponent: a * x^(2^2)');
    assert.equal(f('a(x)^-1', 4), 0.5, 'unary exponent');
    assert.equal(f('a(-x)^2', 3), 18);
    assert.equal(f('pi(x)^2', 1), Math.PI, 'constants');
    assert.equal(f('e(x)^2', 1), Math.E);
    assert.equal(f('P1_x(x)^2', 3), 18, 'derived names');
    assert.equal(f('b(a(x)^2)', 3), 54, 'nested: b * (a * x^2)');
    assert.equal(f('a(b(x))^2', 1), 18, 'outer split, inner product: a * (b x)^2');
    // Unary minus binds looser than the power: -(a * x^2).
    assert.equal(f('-a(x)^2', 3), -18);
    assert.equal(f('-a(x)', 3), -6);
    // Juxtaposition around the product.
    assert.equal(f('2a(x)^2', 3), 36);
    assert.equal(f('a(x)^2(x)', 3), 54);
    assert.equal(f('a(x)(x)', 3), 18);
    assert.equal(f('x(x)(x)^2', 3), 81);
    assert.equal(f('a(x) b', 3), 18);
    // The product stays one operand of / % and of an exponent (only its own power splits).
    assert.equal(f('1/a(x)', 4), 0.125);
    assert.equal(f('12 % a(x)', 5), 2);
    assert.equal(f('2^a(x)', 1.5), 8);
    assert.equal(f('2^a(x)^2', 1), 4, '2^(a * x^2)');
    // Real calls are unchanged.
    assert.equal(f('f(x)^2', 3), 100, 'user function: (f(x))^2');
    assert.equal(f('sqrt(x)^2', 9), 9);
    near(f('Math.sin(x)^2', 1), Math.sin(1) ** 2);
    // Errors and quick fixes are unchanged.
    throws(() => ctx.fn1('a(x, 1)^2'), "'a' is not a function");
    throws(() => ctx.fn1('q(x)^2'), /^Unknown function 'q'/);
    // fn2: y is a variable there, so y(x + 1)^2 = y * (x + 1)^2.
    assert.equal(ctx.fn2('y(x + 1)^2')(1, 3), 12);
});

test('compile hook: hooked nodes read slots and are never folded', () => {
    const ctx = phase0();
    const env = ctx.envFor('fn1');
    const slots = new Float64Array([3, 1]);
    const hook: CompileHook = (n) => {
        if (n.t === 'num' && n.raw === '3') return () => slots[0];
        if (n.t === 'name' && n.name === 'a') return () => slots[1];
        return null;
    };
    const c = (src: string) => compile(parse(src), env, src, hook);
    const sum = c('2 + 3');
    const pow = c('2^3 + x');
    const call = c('sin(3) * x');
    const paren = c('(3)x');
    const slider = c('a x + 3');
    assert.equal(sum(0, 0), 5);
    assert.equal(pow(1, 0), 9);
    assert.equal(slider(2, 0), 5, 'a reads slot 1, not the slider');
    slots[0] = 10;
    slots[1] = -1;
    assert.equal(sum(0, 0), 12, 'constant subtree with a hooked leaf is not folded');
    assert.equal(pow(1, 0), 1025);
    near(call(2, 0), 2 * Math.sin(10));
    assert.equal(paren(2, 0), 20, 'a literal in parentheses is one NumNode');
    assert.equal(slider(2, 0), 8);
    // On the normalized AST the name of a product is a NameNode the hook sees (Phase 0 split
    // included); on the raw AST a(...) is a call and reads the slider.
    const src = '3(x - 1)^2 + a(x - 1)^2';
    const norm = compile(normalizeImplicitCalls(parse(src), env), env, src, hook);
    slots[0] = 2;
    slots[1] = 0.5;
    assert.equal(norm(3, 0), 2 * 4 + 0.5 * 4);
    assert.equal(c(src)(3, 0), 2 * 4 + 2 * 4);
    // A hook that returns null changes nothing.
    const plainF = compile(parse(src), env, src);
    const nullF = compile(parse(src), env, src, () => null);
    for (const x of XS) assert.ok(Object.is(plainF(x, 0), nullF(x, 0)), `${x}`);
});

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomExpr(r: () => number, depth: number): string {
    const pick = (xs: string[]) => xs[Math.floor(r() * xs.length)];
    if (depth <= 0 || r() < 0.2) return pick(['x', 'a', 'h', '2', '0.5', '3', 'pi', 'e', '(x)', '1/2', 'P1_x']);
    const a = () => randomExpr(r, depth - 1);
    switch (Math.floor(r() * 13)) {
        case 0:
            return `${a()} + ${a()}`;
        case 1:
            return `${a()} - ${a()}`;
        case 2:
            return `${a()} * ${a()}`;
        case 3:
            return `${a()} / (${a()})`;
        case 4:
            return `(${a()})^${pick(['2', '3', '0.5', '-1', 'x'])}`;
        case 5:
            return `-${a()}`;
        case 6:
            return `${pick(['2', '3', '0.5', '-2'])}${pick(['x', 'a', '(x + 1)', 'sin(x)', 'a(x - h)^2'])}`;
        case 7:
            return `${pick(['sin', 'cos', 'exp', 'sqrt', 'abs'])}(${a()})`;
        case 8:
            return `${pick(['a', 'x', 'h', 'pi', 'P1_x'])}(${a()})`;
        case 9:
            return `${pick(['a', 'x', 'h', 'e'])}(${a()})^${pick(['2', '3', '-1'])}`;
        case 10:
            return `f(${a()})`;
        case 11:
            return `${a()} ${pick(['x', 'a', '(x - 1)'])}`;
        default:
            return `(${a()})`;
    }
}

test('compile hook and normalizeImplicitCalls: identical values on 200 random expressions', () => {
    const ctx = phase0();
    const env = ctx.envFor('fn1');
    const r = rng(20261006);
    let checked = 0;
    for (let i = 0; i < 200; i++) {
        const src = randomExpr(r, 4);
        const ast = parse(src);
        const plainF = compile(ast, env, src);
        const hooked = compile(ast, env, src, () => null);
        const norm = normalizeImplicitCalls(ast, env);
        const normF = compile(norm, env, src);
        const viaCtx = ctx.fn1(src);
        // The pgf printer has its own code path for the power rule; its fully parenthesized
        // output (sliders as numbers, no implicit calls left) must compute the same values.
        const pgf = ctx.pgf(src, 'fn1');
        const viaPgf = plain().fn1(pgf);
        for (const x of XS) {
            const v = plainF(x, 0);
            assert.ok(Object.is(v, hooked(x, 0)), `${src} hooked at ${x}`);
            assert.ok(Object.is(v, normF(x, 0)), `${src} normalized at ${x}: ${v} vs ${normF(x, 0)}`);
            assert.ok(Object.is(v, viaCtx(x)), `${src} via context at ${x}`);
            const w = viaPgf(x);
            const same = Number.isFinite(v) ? Math.abs(v - w) <= 1e-9 * Math.max(1, Math.abs(v)) : Object.is(v, w) || (Number.isNaN(v) && Number.isNaN(w));
            assert.ok(same, `${src} -> pgf ${pgf} at ${x}: ${v} vs ${w}`);
        }
        checked++;
    }
    assert.equal(checked, 200);
});

test('normalizeImplicitCalls: products with name spans, the power split, untouched nodes kept', () => {
    const ctx = phase0();
    const env = ctx.envFor('fn1');
    // a(x - h)^2 + 1: the power splits; the 1 and the call argument are the same objects.
    let src = 'a(x - h)^2 + 1';
    let ast = parse(src) as BinaryNode;
    let norm = normalizeImplicitCalls(ast, env) as BinaryNode;
    assert.ok(norm !== ast && norm.t === 'binary' && norm.op === '+');
    assert.equal(norm.right, ast.right);
    const prod = norm.left as BinaryNode;
    assert.ok(prod.t === 'binary' && prod.op === '*' && prod.implicit);
    assert.deepEqual([prod.s, prod.e], [0, 10], "the product has the '^' node's span");
    assert.deepEqual(prod.left, { t: 'name', name: 'a', s: 0, e: 1 });
    const power = prod.right as BinaryNode;
    assert.ok(power.t === 'binary' && power.op === '^');
    assert.equal(src.slice(power.s, power.e), '(x - h)^2', "the power spans from the '('");
    const call = (ast.left as BinaryNode).left as CallNode;
    assert.equal(power.left, call.args[0], 'the argument is the same object');
    assert.equal(power.right, (ast.left as BinaryNode).right);
    // A plain product: the call's span, right = the argument.
    src = 'a (x + 1)';
    const callAst = parse(src) as CallNode;
    const p = normalizeImplicitCalls(callAst, env) as BinaryNode;
    assert.ok(p.t === 'binary' && p.op === '*' && p.implicit);
    assert.deepEqual([p.s, p.e], [0, 9]);
    assert.deepEqual(p.left, { t: 'name', name: 'a', s: 0, e: 1 });
    assert.equal(p.right, callAst.args[0]);
    // Variables, constants and derived names are products too; x(x^2+1) gets a name node for x.
    for (const [s, name] of [['x(x^2+1)', 'x'], ['pi(x)', 'pi'], ['e(x)', 'e'], ['P1_x(x)', 'P1_x']]) {
        const n = normalizeImplicitCalls(parse(s), env) as BinaryNode;
        assert.ok(n.t === 'binary' && n.implicit && n.left.t === 'name' && n.left.name === name, s);
        assert.deepEqual([n.left.s, n.left.e], [0, name.length], s);
    }
    // Nested products.
    const nested = normalizeImplicitCalls(parse('a(b(x))'), env) as BinaryNode;
    assert.ok(nested.right.t === 'binary' && nested.right.implicit && nested.right.left.t === 'name' && nested.right.left.name === 'b');
    // A product in parentheses keeps the widened span; its power does not split.
    src = '(a(x))^2';
    norm = normalizeImplicitCalls(parse(src), env) as BinaryNode;
    assert.ok(norm.op === '^' && norm.left.t === 'binary' && norm.left.implicit);
    assert.deepEqual([norm.left.s, norm.left.e], [0, 6]);
    // Untouched trees come back as the same object.
    for (const s of ['sin(x) + f(x)', 'x^2 - 3x + 1', 'q(x) + 1', 'a(x, 1)', 'Math.sin(x)^2', '2(x - 1)^2']) {
        const t = parse(s);
        assert.equal(normalizeImplicitCalls(t, env), t, s);
    }
    // Flags survive copies: the equation root keeps `equation`.
    const fn2 = ctx.envFor('fn2');
    const eq = normalizeImplicitCalls(parse('a(x)^2 + y = 4', 'eq'), fn2) as BinaryNode;
    assert.ok(eq.equation);
    // Never throws, even for an unusable env.
    const broken = { ...env, scalar: () => { throw new Error('boom'); } };
    ast = parse('a(x)^2 + 1') as BinaryNode;
    assert.equal(normalizeImplicitCalls(ast, broken), ast);
});

test('text helpers: numberTokenSpan, applyEdits', () => {
    let src = '( 2.5 )*x';
    assert.deepEqual(numberTokenSpan(src, parse(src).t === 'binary' ? ((parse(src) as BinaryNode).left as NumNode) : (parse(src) as NumNode)), [2, 5]);
    src = 'x + 3';
    assert.deepEqual(numberTokenSpan(src, (parse(src) as BinaryNode).right as NumNode), [4, 5]);
    src = '((10))';
    assert.deepEqual(numberTokenSpan(src, parse(src) as NumNode), [2, 4]);
    // Replacement before insertion at the same start; order of the list does not matter.
    const ins = { s: 0, e: 0, text: '1.5' };
    const rep = { s: 0, e: 1, text: '(x - 1)' };
    assert.equal(applyEdits('x^2', [ins, rep]), '1.5(x - 1)^2');
    assert.equal(applyEdits('x^2', [rep, ins]), '1.5(x - 1)^2');
    assert.equal(applyEdits('x + 3', [{ s: 4, e: 5, text: '0.8' }, { s: 2, e: 3, text: '-' }]), 'x - 0.8');
    assert.equal(applyEdits('x', [{ s: 1, e: 1, text: ' + ' }, { s: 1, e: 1, text: 'k' }]), 'x + k', 'insertions keep their order');
    assert.equal(applyEdits('abc', []), 'abc');
});

// ------------------------------------------------------------ benchmark

test('benchmark: 6-operation expression, 1e6 evaluations < 150 ms', () => {
    const ctx = withParams(['a']);
    const f = ctx.fn1('a x^2 - 3x + sin(x) / 4');
    let best = Infinity;
    let sink = 0;
    for (let rep = 0; rep < 3; rep++) {
        const t0 = Date.now();
        for (let i = 0; i < 1e6; i++) sink += f(i * 1e-6);
        best = Math.min(best, Date.now() - t0);
    }
    assert.ok(Number.isFinite(sink));
    assert.ok(best < 150, `took ${best} ms`);
});
