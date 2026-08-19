/**
 * utils/probability.js
 * ------------------------------------------------------------
 * Probability utilities
 * ------------------------------------------------------------
 *
 * ROLE
 * ----
 * Shared probability utilities used by the prediction pipeline.
 *
 * This file provides:
 *   - probability sanitization
 *   - probability normalization
 *   - odds -> implied probability conversion
 *   - probability -> fair odds conversion
 *   - log-probability utilities
 *   - entropy
 *   - softmax
 *   - weighted probability fusion
 *   - probability distance / divergence helpers
 *
 * This file DOES NOT:
 *   - parse raw match text
 *   - calculate team lambdas
 *   - simulate matches
 *   - generate score distributions
 *   - apply Dixon-Coles correction
 *   - select the final Top 3 scores
 *
 * Those responsibilities belong to the corresponding
 * core/ and models/ modules.
 *
 * ------------------------------------------------------------
 */

const EPSILON = 1e-15;
const DEFAULT_TEMPERATURE = 1;

/**
 * Keep a probability numerically safe.
 */
function clampProbability(value) {
    const p = Number(value);

    if (!Number.isFinite(p)) {
        return EPSILON;
    }

    return Math.max(
        EPSILON,
        Math.min(1 - EPSILON, p)
    );
}

/**
 * Clamp a generic probability while allowing exact 0 and 1.
 */
function safeProbability(value) {
    const p = Number(value);

    if (!Number.isFinite(p)) {
        return 0;
    }

    return Math.max(0, Math.min(1, p));
}

/**
 * Normalize an array of non-negative values so that
 * their sum equals 1.
 */
function normalize(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    const sanitized = values.map(value => {
        const n = Number(value);

        return Number.isFinite(n) && n > 0
            ? n
            : 0;
    });

    const total = sanitized.reduce(
        (sum, value) => sum + value,
        0
    );

    if (total <= 0) {
        const uniform = 1 / sanitized.length;

        return sanitized.map(() => uniform);
    }

    return sanitized.map(value => value / total);
}

/**
 * Normalize probabilities stored inside objects.
 *
 * Example:
 * [
 *   { score: "1-0", probability: 0.4 },
 *   { score: "1-1", probability: 0.6 }
 * ]
 */
function normalizeProbabilityObjects(
    items,
    probabilityKey = "probability"
) {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    const probabilities = items.map(item =>
        Number(item?.[probabilityKey]) || 0
    );

    const normalized = normalize(probabilities);

    return items.map((item, index) => ({
        ...item,
        [probabilityKey]: normalized[index]
    }));
}

/**
 * Convert decimal bookmaker odds to implied probability.
 *
 * p = 1 / odds
 */
function oddsToImpliedProbability(odds) {
    const value = Number(odds);

    if (!Number.isFinite(value) || value <= 1) {
        return 0;
    }

    return 1 / value;
}

/**
 * Convert a set of decimal odds into normalized market
 * probabilities.
 *
 * This removes the bookmaker overround by normalization.
 */
function oddsToNormalizedProbabilities(odds) {
    if (!Array.isArray(odds) || odds.length === 0) {
        return [];
    }

    const implied = odds.map(oddsToImpliedProbability);

    return normalize(implied);
}

/**
 * Convert a fair probability to decimal fair odds.
 */
function probabilityToFairOdds(probability) {
    const p = Number(probability);

    if (!Number.isFinite(p) || p <= 0) {
        return Infinity;
    }

    return 1 / p;
}

/**
 * Calculate bookmaker overround.
 *
 * overround = sum(1 / odds) - 1
 */
function calculateOverround(odds) {
    if (!Array.isArray(odds) || odds.length === 0) {
        return 0;
    }

    const impliedTotal = odds.reduce(
        (sum, odd) =>
            sum + oddsToImpliedProbability(odd),
        0
    );

    return Math.max(0, impliedTotal - 1);
}

/**
 * Convert a probability into a log-probability.
 */
function logProbability(probability) {
    return Math.log(
        clampProbability(probability)
    );
}

/**
 * Exponentiate a log-probability safely.
 */
