/**
 * utils/math.js
 * ------------------------------------------------------------
 * Mathematical utility layer
 * ------------------------------------------------------------
 *
 * ROLE
 * ----
 * Provides safe, reusable mathematical primitives used by
 * the Virtual Score Engine.
 *
 * This file does NOT:
 * - parse matches
 * - parse bookmaker markets
 * - calculate football-specific features
 * - calculate team lambdas
 * - classify match regimes
 * - generate score predictions
 * - select Top 3 scores
 * - simulate matches
 *
 * It is a pure mathematical utility module.
 * ------------------------------------------------------------
 */

const EPSILON = 1e-12;

/**
 * Clamp a number between lower and upper bounds.
 */
function clamp(value, min, max) {
    const x = Number(value);

    if (!Number.isFinite(x)) {
        return min;
    }

    return Math.min(
        Math.max(x, min),
        max
    );
}

/**
 * Safe logarithm.
 *
 * Prevents log(0), which would otherwise produce -Infinity
 * and contaminate downstream calculations.
 */
function safeLog(value) {
    const x = Number(value);

    if (!Number.isFinite(x)) {
        return Math.log(EPSILON);
    }

    return Math.log(
        Math.max(x, EPSILON)
    );
}

/**
 * Safe exponential.
 *
 * Prevents numerical overflow.
 */
function safeExp(value) {
    const x = Number(value);

    if (!Number.isFinite(x)) {
        return 0;
    }

    return Math.exp(
        clamp(x, -700, 700)
    );
}

/**
 * Sigmoid / logistic function.
 *
 * σ(x) = 1 / (1 + e^(-x))
 */
function sigmoid(value) {
    const x = Number(value);

    if (!Number.isFinite(x)) {
        return 0.5;
    }

    if (x >= 0) {
        const z = safeExp(-x);

        return 1 / (1 + z);
    }

    const z = safeExp(x);

    return z / (1 + z);
}

/**
 * Parameterized sigmoid.
 *
 * σ(k(x - x0))
 *
 * Useful for smooth transitions between two regimes.
 */
function parameterizedSigmoid(
    value,
    center = 0,
    slope = 1
) {
    const x = Number(value);
    const c = Number(center);
    const k = Number(slope);

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(c) ||
        !Number.isFinite(k)
    ) {
        return 0.5;
    }

    return sigmoid(
        k * (x - c)
    );
}

/**
 * Logistic inverse / logit.
 *
 * logit(p) = log(p / (1-p))
 */
function logit(probability) {
    const p = clamp(
        Number(probability),
        EPSILON,
        1 - EPSILON
    );

    return Math.log(
        p / (1 - p)
    );
}

/**
 * Arithmetic mean.
 */
function mean(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    const valid = values
        .map(Number)
        .filter(Number.isFinite);

    if (valid.length === 0) {
        return 0;
    }

    return (
        valid.reduce(
            (sum, value) => sum + value,
            0
        ) / valid.length
    );
}

/**
 * Weighted mean.
 *
 * μ = Σ(wᵢxᵢ) / Σwᵢ
 */
function weightedMean(values, weights) {
    if (
        !Array.isArray(values) ||
        !Array.isArray(weights) ||
        values.length === 0 ||
        values.length !== weights.length
    ) {
        return 0;
    }

    let weightedSum = 0;
    let weightSum = 0;

    for (let i = 0; i < values.length; i++) {
        const x = Number(values[i]);
        const w = Number(weights[i]);

        if (
            Number.isFinite(x) &&
            Number.isFinite(w) &&
            w >= 0
        ) {
            weightedSum += x * w;
            weightSum += w;
        }
    }

    if (weightSum <= 0) {
        return 0;
    }

    return weightedSum / weightSum;
}

/**
 * Variance.
 *
 * Population variance:
 *
 * Var(X) = Σ(xᵢ - μ)² / n
 */
function variance(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    const valid = values
        .map(Number)
        .filter(Number.isFinite);

    if (valid.length === 0) {
        return 0;
    }

    const mu = mean(valid);

    return (
        valid.reduce(
            (sum, value) =>
                sum + Math.pow(value - mu, 2),
            0
        ) / valid.length
    );
}

/**
 * Standard deviation.
 */
function standardDeviation(values) {
    return Math.sqrt(
        Math.max(
            0,
            variance(values)
        )
    );
}

/**
 * Factorial.
 *
 * n! = n × (n-1) × ... × 1
 *
 * Uses iterative multiplication and validates n.
 */
function factorial(n) {
    const x = Number(n);

    if (
        !Number.isInteger(x) ||
        x < 0
    ) {
        return NaN;
    }

    if (x === 0 || x === 1) {
        return 1;
    }

    let result = 1;

    for (let i = 2; i <= x; i++) {
        result *= i;
    }

    return result;
}

/**
 * Log-factorial.
 *
 * More numerically stable for probability calculations.
 *
 * log(n!) = Σ log(k), k=1...n
 */
function logFactorial(n) {
    const x = Number(n);

    if (
        !Number.isInteger(x) ||
        x < 0
    ) {
        return NaN;
    }

    if (x <= 1) {
        return 0;
    }

    let result = 0;

    for (let i = 2; i <= x; i++) {
        result += Math.log(i);
    }

    return result;
}

/**
 * Combinations.
 *
 * C(n,k) = n! / (k!(n-k)!)
 */
function combinations(n, k) {
    const a = Number(n);
    const b = Number(k);

    if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        b < 0 ||
        b > a
    ) {
        return 0;
    }

    return Math.exp(
        logFactorial(a) -
        logFactorial(b) -
        logFactorial(a - b)
    );
}

/**
 * Euclidean distance.
 *
 * d(x,y) = √Σ(xᵢ-yᵢ)²
 */
