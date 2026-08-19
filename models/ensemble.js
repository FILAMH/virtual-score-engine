/**
 * models/ensemble.js
 * ------------------------------------------------------------
 * ENSEMBLE MODEL
 * ------------------------------------------------------------
 *
 * ROLE
 * ----
 * Combines probability distributions produced by the existing
 * statistical models:
 *
 *   - Poisson
 *   - Negative Binomial
 *   - Dixon-Coles
 *
 * This module DOES NOT:
 *   - parse incoming matches
 *   - parse bookmaker odds
 *   - calculate lambdas
 *   - classify match direction
 *   - classify regimes
 *   - calculate upset probability
 *   - select the final Top 3
 *   - simulate a match
 *
 * Its only responsibility is to create a mathematically valid
 * ensemble probability distribution.
 *
 * ------------------------------------------------------------
 */

const DEFAULT_WEIGHTS = Object.freeze({
    poisson: 0.30,
    negativeBinomial: 0.45,
    dixonColes: 0.25
});

const EPSILON = 1e-15;

/**
 * Convert a value into a finite non-negative number.
 */
function safeProbability(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        return 0;
    }

    return number;
}

/**
 * Normalize model weights.
 *
 * If the supplied weights are invalid or their total is zero,
 * the default ensemble weights are used.
 */
function normalizeWeights(weights = DEFAULT_WEIGHTS) {
    const poisson = safeProbability(weights.poisson);
    const negativeBinomial = safeProbability(
        weights.negativeBinomial
    );
    const dixonColes = safeProbability(
        weights.dixonColes
    );

    const total =
        poisson +
        negativeBinomial +
        dixonColes;

    if (total <= EPSILON) {
        return { ...DEFAULT_WEIGHTS };
    }

    return {
        poisson: poisson / total,
        negativeBinomial: negativeBinomial / total,
        dixonColes: dixonColes / total
    };
}

/**
 * Create a stable key for an exact score.
 */
function scoreKey(item) {
    if (
        Number.isInteger(Number(item.home)) &&
        Number.isInteger(Number(item.away))
    ) {
        return `${Number(item.home)}-${Number(item.away)}`;
    }

    if (typeof item.score === "string") {
        return item.score;
    }

    return null;
}

/**
 * Convert a model distribution into a Map.
 */
function distributionToMap(distribution) {
    const map = new Map();

    if (!Array.isArray(distribution)) {
        return map;
    }

    for (const item of distribution) {
        const key = scoreKey(item);

        if (!key) {
            continue;
        }

        map.set(
            key,
            safeProbability(item.probability)
        );
    }

    return map;
}

/**
 * Extract all score keys appearing in any model.
 */
function collectScoreKeys(distributions) {
    const keys = new Set();

    for (const distribution of distributions) {
        if (!Array.isArray(distribution)) {
            continue;
        }

        for (const item of distribution) {
            const key = scoreKey(item);

            if (key) {
                keys.add(key);
            }
        }
    }

    return keys;
}

/**
 * Parse a score key such as "2-1".
 */
function parseScoreKey(key) {
    const match = /^(\d+)-(\d+)$/.exec(key);

    if (!match) {
        return null;
    }

    return {
        home: Number(match[1]),
        away: Number(match[2])
    };
}

/**
 * Normalize a score distribution.
 */
function normalizeDistribution(distribution) {
    if (!Array.isArray(distribution) || distribution.length === 0) {
        return [];
    }

    const total = distribution.reduce(
        (sum, item) =>
            sum + safeProbability(item.probability),
        0
    );

    if (total <= EPSILON) {
        return distribution.map(item => ({
            ...item,
            probability: 0
        }));
    }

    return distribution.map(item => ({
        ...item,
        probability:
            safeProbability(item.probability) / total
    }));
}

/**
 * Weighted arithmetic ensemble.
 *
 * Mathematical definition:
 *
 * P_ensemble(s)
 * =
 * Σ_m w_m P_m(s)
 *
 * where:
 *
 * Σ_m w_m = 1
 *
 * and:
 *
 * m ∈ {Poisson, NegativeBinomial, DixonColes}
 */
function weightedEnsemble({
    poisson = [],
    negativeBinomial = [],
    dixonColes = [],
    weights = DEFAULT_WEIGHTS
}) {
    const normalizedWeights = normalizeWeights(weights);

    const distributions = [
        poisson,
        negativeBinomial,
        dixonColes
    ];

    const maps = distributions.map(
        distributionToMap
    );

    const keys = collectScoreKeys(
        distributions
    );

    const result = [];

    for (const key of keys) {
        const poissonProbability =
            maps[0].get(key) || 0;

        const negativeBinomialProbability =
            maps[1].get(key) || 0;

        const dixonColesProbability =
            maps[2].get(key) || 0;

        const probability =
            normalizedWeights.poisson *
                poissonProbability +
            normalizedWeights.negativeBinomial *
                negativeBinomialProbability +
            normalizedWeights.dixonColes *
                dixonColesProbability;

        const parsed = parseScoreKey(key);

        if (!parsed) {
            continue;
        }

        result.push({
            home: parsed.home,
            away: parsed.away,
            score: key,
            probability
        });
    }

    return normalizeDistribution(result);
}

