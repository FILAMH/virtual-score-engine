/**
 * models/dixonColes.js
 * ------------------------------------------------------------
 * Dixon-Coles low-score correction model
 * ------------------------------------------------------------
 *
 * ROLE
 * ----
 * Correct the joint probability of low football scores:
 *
 *   0-0
 *   1-0
 *   0-1
 *   1-1
 *
 * The base probabilities come from the existing goal model:
 *
 *   P(X=x) = Poisson(x | lambda)
 *
 * or another compatible marginal model.
 *
 * This file DOES NOT:
 *   - parse bookmaker odds
 *   - calculate lambdas
 *   - classify regimes
 *   - select Top 3 scores
 *   - simulate matches
 *
 * It only applies the Dixon-Coles correction.
 *
 * ------------------------------------------------------------
 */

const DEFAULT_RHO = 0;
const MIN_PROBABILITY = 1e-15;
const MAX_ABS_RHO = 0.25;

/**
 * Clamp rho to a numerically safe range.
 *
 * The parameter rho controls the low-score dependence.
 *
 * tau(0,0) = 1 - lambdaHome * lambdaAway * rho
 * tau(1,0) = 1 + lambdaAway * rho
 * tau(0,1) = 1 + lambdaHome * rho
 * tau(1,1) = 1 - rho
 */
function sanitizeRho(rho) {
    const value = Number(rho);

    if (!Number.isFinite(value)) {
        return DEFAULT_RHO;
    }

    return Math.max(
        -MAX_ABS_RHO,
        Math.min(MAX_ABS_RHO, value)
    );
}

/**
 * Sanitize lambda.
 */
function sanitizeLambda(lambda) {
    const value = Number(lambda);

    if (!Number.isFinite(value)) {
        return MIN_PROBABILITY;
    }

    return Math.max(MIN_PROBABILITY, value);
}

/**
 * Dixon-Coles correction factor tau(x,y).
 *
 * For scores outside the four low-score cells:
 *
 *   tau(x,y) = 1
 *
 * This is important because the correction must NOT
 * arbitrarily modify the entire score distribution.
 */
function tau(
    homeGoals,
    awayGoals,
    lambdaHome,
    lambdaAway,
    rho = DEFAULT_RHO
) {
    const x = Number(homeGoals);
    const y = Number(awayGoals);

    const lh = sanitizeLambda(lambdaHome);
    const la = sanitizeLambda(lambdaAway);
    const r = sanitizeRho(rho);

    if (x === 0 && y === 0) {
        return 1 - lh * la * r;
    }

    if (x === 1 && y === 0) {
        return 1 + la * r;
    }

    if (x === 0 && y === 1) {
        return 1 + lh * r;
    }

    if (x === 1 && y === 1) {
        return 1 - r;
    }

    return 1;
}

/**
 * Apply Dixon-Coles correction to a base score probability.
 */
function correctedProbability(
    homeGoals,
    awayGoals,
    baseProbability,
    lambdaHome,
    lambdaAway,
    rho = DEFAULT_RHO
) {
    const base = Number(baseProbability);

    if (!Number.isFinite(base) || base < 0) {
        return 0;
    }

    const correction = tau(
        homeGoals,
        awayGoals,
        lambdaHome,
        lambdaAway,
        rho
    );

    return Math.max(
        0,
        base * correction
    );
}

/**
 * Build a corrected score matrix.
 *
 * `baseMatrix` must contain objects of the form:
 *
 * {
 *   home: 0,
 *   away: 0,
 *   probability: 0.XX
 * }
 */
function applyCorrection(
    baseMatrix,
    lambdaHome,
    lambdaAway,
    rho = DEFAULT_RHO
) {
    if (!Array.isArray(baseMatrix)) {
        return [];
    }

    const corrected = baseMatrix.map(item => ({
        ...item,
        probability: correctedProbability(
            item.home,
            item.away,
            item.probability,
            lambdaHome,
            lambdaAway,
            rho
        )
    }));

    return normalize(corrected);
}

/**
 * Normalize probabilities after the Dixon-Coles adjustment.
 *
 * Because tau changes some cells, the total can no longer
 * necessarily equal exactly 1.
 */
function normalize(matrix) {
    if (!Array.isArray(matrix) || matrix.length === 0) {
        return [];
    }

    const total = matrix.reduce(
        (sum, item) =>
            sum +
            (Number.isFinite(item.probability)
                ? item.probability
                : 0),
        0
    );

    if (total <= 0) {
        return matrix.map(item => ({
            ...item,
            probability: 0
        }));
    }

    return matrix.map(item => ({
        ...item,
        probability:
            Math.max(0, item.probability) / total
    }));
}