function euclideanDistance(a, b) {
    if (
        !Array.isArray(a) ||
        !Array.isArray(b) ||
        a.length !== b.length
    ) {
        return Infinity;
    }

    let sum = 0;

    for (let i = 0; i < a.length; i++) {
        const x = Number(a[i]);
        const y = Number(b[i]);

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            continue;
        }

        sum += Math.pow(
            x - y,
            2
        );
    }

    return Math.sqrt(sum);
}

/**
 * Squared Euclidean distance.
 */
function squaredEuclideanDistance(a, b) {
    if (
        !Array.isArray(a) ||
        !Array.isArray(b) ||
        a.length !== b.length
    ) {
        return Infinity;
    }

    let sum = 0;

    for (let i = 0; i < a.length; i++) {
        const x = Number(a[i]);
        const y = Number(b[i]);

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            continue;
        }

        sum += Math.pow(
            x - y,
            2
        );
    }

    return sum;
}

/**
 * Gaussian kernel.
 *
 * K(d) = exp(-d² / (2σ²))
 */
function gaussianKernel(
    distance,
    bandwidth = 1
) {
    const d = Number(distance);
    const sigma = Number(bandwidth);

    if (
        !Number.isFinite(d) ||
        !Number.isFinite(sigma) ||
        sigma <= 0
    ) {
        return 0;
    }

    return safeExp(
        -(
            d * d
        ) /
        (
            2 * sigma * sigma
        )
    );
}

/**
 * Normalize an array so that its values sum to 1.
 */
function normalizeArray(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    const sanitized = values.map(value => {
        const x = Number(value);

        return Number.isFinite(x) && x > 0
            ? x
            : 0;
    });

    const total = sanitized.reduce(
        (sum, value) => sum + value,
        0
    );

    if (total <= 0) {
        return sanitized.map(
            () => 1 / sanitized.length
        );
    }

    return sanitized.map(
        value => value / total
    );
}

/**
 * Softmax.
 *
 * Pᵢ = exp(zᵢ) / Σ exp(zⱼ)
 *
 * Uses the standard max-subtraction trick for
 * numerical stability.
 */
function softmax(values, temperature = 1) {
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    const t = Number(temperature);

    if (!Number.isFinite(t) || t <= 0) {
        return normalizeArray(values);
    }

    const valid = values.map(value => {
        const x = Number(value);

        return Number.isFinite(x)
            ? x
            : 0;
    });

    const maxValue = Math.max(...valid);

    const exponentials = valid.map(
        value =>
            safeExp(
                (value - maxValue) / t
            )
    );

    return normalizeArray(
        exponentials
    );
}

/**
 * Linear interpolation.
 *
 * f(x) = y₁ + t(y₂-y₁)
 */
function lerp(
    start,
    end,
    t
) {
    const a = Number(start);
    const b = Number(end);
    const ratio = clamp(
        Number(t),
        0,
        1
    );

    if (
        !Number.isFinite(a) ||
        !Number.isFinite(b)
    ) {
        return 0;
    }

    return (
        a +
        ratio * (b - a)
    );
}

/**
 * Safe ratio.
 *
 * Returns fallback when denominator is too close to zero.
 */
function safeRatio(
    numerator,
    denominator,
    fallback = 0
) {
    const a = Number(numerator);
    const b = Number(denominator);

    if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        Math.abs(b) < EPSILON
    ) {
        return fallback;
    }

    return a / b;
}

/**
 * Relative difference.
 *
 * |a-b| / max(|a|, |b|)
 */
function relativeDifference(a, b) {
    const x = Number(a);
    const y = Number(b);

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y)
    ) {
        return 1;
    }

    const denominator = Math.max(
        Math.abs(x),
        Math.abs(y),
        EPSILON
    );

    return Math.abs(
        x - y
    ) / denominator;
}

/**
 * Arithmetic mean of logarithmic values.
 */
function geometricMean(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    const valid = values
        .map(Number)
        .filter(
            value =>
                Number.isFinite(value) &&
                value > 0
        );

    if (valid.length === 0) {
        return 0;
    }

    const logMean = mean(
        valid.map(safeLog)
    );

    return safeExp(logMean);
}

/**
 * Convert odds to raw implied probability.
 *
 * P = 1 / odds
 *
 * This function does NOT remove bookmaker margin.
 * Market-specific normalization belongs to marketEngine.js.
 */
function impliedProbability(odds) {
    const value = Number(odds);

    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {
        return 0;
    }

    return 1 / value;
}

/**
 * Calculate arithmetic sum.
 */
function sum(values) {
    if (!Array.isArray(values)) {
        return 0;
    }

    return values.reduce(
        (total, value) => {
            const x = Number(value);

            return Number.isFinite(x)
                ? total + x
                : total;
        },
        0
    );
}

export {
    EPSILON,
    clamp,
    safeLog,
    safeExp,
    sigmoid,
    parameterizedSigmoid,
    logit,
    mean,
    weightedMean,
    variance,
    standardDeviation,
    factorial,
    logFactorial,
    combinations,
    euclideanDistance,
    squaredEuclideanDistance,
    gaussianKernel,
    normalizeArray,
    softmax,
    lerp,
    safeRatio,
    relativeDifference,
    geometricMean,
    impliedProbability,
    sum
};

export default {
    EPSILON,
    clamp,
    safeLog,
    safeExp,
    sigmoid,
    parameterizedSigmoid,
    logit,
    mean,
    weightedMean,
    variance,
    standardDeviation,
    factorial,
    logFactorial,
    combinations,
    euclideanDistance,
    squaredEuclideanDistance,
    gaussianKernel,
    normalizeArray,
    softmax,
    lerp,
    safeRatio,
    relativeDifference,
    geometricMean,
    impliedProbability,
    sum
};