function expLogProbability(logValue) {
    const value = Number(logValue);

    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.exp(value);
}

/**
 * Calculate Shannon entropy.
 *
 * H(P) = -sum(p_i log(p_i))
 */
function entropy(probabilities) {
    const normalized = normalize(probabilities);

    return -normalized.reduce(
        (sum, p) =>
            sum + p * Math.log(
                Math.max(p, EPSILON)
            ),
        0
    );
}

/**
 * Calculate normalized entropy.
 *
 * Returns a value between 0 and 1.
 */
function normalizedEntropy(probabilities) {
    const normalized = normalize(probabilities);

    if (normalized.length <= 1) {
        return 0;
    }

    const maximumEntropy =
        Math.log(normalized.length);

    if (maximumEntropy <= 0) {
        return 0;
    }

    return entropy(normalized) / maximumEntropy;
}

/**
 * Numerically stable softmax.
 *
 * softmax(x_i) =
 * exp(x_i - max(x)) /
 * sum(exp(x_j - max(x)))
 */
function softmax(
    values,
    temperature = DEFAULT_TEMPERATURE
) {
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    const t = Number(temperature);

    const safeTemperature =
        Number.isFinite(t) && t > 0
            ? t
            : DEFAULT_TEMPERATURE;

    const numbers = values.map(value => {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    });

    const maxValue = Math.max(...numbers);

    const exponentials = numbers.map(value =>
        Math.exp(
            (value - maxValue) /
            safeTemperature
        )
    );

    return normalize(exponentials);
}

/**
 * Weighted fusion between two probability values.
 *
 * result = alpha * pA + (1-alpha) * pB
 */
function weightedProbability(
    probabilityA,
    probabilityB,
    alpha = 0.5
) {
    const a = safeProbability(probabilityA);
    const b = safeProbability(probabilityB);

    const weight = Math.max(
        0,
        Math.min(1, Number(alpha))
    );

    return (
        weight * a +
        (1 - weight) * b
    );
}

/**
 * Fuse two complete probability distributions.
 *
 * Both arrays must represent the same ordered states.
 */
function weightedDistributionFusion(
    distributionA,
    distributionB,
    alpha = 0.5
) {
    if (
        !Array.isArray(distributionA) ||
        !Array.isArray(distributionB) ||
        distributionA.length !== distributionB.length
    ) {
        return [];
    }

    const weight = Math.max(
        0,
        Math.min(1, Number(alpha))
    );

    const fused = distributionA.map(
        (probability, index) => {
            const a = Number(probability) || 0;
            const b = Number(
                distributionB[index]
            ) || 0;

            return (
                weight * a +
                (1 - weight) * b
            );
        }
    );

    return normalize(fused);
}

/**
 * Binary Brier score.
 *
 * BS = (p - y)^2
 */
function brierScore(probability, outcome) {
    const p = safeProbability(probability);
    const y = Number(outcome) === 1 ? 1 : 0;

    return Math.pow(p - y, 2);
}

/**
 * Multiclass Brier score.
 */
function multiclassBrierScore(
    predicted,
    actualIndex
) {
    if (!Array.isArray(predicted)) {
        return Infinity;
    }

    const probabilities = normalize(predicted);

    const index = Number(actualIndex);

    if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= probabilities.length
    ) {
        return Infinity;
    }

    return probabilities.reduce(
        (sum, probability, i) => {
            const actual = i === index ? 1 : 0;

            return sum +
                Math.pow(
                    probability - actual,
                    2
                );
        },
        0
    );
}

/**
 * Cross-entropy / negative log-likelihood.
 *
 * Only the probability assigned to the observed
 * outcome is required.
 */
function logLoss(probability) {
    return -logProbability(probability);
}

/**
 * Kullback-Leibler divergence.
 *
 * KL(P || Q) =
 * sum P(x) log(P(x) / Q(x))
 */