/**
 * Return only the correction multiplier for a score.
 *
 * Useful when another engine already owns the
 * probability calculation.
 */
function correctionFactor(
    homeGoals,
    awayGoals,
    lambdaHome,
    lambdaAway,
    rho = DEFAULT_RHO
) {
    return tau(
        homeGoals,
        awayGoals,
        lambdaHome,
        lambdaAway,
        rho
    );
}

/**
 * Calculate the four low-score correction factors.
 */
function lowScoreCorrections(
    lambdaHome,
    lambdaAway,
    rho = DEFAULT_RHO
) {
    return {
        "0-0": correctionFactor(
            0,
            0,
            lambdaHome,
            lambdaAway,
            rho
        ),

        "1-0": correctionFactor(
            1,
            0,
            lambdaHome,
            lambdaAway,
            rho
        ),

        "0-1": correctionFactor(
            0,
            1,
            lambdaHome,
            lambdaAway,
            rho
        ),

        "1-1": correctionFactor(
            1,
            1,
            lambdaHome,
            lambdaAway,
            rho
        )
    };
}

/**
 * Estimate rho from historical low-score observations.
 *
 * This is intentionally conservative.
 *
 * The function provides an empirical starting value;
 * production calibration should use walk-forward validation
 * rather than hard-coding a supposedly universal rho.
 */
function estimateRho(
    historicalMatches,
    options = {}
) {
    if (!Array.isArray(historicalMatches)) {
        return DEFAULT_RHO;
    }

    const matches = historicalMatches.filter(match =>
        Number.isInteger(Number(match.homeGoals)) &&
        Number.isInteger(Number(match.awayGoals))
    );

    if (matches.length < 20) {
        return DEFAULT_RHO;
    }

    const minSample = Number(options.minSample || 20);

    if (matches.length < minSample) {
        return DEFAULT_RHO;
    }

    /*
     * Empirical low-score dependence.
     *
     * We measure the observed frequency of the four
     * Dixon-Coles cells and compare it with the
     * independent baseline when available.
     *
     * A complete maximum-likelihood estimation of rho
     * requires the corresponding lambda values.
     *
     * Therefore this function returns a conservative
     * initialization rather than pretending to know a
     * universal coefficient.
     */

    const lowScoreCount = matches.filter(match => {
        const h = Number(match.homeGoals);
        const a = Number(match.awayGoals);

        return (
            (h === 0 && a === 0) ||
            (h === 1 && a === 0) ||
            (h === 0 && a === 1) ||
            (h === 1 && a === 1)
        );
    }).length;

    const lowScoreRate =
        lowScoreCount / matches.length;

    /*
     * Keep the empirical initializer deliberately bounded.
     * The final rho should be learned by likelihood validation.
     */
    const baseline = 0.25;

    const deviation = lowScoreRate - baseline;

    const estimated =
        deviation * 0.20;

    return sanitizeRho(estimated);
}

/**
 * Log-likelihood contribution of a single observed score.
 *
 * Useful for future parameter calibration.
 */
function logLikelihood(
    homeGoals,
    awayGoals,
    baseProbability,
    lambdaHome,
    lambdaAway,
    rho = DEFAULT_RHO
) {
    const corrected = correctedProbability(
        homeGoals,
        awayGoals,
        baseProbability,
        lambdaHome,
        lambdaAway,
        rho
    );

    if (corrected <= 0) {
        return -Infinity;
    }

    return Math.log(corrected);
}

/**
 * Total log-likelihood across historical observations.
 */
function totalLogLikelihood(
    observations,
    rho = DEFAULT_RHO
) {
    if (!Array.isArray(observations)) {
        return -Infinity;
    }

    return observations.reduce(
        (total, observation) => {
            const value = logLikelihood(
                observation.homeGoals,
                observation.awayGoals,
                observation.baseProbability,
                observation.lambdaHome,
                observation.lambdaAway,
                rho
            );

            return total + value;
        },
        0
    );
}

export {
    tau,
    correctedProbability,
    correctionFactor,
    lowScoreCorrections,
    applyCorrection,
    normalize,
    estimateRho,
    logLikelihood,
    totalLogLikelihood
};

export default {
    tau,
    correctedProbability,
    correctionFactor,
    lowScoreCorrections,
    applyCorrection,
    normalize,
    estimateRho,
    logLikelihood,
    totalLogLikelihood
};