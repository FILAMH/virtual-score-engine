/**
 * models/poisson.js
 * ------------------------------------------------------------
 * Poisson probability model.
 *
 * RESPONSIBILITY:
 * - Compute Poisson PMF P(X = k)
 * - Compute Poisson CDF
 * - Generate a goal-probability distribution
 * - Compute expected value
 * - Keep all numerical operations stable
 *
 * IMPORTANT:
 * This module DOES NOT predict a match.
 * It is only a mathematical probability component.
 * ------------------------------------------------------------
 */

/**
 * Numerically stable factorial.
 *
 * For the goal ranges used by this project (normally 0-10),
 * direct multiplication is sufficient and avoids unnecessary
 * dependencies.
 *
 * @param {number} n
 * @returns {number}
 */
function factorial(n) {
    if (!Number.isInteger(n) || n < 0) {
        throw new Error("factorial(n): n must be a non-negative integer.");
    }

    if (n === 0 || n === 1) {
        return 1;
    }

    let result = 1;

    for (let i = 2; i <= n; i++) {
        result *= i;
    }

    return result;
}


/**
 * Poisson probability mass function.
 *
 * P(X = k) = exp(-lambda) * lambda^k / k!
 *
 * @param {number} lambda
 * @param {number} k
 * @returns {number}
 */
function poissonPMF(lambda, k) {
    validateLambda(lambda);
    validateGoalCount(k);

    if (lambda === 0) {
        return k === 0 ? 1 : 0;
    }

    const probability =
        Math.exp(-lambda) *
        Math.pow(lambda, k) /
        factorial(k);

    return clampProbability(probability);
}


/**
 * Poisson cumulative distribution function.
 *
 * P(X <= k) = SUM(P(X = i)), i = 0 ... k
 *
 * @param {number} lambda
 * @param {number} k
 * @returns {number}
 */
function poissonCDF(lambda, k) {
    validateLambda(lambda);
    validateGoalCount(k);

    let cumulative = 0;

    for (let i = 0; i <= k; i++) {
        cumulative += poissonPMF(lambda, i);
    }

    return clampProbability(cumulative);
}


/**
 * Generate a Poisson goal distribution.
 *
 * The distribution is normalized after truncation so that the
 * returned probabilities sum exactly to approximately 1.
 *
 * @param {number} lambda
 * @param {number} maxGoals
 * @returns {number[]}
 */
function poissonDistribution(lambda, maxGoals = 10) {
    validateLambda(lambda);

    if (!Number.isInteger(maxGoals) || maxGoals < 0) {
        throw new Error("maxGoals must be a non-negative integer.");
    }

    const distribution = [];

    for (let goals = 0; goals <= maxGoals; goals++) {
        distribution.push(poissonPMF(lambda, goals));
    }

    return normalizeDistribution(distribution);
}


/**
 * Expected number of goals.
 *
 * For Poisson:
 *
 * E[X] = lambda
 *
 * @param {number} lambda
 * @returns {number}
 */
function poissonMean(lambda) {
    validateLambda(lambda);
    return lambda;
}


/**
 * Variance of Poisson distribution.
 *
 * Var(X) = lambda
 *
 * @param {number} lambda
 * @returns {number}
 */
function poissonVariance(lambda) {
    validateLambda(lambda);
    return lambda;
}


/**
 * Probability of at least one goal.
 *
 * P(X >= 1) = 1 - P(X = 0)
 *            = 1 - exp(-lambda)
 *
 * @param {number} lambda
 * @returns {number}
 */
function probabilityAtLeastOne(lambda) {
    validateLambda(lambda);

    return clampProbability(
        1 - Math.exp(-lambda)
    );
}


/**
 * Probability of no goal.
 *
 * P(X = 0) = exp(-lambda)
 *
 * @param {number} lambda
 * @returns {number}
 */
function probabilityZero(lambda) {
    validateLambda(lambda);

    return clampProbability(
        Math.exp(-lambda)
    );
}


/**
 * Probability of scoring at least n goals.
 *
 * P(X >= n) = 1 - P(X <= n - 1)
 *
 * @param {number} lambda
 * @param {number} n
 * @returns {number}
 */
function probabilityAtLeast(lambda, n) {
    validateLambda(lambda);

    if (!Number.isInteger(n) || n < 0) {
        throw new Error("n must be a non-negative integer.");
    }

    if (n === 0) {
        return 1;
    }

    return clampProbability(
        1 - poissonCDF(lambda, n - 1)
    );
}


/**
 * Probability of scoring at most n goals.
 *
 * @param {number} lambda
 * @param {number} n
 * @returns {number}
 */
function probabilityAtMost(lambda, n) {
    return poissonCDF(lambda, n);
}


/**
 * Validate lambda.
 *
 * @param {number} lambda
 */
function validateLambda(lambda) {
    if (
        typeof lambda !== "number" ||
        !Number.isFinite(lambda) ||
        lambda < 0
    ) {
        throw new Error(
            "Poisson lambda must be a finite number >= 0."
        );
    }
}


/**
 * Validate goal count.
 *
 * @param {number} k
 */
function validateGoalCount(k) {
    if (!Number.isInteger(k) || k < 0) {
        throw new Error(
            "Goal count must be a non-negative integer."
        );
    }
}


/**
 * Keep probability inside [0, 1].
 *
 * @param {number} value
 * @returns {number}
 */
function clampProbability(value) {
    return Math.min(1, Math.max(0, value));
}


/**
 * Normalize a probability array.
 *
 * @param {number[]} values
 * @returns {number[]}
 */
function normalizeDistribution(values) {
    const total = values.reduce(
        (sum, value) => sum + value,
        0
    );

    if (!Number.isFinite(total) || total <= 0) {
        throw new Error(
            "Cannot normalize an invalid probability distribution."
        );
    }

    return values.map(
        value => value / total
    );
}


export {
    factorial,
    poissonPMF,
    poissonCDF,
    poissonDistribution,
    poissonMean,
    poissonVariance,
    probabilityAtLeastOne,
    probabilityZero,
    probabilityAtLeast,
    probabilityAtMost
};