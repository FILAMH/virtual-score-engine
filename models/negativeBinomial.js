/**
 * models/negativeBinomial.js
 * ------------------------------------------------------------
 * Negative Binomial probability model.
 *
 * RESPONSIBILITY:
 * - Compute Negative Binomial PMF
 * - Generate a normalized goal distribution
 * - Compute mean and variance
 * - Measure overdispersion
 *
 * This module does NOT predict matches.
 * It only provides probability functions.
 * ------------------------------------------------------------
 */

/**
 * Negative Binomial parameterization:
 *
 * Mean:
 *     μ = mean
 *
 * Dispersion:
 *     φ > 0
 *
 * Variance:
 *     Var(X) = μ + φμ²
 *
 * Probability:
 *
 * P(X=k) =
 * Γ(k+r)
 * ---------------- × p^r × (1-p)^k
 * Γ(r)Γ(k+1)
 *
 * where:
 *
 *     r = 1 / φ
 *     p = r / (r + μ)
 *
 * When φ -> 0, the model approaches Poisson.
 */


/**
 * Convert mean + dispersion into NB parameters.
 *
 * @param {number} mean
 * @param {number} dispersion
 * @returns {{r:number,p:number}}
 */
function getParameters(mean, dispersion) {
    validateMean(mean);
    validateDispersion(dispersion);

    /*
     * Very small dispersion is numerically close to Poisson.
     * We still keep a positive value for the NB formulation.
     */
    const safeDispersion = Math.max(
        dispersion,
        Number.EPSILON
    );

    const r = 1 / safeDispersion;
    const p = r / (r + mean);

    return { r, p };
}


/**
 * Log-Gamma using the Lanczos approximation.
 *
 * This avoids factorial overflow for larger goal counts.
 *
 * @param {number} z
 * @returns {number}
 */
function logGamma(z) {
    const coefficients = [
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7
    ];

    if (z < 0.5) {
        return (
            Math.log(Math.PI) -
            Math.log(Math.sin(Math.PI * z)) -
            logGamma(1 - z)
        );
    }

    z -= 1;

    let x = 0.99999999999980993;

    for (let i = 0; i < coefficients.length; i++) {
        x += coefficients[i] / (z + i + 1);
    }

    const t = z + coefficients.length - 0.5;

    return (
        0.5 * Math.log(2 * Math.PI) +
        (z + 0.5) * Math.log(t) -
        t +
        Math.log(x)
    );
}


/**
 * Negative Binomial PMF.
 *
 * P(X=k) =
 * Γ(k+r)/(Γ(r)Γ(k+1))
 * × p^r × (1-p)^k
 *
 * @param {number} mean
 * @param {number} dispersion
 * @param {number} k
 * @returns {number}
 */
function negativeBinomialPMF(mean, dispersion, k) {
    validateMean(mean);
    validateDispersion(dispersion);
    validateGoalCount(k);

    if (mean === 0) {
        return k === 0 ? 1 : 0;
    }

    const { r, p } = getParameters(
        mean,
        dispersion
    );

    const logProbability =
        logGamma(k + r) -
        logGamma(r) -
        logGamma(k + 1) +
        r * Math.log(p) +
        k * Math.log(1 - p);

    const probability = Math.exp(
        logProbability
    );

    return clampProbability(probability);
}


/**
 * Generate a Negative Binomial goal distribution.
 *
 * @param {number} mean
 * @param {number} dispersion
 * @param {number} maxGoals
 * @returns {number[]}
 */
function negativeBinomialDistribution(
    mean,
    dispersion,
    maxGoals = 10
) {
    validateMean(mean);
    validateDispersion(dispersion);

    if (
        !Number.isInteger(maxGoals) ||
        maxGoals < 0
    ) {
        throw new Error(
            "maxGoals must be a non-negative integer."
        );
    }

    const distribution = [];

    for (
        let goals = 0;
        goals <= maxGoals;
        goals++
    ) {
        distribution.push(
            negativeBinomialPMF(
                mean,
                dispersion,
                goals
            )
        );
    }

    return normalizeDistribution(
        distribution
    );
}


/**
 * Expected value.
 *
 * E[X] = μ
 *
 * @param {number} mean
 * @returns {number}
 */
function negativeBinomialMean(mean) {
    validateMean(mean);

    return mean;
}


/**
 * Variance.
 *
 * Var(X) = μ + φμ²
 *
 * @param {number} mean
 * @param {number} dispersion
 * @returns {number}
 */
function negativeBinomialVariance(
    mean,
    dispersion
) {
    validateMean(mean);
    validateDispersion(dispersion);

    return (
        mean +
        dispersion * Math.pow(mean, 2)
    );
}


/**
 * Standard deviation.
 *
 * @param {number} mean
 * @param {number} dispersion
 * @returns {number}
 */
function negativeBinomialStdDev(
    mean,
    dispersion
) {
    return Math.sqrt(
        negativeBinomialVariance(
            mean,
            dispersion
        )
    );
}


/**
 * Overdispersion ratio:
 *
 * Var(X) / E[X]
 *
 * For Poisson this equals 1.
 * For Negative Binomial it is:
 *
 * 1 + φμ
 *
 * @param {number} mean
 * @param {number} dispersion
 * @returns {number}
 */
function overdispersionRatio(
    mean,
    dispersion
) {
    validateMean(mean);
    validateDispersion(dispersion);

    return (
        negativeBinomialVariance(
            mean,
            dispersion
        ) / mean
    );
}


/**
 * Clamp probability to [0,1].
 *
 * @param {number} value
 * @returns {number}
 */
function clampProbability(value) {
    return Math.min(
        1,
        Math.max(0, value)
    );
}


/**
 * Normalize a distribution.
 *
 * @param {number[]} values
 * @returns {number[]}
 */
function normalizeDistribution(values) {
    const total = values.reduce(
        (sum, value) => sum + value,
        0
    );

    if (
        !Number.isFinite(total) ||
        total <= 0
    ) {
        throw new Error(
            "Invalid probability distribution."
        );
    }

    return values.map(
        value => value / total
    );
}


/**
 * Validate mean.
 *
 * @param {number} mean
 */
function validateMean(mean) {
    if (
        typeof mean !== "number" ||
        !Number.isFinite(mean) ||
        mean < 0
    ) {
        throw new Error(
            "Mean must be a finite number >= 0."
        );
    }
}


/**
 * Validate dispersion.
 *
 * φ must be strictly positive.
 *
 * @param {number} dispersion
 */
function validateDispersion(dispersion) {
    if (
        typeof dispersion !== "number" ||
        !Number.isFinite(dispersion) ||
        dispersion <= 0
    ) {
        throw new Error(
            "Dispersion must be a finite number > 0."
        );
    }
}


/**
 * Validate goal count.
 *
 * @param {number} k
 */
function validateGoalCount(k) {
    if (
        !Number.isInteger(k) ||
        k < 0
    ) {
        throw new Error(
            "Goal count must be a non-negative integer."
        );
    }
}


export {
    getParameters,
    logGamma,
    negativeBinomialPMF,
    negativeBinomialDistribution,
    negativeBinomialMean,
    negativeBinomialVariance,
    negativeBinomialStdDev,
    overdispersionRatio
};