/**
 * utils/validation.js
 * ------------------------------------------------------------
 * Validation and integrity utilities
 * ------------------------------------------------------------
 *
 * ROLE
 * ----
 * Central validation layer for the virtual-score-engine.
 *
 * This module verifies that data exchanged between the parser,
 * normalizer, feature engine, historical engine, market engine,
 * mathematical models and prediction pipeline is structurally
 * and numerically valid.
 *
 * IMPORTANT
 * ---------
 * This file does NOT:
 *   - predict matches
 *   - simulate matches
 *   - calculate Poisson probabilities
 *   - calculate lambdas
 *   - apply Dixon-Coles correction
 *   - select Top 3 scores
 *
 * It only validates data.
 *
 * ------------------------------------------------------------
 */

const EPSILON = 1e-12;

const VALID_REGIMES = new Set([
    "LOW",
    "NORMAL",
    "BLOWOUT"
]);

const VALID_RESULT_TYPES = new Set([
    "HOME",
    "DRAW",
    "AWAY"
]);

/**
 * Generic finite-number check.
 */
function isFiniteNumber(value) {
    return (
        typeof value === "number" &&
        Number.isFinite(value)
    );
}

/**
 * Convert a numeric-looking value safely.
 */
function toFiniteNumber(value) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}

/**
 * Check whether a value is a valid non-negative number.
 */
function isNonNegativeNumber(value) {
    const number = Number(value);

    return (
        Number.isFinite(number) &&
        number >= 0
    );
}

/**
 * Check whether a value is a valid probability.
 */
function isProbability(value) {
    const number = Number(value);

    return (
        Number.isFinite(number) &&
        number >= 0 &&
        number <= 1
    );
}

/**
 * Check whether a value is a valid positive decimal odd.
 */
function isValidDecimalOdd(value) {
    const number = Number(value);

    return (
        Number.isFinite(number) &&
        number > 1
    );
}

/**
 * Validate an ISO-like date/time string.
 */
function isValidDateTime(value) {
    if (
        typeof value !== "string" ||
        value.trim() === ""
    ) {
        return false;
    }

    const timestamp = Date.parse(value);

    return Number.isFinite(timestamp);
}

/**
 * Validate a team name.
 */
function isValidTeamName(value) {
    return (
        typeof value === "string" &&
        value.trim().length >= 1 &&
        value.trim().length <= 120
    );
}

/**
 * Validate a score.
 */
function isValidScore(homeGoals, awayGoals) {
    const home = Number(homeGoals);
    const away = Number(awayGoals);

    return (
        Number.isInteger(home) &&
        Number.isInteger(away) &&
        home >= 0 &&
        away >= 0
    );
}

/**
 * Validate a match identity.
 *
 * Historical matches may have only:
 *   - home team
 *   - away team
 *   - date/time
 *   - final score
 *
 * They do NOT require bookmaker odds.
 */