function klDivergence(
    distributionP,
    distributionQ
) {
    if (
        !Array.isArray(distributionP) ||
        !Array.isArray(distributionQ) ||
        distributionP.length !== distributionQ.length
    ) {
        return Infinity;
    }

    const p = normalize(distributionP);
    const q = normalize(distributionQ);

    return p.reduce(
        (sum, probabilityP, index) => {
            if (probabilityP <= 0) {
                return sum;
            }

            const probabilityQ =
                Math.max(q[index], EPSILON);

            return sum +
                probabilityP *
                Math.log(
                    probabilityP /
                    probabilityQ
                );
        },
        0
    );
}

/**
 * Jensen-Shannon divergence.
 *
 * JSD(P,Q) =
 * 1/2 KL(P||M) + 1/2 KL(Q||M)
 */
function jsDivergence(
    distributionP,
    distributionQ
) {
    if (
        !Array.isArray(distributionP) ||
        !Array.isArray(distributionQ) ||
        distributionP.length !== distributionQ.length
    ) {
        return Infinity;
    }

    const p = normalize(distributionP);
    const q = normalize(distributionQ);

    const midpoint = p.map(
        (value, index) =>
            0.5 * (
                value +
                q[index]
            )
    );

    return (
        0.5 *
        klDivergence(p, midpoint)
        +
        0.5 *
        klDivergence(q, midpoint)
    );
}

/**
 * Calculate cumulative probability.
 *
 * Useful for selecting the smallest number of
 * outcomes required to reach a probability mass.
 */
function cumulativeProbability(
    probabilities
) {
    const normalized = normalize(probabilities);

    let cumulative = 0;

    return normalized.map(probability => {
        cumulative += probability;
        return cumulative;
    });
}

/**
 * Find the index containing the maximum probability.
 */
function argMax(probabilities) {
    if (
        !Array.isArray(probabilities) ||
        probabilities.length === 0
    ) {
        return -1;
    }

    let bestIndex = 0;
    let bestValue = Number(
        probabilities[0]
    ) || 0;

    for (
        let i = 1;
        i < probabilities.length;
        i++
    ) {
        const value =
            Number(probabilities[i]) || 0;

        if (value > bestValue) {
            bestValue = value;
            bestIndex = i;
        }
    }

    return bestIndex;
}

/**
 * Return probabilities sorted from highest
 * to lowest while preserving their original index.
 */
function rankProbabilities(probabilities) {
    if (!Array.isArray(probabilities)) {
        return [];
    }

    return probabilities
        .map((probability, index) => ({
            index,
            probability:
                safeProbability(probability)
        }))
        .sort(
            (a, b) =>
                b.probability -
                a.probability
        );
}

/**
 * Validate that a probability distribution is valid.
 */
function isValidDistribution(
    probabilities,
    tolerance = 1e-9
) {
    if (
        !Array.isArray(probabilities) ||
        probabilities.length === 0
    ) {
        return false;
    }

    const values = probabilities.map(Number);

    if (
        values.some(
            value =>
                !Number.isFinite(value) ||
                value < 0
        )
    ) {
        return false;
    }

    const total = values.reduce(
        (sum, value) => sum + value,
        0
    );

    return Math.abs(total - 1) <= tolerance;
}

export {
    clampProbability,
    safeProbability,
    normalize,
    normalizeProbabilityObjects,
    oddsToImpliedProbability,
    oddsToNormalizedProbabilities,
    probabilityToFairOdds,
    calculateOverround,
    logProbability,
    expLogProbability,
    entropy,
    normalizedEntropy,
    softmax,
    weightedProbability,
    weightedDistributionFusion,
    brierScore,
    multiclassBrierScore,
    logLoss,
    klDivergence,
    jsDivergence,
    cumulativeProbability,
    argMax,
    rankProbabilities,
    isValidDistribution
};

export default {
    clampProbability,
    safeProbability,
    normalize,
    normalizeProbabilityObjects,
    oddsToImpliedProbability,
    oddsToNormalizedProbabilities,
    probabilityToFairOdds,
    calculateOverround,
    logProbability,
    expLogProbability,
    entropy,
    normalizedEntropy,
    softmax,
    weightedProbability,
    weightedDistributionFusion,
    brierScore,
    multiclassBrierScore,
    logLoss,
    klDivergence,
    jsDivergence,
    cumulativeProbability,
    argMax,
    rankProbabilities,
    isValidDistribution
};