/**
 * Apply dynamic weights according to the current regime.
 *
 * The values are intentionally configurable.
 *
 * LOW:
 *   More weight on Poisson/Dixon-Coles.
 *
 * NORMAL:
 *   Balanced ensemble.
 *
 * BLOWOUT:
 *   More weight on Negative Binomial because it handles
 *   overdispersion and heavier scoring tails.
 */
function regimeWeights(regime) {
    switch (String(regime || "").toUpperCase()) {
        case "LOW":
            return {
                poisson: 0.40,
                negativeBinomial: 0.30,
                dixonColes: 0.30
            };

        case "BLOWOUT":
            return {
                poisson: 0.15,
                negativeBinomial: 0.65,
                dixonColes: 0.20
            };

        case "NORMAL":
        default:
            return {
                poisson: 0.30,
                negativeBinomial: 0.45,
                dixonColes: 0.25
            };
    }
}

/**
 * Blend regime-specific weights with externally learned weights.
 *
 * alpha = 1:
 *   completely regime-driven.
 *
 * alpha = 0:
 *   completely parameter-driven.
 */
function blendWeights(
    learnedWeights,
    regime,
    alpha = 0.5
) {
    const a = Math.max(
        0,
        Math.min(1, Number(alpha))
    );

    const learned = normalizeWeights(
        learnedWeights
    );

    const regimeBased = normalizeWeights(
        regimeWeights(regime)
    );

    return normalizeWeights({
        poisson:
            (1 - a) * learned.poisson +
            a * regimeBased.poisson,

        negativeBinomial:
            (1 - a) * learned.negativeBinomial +
            a * regimeBased.negativeBinomial,

        dixonColes:
            (1 - a) * learned.dixonColes +
            a * regimeBased.dixonColes
    });
}

/**
 * Calculate entropy of a probability distribution.
 *
 * H(P) = -Σ p_i log(p_i)
 */
function entropy(distribution) {
    if (!Array.isArray(distribution)) {
        return 0;
    }

    return -distribution.reduce(
        (sum, item) => {
            const p = safeProbability(
                item.probability
            );

            if (p <= EPSILON) {
                return sum;
            }

            return sum + p * Math.log(p);
        },
        0
    );
}

/**
 * Calculate concentration of the ensemble.
 *
 * C = Σ p_i²
 *
 * Higher concentration means the model puts more mass
 * into a smaller number of exact scores.
 */
function concentration(distribution) {
    if (!Array.isArray(distribution)) {
        return 0;
    }

    return distribution.reduce(
        (sum, item) => {
            const p = safeProbability(
                item.probability
            );

            return sum + p * p;
        },
        0
    );
}

/**
 * Calculate disagreement between models.
 *
 * Mean absolute probability difference:
 *
 * D =
 * (1 / |S|)
 * Σ_s |P_A(s) - P_B(s)|
 */
function modelDisagreement(
    distributionA,
    distributionB
) {
    const mapA =
        distributionToMap(distributionA);

    const mapB =
        distributionToMap(distributionB);

    const keys = new Set([
        ...mapA.keys(),
        ...mapB.keys()
    ]);

    if (keys.size === 0) {
        return 0;
    }

    let difference = 0;

    for (const key of keys) {
        difference += Math.abs(
            (mapA.get(key) || 0) -
            (mapB.get(key) || 0)
        );
    }

    return difference / keys.size;
}

/**
 * Full ensemble analysis.
 */
function buildEnsemble({
    poisson = [],
    negativeBinomial = [],
    dixonColes = [],
    regime = "NORMAL",
    learnedWeights = DEFAULT_WEIGHTS,
    regimeAlpha = 0.5
}) {
    const weights = blendWeights(
        learnedWeights,
        regime,
        regimeAlpha
    );

    const distribution = weightedEnsemble({
        poisson,
        negativeBinomial,
        dixonColes,
        weights
    });

    return {
        distribution,
        weights,
        statistics: {
            entropy: entropy(distribution),
            concentration: concentration(distribution),
            disagreement: {
                poissonNegativeBinomial:
                    modelDisagreement(
                        poisson,
                        negativeBinomial
                    ),

                poissonDixonColes:
                    modelDisagreement(
                        poisson,
                        dixonColes
                    ),

                negativeBinomialDixonColes:
                    modelDisagreement(
                        negativeBinomial,
                        dixonColes
                    )
            }
        }
    };
}

/**
 * Return the highest-probability exact scores.
 *
 * This helper does NOT replace predictionEngine.js.
 * It is only a reusable ranking utility.
 */
function rankDistribution(
    distribution,
    limit = 3
) {
    if (!Array.isArray(distribution)) {
        return [];
    }

    const count = Math.max(
        1,
        Math.floor(Number(limit) || 3)
    );

    return [...distribution]
        .sort(
            (a, b) =>
                b.probability -
                a.probability
        )
        .slice(0, count);
}

export {
    DEFAULT_WEIGHTS,
    normalizeWeights,
    normalizeDistribution,
    weightedEnsemble,
    regimeWeights,
    blendWeights,
    entropy,
    concentration,
    modelDisagreement,
    buildEnsemble,
    rankDistribution
};

export default {
    DEFAULT_WEIGHTS,
    normalizeWeights,
    normalizeDistribution,
    weightedEnsemble,
    regimeWeights,
    blendWeights,
    entropy,
    concentration,
    modelDisagreement,
    buildEnsemble,
    rankDistribution
};