function validateMatchIdentity(match) {
    const errors = [];

    if (!match || typeof match !== "object") {
        return {
            valid: false,
            errors: ["Match must be an object."]
        };
    }

    const home =
        match.homeTeam ??
        match.home ??
        match.team1;

    const away =
        match.awayTeam ??
        match.away ??
        match.team2;

    if (!isValidTeamName(home)) {
        errors.push(
            "Invalid or missing home team."
        );
    }

    if (!isValidTeamName(away)) {
        errors.push(
            "Invalid or missing away team."
        );
    }

    if (
        typeof match.date !== "string" &&
        typeof match.datetime !== "string" &&
        typeof match.dateTime !== "string"
    ) {
        errors.push(
            "Missing match date/time."
        );
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate a completed historical match.
 */
function validateHistoricalMatch(match) {
    const identity =
        validateMatchIdentity(match);

    const errors = [
        ...identity.errors
    ];

    const homeGoals =
        match.homeGoals ??
        match.homeScore ??
        match.score?.home;

    const awayGoals =
        match.awayGoals ??
        match.awayScore ??
        match.score?.away;

    if (!isValidScore(homeGoals, awayGoals)) {
        errors.push(
            "Historical match must contain a valid final score."
        );
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate an optional odds object.
 *
 * Odds are OPTIONAL for ordinary historical matches.
 * They are required only when the historical record
 * intentionally preserves a captured pre-match market.
 */
function validateOddsObject(odds) {
    if (
        odds === null ||
        odds === undefined
    ) {
        return {
            valid: true,
            errors: []
        };
    }

    if (
        typeof odds !== "object" ||
        Array.isArray(odds)
    ) {
        return {
            valid: false,
            errors: ["Odds must be an object."]
        };
    }

    const errors = [];

    for (const [key, value] of Object.entries(odds)) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            continue;
        }

        if (!isValidDecimalOdd(value)) {
            errors.push(
                `Invalid decimal odd for "${key}".`
            );
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate the complete incoming event.
 *
 * This is used before an event enters the
 * prediction pipeline.
 */
function validateIncomingEvent(event) {
    const identity =
        validateMatchIdentity(event);

    const errors = [
        ...identity.errors
    ];

    const hasOdds =
        event?.odds &&
        typeof event.odds === "object";

    if (hasOdds) {
        const oddsResult =
            validateOddsObject(event.odds);

        errors.push(
            ...oddsResult.errors
        );
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate a goal intensity / lambda pair.
 */
function validateLambdas(
    lambdaHome,
    lambdaAway
) {
    const errors = [];

    if (
        !isFiniteNumber(Number(lambdaHome)) ||
        Number(lambdaHome) <= 0
    ) {
        errors.push(
            "Invalid home lambda."
        );
    }

    if (
        !isFiniteNumber(Number(lambdaAway)) ||
        Number(lambdaAway) <= 0
    ) {
        errors.push(
            "Invalid away lambda."
        );
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate a single score-probability object.
 */
function validateScoreProbability(item) {
    const errors = [];

    if (!item || typeof item !== "object") {
        return {
            valid: false,
            errors: [
                "Score probability must be an object."
            ]
        };
    }

    if (
        !Number.isInteger(Number(item.home)) ||
        Number(item.home) < 0
    ) {
        errors.push(
            "Invalid home score."
        );
    }

    if (
        !Number.isInteger(Number(item.away)) ||
        Number(item.away) < 0
    ) {
        errors.push(
            "Invalid away score."
        );
    }

    if (!isProbability(item.probability)) {
        errors.push(
            "Invalid score probability."
        );
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate a complete probability distribution.
 *
 * The total must be approximately 1.
 */
function validateDistribution(
    distribution,
    tolerance = 1e-8
) {
    if (
        !Array.isArray(distribution) ||
        distribution.length === 0
    ) {
        return {
            valid: false,
            errors: [
                "Distribution must be a non-empty array."
            ]
        };
    }

    const errors = [];

    let total = 0;

    for (const item of distribution) {
        const result =
            validateScoreProbability(item);

        errors.push(
            ...result.errors
        );

        if (
            result.valid &&
            isProbability(item.probability)
        ) {
            total += Number(
                item.probability
            );
        }
    }

    if (
        Math.abs(total - 1) > tolerance
    ) {
        errors.push(
            `Probability distribution must sum to 1. Current total: ${total}.`
        );
    }

    return {
        valid: errors.length === 0,
        errors,
        total
    };
}

/**
 * Validate a prediction candidate.
 */
function validatePredictionCandidate(candidate) {
    const errors = [];

    if (!candidate || typeof candidate !== "object") {
        return {
            valid: false,
            errors: [
                "Prediction candidate must be an object."
            ]
        };
    }

    if (
        !Number.isInteger(Number(candidate.home)) ||
        Number(candidate.home) < 0
    ) {
        errors.push(
            "Invalid predicted home score."
        );
    }

    if (
        !Number.isInteger(Number(candidate.away)) ||
        Number(candidate.away) < 0
    ) {
        errors.push(
            "Invalid predicted away score."
        );
    }

    if (
        candidate.probability !== undefined &&
        !isProbability(candidate.probability)
    ) {
        errors.push(
            "Invalid prediction probability."
        );
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate the mandatory Top 3 prediction.
 *
 * The prediction engine must provide exactly three
 * distinct score candidates.
 */
function validateTop3(predictions) {
    if (!Array.isArray(predictions)) {
        return {
            valid: false,
            errors: [
                "Top 3 prediction must be an array."
            ]
        };
    }

    const errors = [];

    if (predictions.length !== 3) {
        errors.push(
            `Top 3 prediction must contain exactly 3 scores. Received ${predictions.length}.`
        );
    }

    const seen = new Set();

    for (const candidate of predictions) {
        const result =
            validatePredictionCandidate(candidate);

        errors.push(
            ...result.errors
        );

        if (result.valid) {
            const key =
                `${Number(candidate.home)}-${Number(candidate.away)}`;

            if (seen.has(key)) {
                errors.push(
                    `Duplicate score in Top 3: ${key}.`
                );
            }

            seen.add(key);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Determine the match result from a final score.
 */
function determineResult(
    homeGoals,
    awayGoals
) {
    if (
        !isValidScore(
            homeGoals,
            awayGoals
        )
    ) {
        return null;
    }

    const home = Number(homeGoals);
    const away = Number(awayGoals);

    if (home > away) {
        return "HOME";
    }

    if (home < away) {
        return "AWAY";
    }

    return "DRAW";
}

/**
 * Validate a result label.
 */
function isValidResultType(result) {
    return VALID_RESULT_TYPES.has(
        String(result).toUpperCase()
    );
}

/**
 * Validate regime.
 */
function isValidRegime(regime) {
    return VALID_REGIMES.has(
        String(regime).toUpperCase()
    );
}

/**
 * Validate a generic weight.
 */
function isValidWeight(weight) {
    const value = Number(weight);

    return (
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
    );
}

/**
 * Validate an alpha used for probability fusion.
 */
function validateFusionWeight(alpha) {
    return {
        valid: isValidWeight(alpha),
        errors: isValidWeight(alpha)
            ? []
            : [
                "Fusion weight alpha must be between 0 and 1."
            ]
    };
}

/**
 * Validate an entire prediction record before storage.
 */
function validatePredictionRecord(record) {
    const errors = [];

    if (
        !record ||
        typeof record !== "object"
    ) {
        return {
            valid: false,
            errors: [
                "Prediction record must be an object."
            ]
        };
    }

    const identity =
        validateMatchIdentity(record);

    errors.push(
        ...identity.errors
    );

    const top3 =
        record.top3 ??
        record.predictions ??
        record.scores;

    const top3Result =
        validateTop3(top3);

    errors.push(
        ...top3Result.errors
    );

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate historical dataset.
 *
 * A historical dataset can contain:
 *
 *   1. score-only matches
 *   2. matches with captured pre-match odds
 *
 * Therefore odds are never mandatory.
 */
function validateHistoricalDataset(matches) {
    if (!Array.isArray(matches)) {
        return {
            valid: false,
            errors: [
                "Historical dataset must be an array."
            ]
        };
    }

    const errors = [];

    matches.forEach((match, index) => {
        const result =
            validateHistoricalMatch(match);

        if (!result.valid) {
            errors.push({
                index,
                errors: result.errors
            });
        }

        if (match?.odds !== undefined) {
            const oddsResult =
                validateOddsObject(match.odds);

            if (!oddsResult.valid) {
                errors.push({
                    index,
                    errors: oddsResult.errors
                });
            }
        }
    });

    return {
        valid: errors.length === 0,
        errors,
        count: matches.length
    };
}

/**
 * Summarize a list of validation errors (strings, or
 * per-index error groups) into one readable message.
 */
function summarizeErrors(errors) {
    if (!Array.isArray(errors) || errors.length === 0) {
        return null;
    }

    return errors
        .map((entry) => {
            if (typeof entry === "string") {
                return entry;
            }

            if (entry && typeof entry === "object") {
                const prefix =
                    entry.index !== undefined
                        ? `Match ${entry.index + 1}: `
                        : "";

                const inner =
                    Array.isArray(entry.errors)
                        ? entry.errors.join(", ")
                        : "";

                return `${prefix}${inner}`;
            }

            return String(entry);
        })
        .join(" | ");
}

/**
 * Adapter expected by app.js.
 * Wraps validateHistoricalDataset and adds a
 * human-readable "message" field.
 */
function validateHistoricalData(matches) {
    const result =
        validateHistoricalDataset(matches);

    return {
        valid: result.valid,
        message: result.valid
            ? null
            : summarizeErrors(result.errors),
        errors: result.errors,
        count: result.count
    };
}

/**
 * Adapter expected by app.js.
 * Wraps validateIncomingEvent and adds a
 * human-readable "message" field.
 */
function validateCurrentMatch(event) {
    const result =
        validateIncomingEvent(event);

    return {
        valid: result.valid,
        message: result.valid
            ? null
            : summarizeErrors(result.errors),
        errors: result.errors
    };
}

/**
 * Validate the structural integrity of the
 * final Top 3 prediction before presenting it.
 */
function validateFinalPrediction(prediction) {
    const errors = [];

    if (!prediction || typeof prediction !== "object") {
        return {
            valid: false,
            errors: [
                "Final prediction must be an object."
            ]
        };
    }

    const top3 =
        prediction.top3 ??
        prediction.predictions;

    const top3Result =
        validateTop3(top3);

    errors.push(
        ...top3Result.errors
    );

    if (
        prediction.regime !== undefined &&
        !isValidRegime(prediction.regime)
    ) {
        errors.push(
            "Invalid prediction regime."
        );
    }

    if (
        prediction.direction !== undefined &&
        !isValidResultType(
            prediction.direction
        )
    ) {
        errors.push(
            "Invalid prediction direction."
        );
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Throw an Error when validation fails.
 *
 * Useful at critical pipeline boundaries.
 */
function assertValid(
    validationResult,
    context = "Validation"
) {
    if (
        !validationResult ||
        validationResult.valid !== true
    ) {
        const details =
            validationResult?.errors ?? [
                "Unknown validation error."
            ];

        throw new Error(
            `${context} failed: ${JSON.stringify(details)}`
        );
    }

    return true;
}

export {
    isFiniteNumber,
    toFiniteNumber,
    isNonNegativeNumber,
    isProbability,
    isValidDecimalOdd,
    isValidDateTime,
    isValidTeamName,
    isValidScore,
    validateMatchIdentity,
    validateHistoricalMatch,
    validateOddsObject,
    validateIncomingEvent,
    validateLambdas,
    validateScoreProbability,
    validateDistribution,
    validatePredictionCandidate,
    validateTop3,
    determineResult,
    isValidResultType,
    isValidRegime,
    isValidWeight,
    validateFusionWeight,
    validatePredictionRecord,
    validateHistoricalDataset,
    validateHistoricalData,
    validateCurrentMatch,
    validateFinalPrediction,
    assertValid
};

export default {
    isFiniteNumber,
    toFiniteNumber,
    isNonNegativeNumber,
    isProbability,
    isValidDecimalOdd,
    isValidDateTime,
    isValidTeamName,
    isValidScore,
    validateMatchIdentity,
    validateHistoricalMatch,
    validateOddsObject,
    validateIncomingEvent,
    validateLambdas,
    validateScoreProbability,
    validateDistribution,
    validatePredictionCandidate,
    validateTop3,
    determineResult,
    isValidResultType,
    isValidRegime,
    isValidWeight,
    validateFusionWeight,
    validatePredictionRecord,
    validateHistoricalDataset,
    validateHistoricalData,
    validateCurrentMatch,
    validateFinalPrediction,
    assertValid
};