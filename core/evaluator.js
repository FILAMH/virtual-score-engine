/**
 * core/evaluator.js
 *
 * ============================================================
 * VIRTUAL SCORE ENGINE — EVALUATOR
 * ============================================================
 *
 * RÔLE :
 * Comparer une prédiction produite AVANT le match avec
 * le résultat réellement observé APRÈS le match.
 *
 * IMPORTANT :
 * - Aucun match n'est simulé.
 * - Aucun score n'est inventé.
 * - Aucune prédiction n'est modifiée.
 * - Ce module mesure uniquement la performance.
 *
 * CRITÈRE PRINCIPAL DU PROJET :
 *
 * Sur 10 matchs :
 *     au moins 7 scores réels doivent apparaître
 *     dans le TOP 3.
 *
 * CRITÈRE SECONDAIRE :
 *
 * Même lorsque le score exact n'est pas trouvé,
 * la direction HOME / DRAW / AWAY doit être évaluée.
 *
 * ============================================================
 */

"use strict";

/**
 * ------------------------------------------------------------
 * Constantes
 * ------------------------------------------------------------
 */

const TARGET_TOP3_RATE = 0.70;
const EXCELLENT_TOP3_RATE = 0.80;

/**
 * ------------------------------------------------------------
 * Validation d'un score
 * ------------------------------------------------------------
 */

function parseScore(score) {
    if (typeof score !== "string") {
        return null;
    }

    const match = score.trim().match(/^(\d+)\s*-\s*(\d+)$/);

    if (!match) {
        return null;
    }

    const home = Number(match[1]);
    const away = Number(match[2]);

    if (
        !Number.isInteger(home) ||
        !Number.isInteger(away) ||
        home < 0 ||
        away < 0
    ) {
        return null;
    }

   return {
        home,
        away
    };
}

/**
 * ------------------------------------------------------------
 * Extraction robuste d'un score prédit
 * ------------------------------------------------------------
 *
 * Les items du Top 3 peuvent se présenter sous deux formes
 * selon la source :
 *
 *   - une chaîne directe : "2-1"
 *   - un objet { score: "2-1" }
 *   - un objet { homeGoals, awayGoals } — c'est la forme
 *     produite par predictionEngine.generatePrediction() et
 *     affichée par app.js.
 *
 * Sans cette fonction, un item { homeGoals, awayGoals } sans
 * champ .score serait silencieusement traité comme "absent",
 * faussant tout le calcul de performance.
 */

function extractScoreString(item) {
    if (typeof item === "string") {
        return item;
    }

    if (item && typeof item === "object") {
        if (typeof item.score === "string") {
            return item.score;
        }

        if (
            Number.isInteger(item.homeGoals) &&
            Number.isInteger(item.awayGoals)
        ) {
            return `${item.homeGoals}-${item.awayGoals}`;
        }
    }

    return null;
}

/**
 * ------------------------------------------------------------
 * Direction d'un score
 * ------------------------------------------------------------
 *
 * HOME  = domicile gagne
 * DRAW  = match nul
 * AWAY  = extérieur gagne
 */

function getDirection(score) {
    const parsed = parseScore(score);

    if (!parsed) {
        return "UNKNOWN";
    }

    if (parsed.home > parsed.away) {
        return "HOME";
    }

    if (parsed.away > parsed.home) {
        return "AWAY";
    }

    return "DRAW";
}

/**
 * ------------------------------------------------------------
 * Normalisation d'un score fourni sous plusieurs formes
 * ------------------------------------------------------------
 */

function normalizeScore(score) {
    const parsed = parseScore(score);

    if (!parsed) {
        return null;
    }

    return `${parsed.home}-${parsed.away}`;
}

/**
 * ------------------------------------------------------------
 * Recherche du score réel dans le Top 3
 * ------------------------------------------------------------
 */

function isExactScoreInTop3(actualScore, top3) {
    const normalizedActual =
        normalizeScore(actualScore);

    if (!normalizedActual || !Array.isArray(top3)) {
        return false;
    }

    return top3.some(item => {
        const predictedScore =
            extractScoreString(item);

        return (
            normalizeScore(predictedScore) ===
            normalizedActual
        );
    });
}

/**
 * ------------------------------------------------------------
 * Position du score réel dans le Top 3
 * ------------------------------------------------------------
 *
 * Retour :
 * 1 = Top 1
 * 2 = Top 2
 * 3 = Top 3
 * 0 = absent
 */

function getExactScoreRank(actualScore, top3) {
    const normalizedActual =
        normalizeScore(actualScore);

    if (!normalizedActual || !Array.isArray(top3)) {
        return 0;
    }

    for (let i = 0; i < top3.length; i++) {
        const predictedScore =
            extractScoreString(top3[i]);

        if (
            normalizeScore(predictedScore) ===
            normalizedActual
        ) {
            return i + 1;
        }
    }

    return 0;
}

/**
 * ------------------------------------------------------------
 * Direction prédite
 * ------------------------------------------------------------
 *
 * On utilise d'abord la direction fournie par
 * predictionEngine.js.
 *
 * Si elle n'existe pas, on la reconstruit à partir
 * du Top 3.
 */

function getPredictedDirection(prediction) {
    if (!prediction) {
        return "UNKNOWN";
    }

    const explicitDirection =
        prediction.prediction?.direction ||
        prediction.direction;

    if (
        explicitDirection === "HOME" ||
        explicitDirection === "DRAW" ||
        explicitDirection === "AWAY"
    ) {
        return explicitDirection;
    }

    const top3 =
        prediction.prediction?.top3 ||
        prediction.top3;

    if (!Array.isArray(top3) || top3.length === 0) {
        return "UNKNOWN";
    }

    const counts = {
        HOME: 0,
        DRAW: 0,
        AWAY: 0
    };

    for (const item of top3) {
        const score =
            extractScoreString(item);

        const direction = getDirection(score);

        if (counts[direction] !== undefined) {
            counts[direction]++;
        }
    }

    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * ------------------------------------------------------------
 * Évaluation d'une prédiction
 * ------------------------------------------------------------
 */

function evaluatePrediction({
    prediction,
    actualScore,
    matchId = null
} = {}) {

    const normalizedActual =
        normalizeScore(actualScore);

    if (!normalizedActual) {
        throw new Error(
            "evaluator: score réel invalide."
        );
    }

    if (!prediction) {
        throw new Error(
            "evaluator: prédiction absente."
        );
    }

    const top3 =
        prediction.prediction?.top3 ||
        prediction.top3;

    if (!Array.isArray(top3) || top3.length !== 3) {
        throw new Error(
            "evaluator: la prédiction doit contenir exactement 3 scores."
        );
    }

    const actualDirection =
        getDirection(normalizedActual);

    const predictedDirection =
        getPredictedDirection(prediction);

    const exactRank =
        getExactScoreRank(
            normalizedActual,
            top3
        );

    const exactHit =
        exactRank > 0;

    const directionHit =
        predictedDirection === actualDirection;

    /**
     * Distance minimale entre le score réel et
     * les trois scores proposés.
     *
     * Distance :
     *
     * D = |H_r - H_p| + |A_r - A_p|
     *
     * Elle sert uniquement à analyser les erreurs.
     */
  let minimumScoreDistance = Infinity;

    for (const item of top3) {
        const score =
            extractScoreString(item);

        const parsed =
            parseScore(score);

        const actual =
            parseScore(normalizedActual);

        if (!parsed || !actual) {
            continue;
        }

        const distance =
            Math.abs(
                actual.home - parsed.home
            ) +
            Math.abs(
                actual.away - parsed.away
            );

        minimumScoreDistance =
            Math.min(
                minimumScoreDistance,
                distance
            );
    }

    if (!Number.isFinite(minimumScoreDistance)) {
        minimumScoreDistance = null;
    }

    return {
        matchId,

        actual: {
            score: normalizedActual,
            direction: actualDirection
        },

        prediction: {
            top3: top3.map((item, index) => ({
                rank: index + 1,
                score:
                    extractScoreString(item),
                probability:
                    typeof item === "object"
                        ? Number(item?.probability ?? 0)
                        : null
            })),

            predictedDirection
        },

        result: {
            exactScoreHit: exactHit,
            exactScoreRank: exactRank,
            directionHit,
            minimumScoreDistance
        },

        evaluatedAt:
            new Date().toISOString()
    };
}

/**
 * ------------------------------------------------------------
 * Évaluation d'une série de matchs
 * ------------------------------------------------------------
 */

function evaluateBatch(results) {
    if (!Array.isArray(results)) {
        return createEmptyMetrics();
    }

    const validResults =
        results.filter(Boolean);

    if (validResults.length === 0) {
        return createEmptyMetrics();
    }

    const total =
        validResults.length;

    const exactHits =
        validResults.filter(
            item =>
                item.result?.exactScoreHit === true
        ).length;

    const directionHits =
        validResults.filter(
            item =>
                item.result?.directionHit === true
        ).length;

    const top1Hits =
        validResults.filter(
            item =>
                item.result?.exactScoreRank === 1
        ).length;

    const top2Hits =
        validResults.filter(
            item =>
                item.result?.exactScoreRank === 2
        ).length;

    const top3Hits =
        validResults.filter(
            item =>
                item.result?.exactScoreRank === 3
        ).length;

    const totalDistance =
        validResults.reduce(
            (sum, item) =>
                sum +
                Number(
                    item.result?.minimumScoreDistance ?? 0
                ),
            0
        );

    const top3Rate =
        exactHits / total;

    const directionRate =
        directionHits / total;

    const averageDistance =
        total > 0
            ? totalDistance / total
            : 0;

    return {
        totalMatches: total,

        exactScore: {
            top1Hits,
            top2Hits,
            top3Hits,

            totalHits: exactHits,

            top3Rate,

            target70Reached:
                top3Rate >= TARGET_TOP3_RATE,

            excellent80Reached:
                top3Rate >= EXCELLENT_TOP3_RATE
        },

        direction: {
            hits: directionHits,
            rate: directionRate
        },

        error: {
            averageScoreDistance:
                averageDistance
        },

        target: {
            requiredRate:
                TARGET_TOP3_RATE,

            requiredHitsForCurrentSample:
                Math.ceil(
                    total *
                    TARGET_TOP3_RATE
                ),

            reached:
                top3Rate >= TARGET_TOP3_RATE
        }
    };
}

/**
 * ------------------------------------------------------------
 * Création de métriques vides
 * ------------------------------------------------------------
 */

function createEmptyMetrics() {
    return {
        totalMatches: 0,

        exactScore: {
            top1Hits: 0,
            top2Hits: 0,
            top3Hits: 0,
            totalHits: 0,
            top3Rate: 0,
            target70Reached: false,
            excellent80Reached: false
        },

        direction: {
            hits: 0,
            rate: 0
        },

        error: {
            averageScoreDistance: 0
        },

        target: {
            requiredRate:
                TARGET_TOP3_RATE,

            requiredHitsForCurrentSample: 0,

            reached: false
        }
    };
}

/**
 * ------------------------------------------------------------
 * Analyse des erreurs
 * ------------------------------------------------------------
 *
 * Permet de détecter les familles de problèmes :
 *
 * - mauvais vainqueur ;
 * - score trop faible ;
 * - score trop élevé ;
 * - mauvais scénario de nul ;
 * - erreur de direction malgré score proche.
 */

function analyzeError(result) {
    if (!result) {
        return null;
    }

    const actual =
        parseScore(
            result.actual?.score
        );

    if (!actual) {
        return null;
    }

    const top3 =
        result.prediction?.top3 || [];

    let averageHome = 0;
    let averageAway = 0;
    let count = 0;

    for (const item of top3) {
        const parsed =
            parseScore(extractScoreString(item));

        if (!parsed) {
            continue;
        }

        averageHome += parsed.home;
        averageAway += parsed.away;
        count++;
    }

    if (count === 0) {
        return {
            type: "INVALID_PREDICTION"
        };
    }

    averageHome /= count;
    averageAway /= count;

    const homeError =
        actual.home - averageHome;

    const awayError =
        actual.away - averageAway;

    let type = "OTHER";

    if (
        result.result?.directionHit === false
    ) {
        type = "WRONG_DIRECTION";
    } else if (
        actual.away - averageAway >= 2
    ) {
        type = "AWAY_GOAL_UNDERESTIMATION";
    } else if (
        actual.home - averageHome >= 2
    ) {
        type = "HOME_GOAL_UNDERESTIMATION";
    } else if (
        averageAway - actual.away >= 2
    ) {
        type = "AWAY_GOAL_OVERESTIMATION";
    } else if (
        averageHome - actual.home >= 2
    ) {
        type = "HOME_GOAL_OVERESTIMATION";
    }

    return {
        type,

        actualScore:
            result.actual?.score,

        predictedAverage: {
            home:
                Number(
                    averageHome.toFixed(4)
                ),

            away:
                Number(
                    averageAway.toFixed(4)
                )
        },

        error: {
            home:
                Number(
                    homeError.toFixed(4)
                ),

            away:
                Number(
                    awayError.toFixed(4)
                )
        }
    };
}

/**
 * ------------------------------------------------------------
 * Analyse complète d'une série
 * ------------------------------------------------------------
 */

function analyzeBatch(results) {
    const metrics =
        evaluateBatch(results);

    const errors =
        Array.isArray(results)
            ? results
                .map(analyzeError)
                .filter(Boolean)
            : [];

    const errorTypes = {};

    for (const error of errors) {
        errorTypes[error.type] =
            (errorTypes[error.type] || 0) + 1;
    }

    return {
        metrics,

        errorAnalysis: {
            totalAnalyzed:
                errors.length,

            categories:
                errorTypes
        }
    };
}

/**
 * ------------------------------------------------------------
 * Verdict de performance
 * ------------------------------------------------------------
 */

function getPerformanceVerdict(metrics) {
    const rate =
        Number(
            metrics?.exactScore?.top3Rate ?? 0
        );

    if (rate >= 0.80) {
        return "EXCELLENT";
    }

    if (rate >= 0.70) {
        return "TARGET_REACHED";
    }

    if (rate >= 0.60) {
        return "PROMISING";
    }

    if (rate >= 0.50) {
        return "WEAK";
    }

    return "CRITICAL";
}

/**
 * ------------------------------------------------------------
 * Vérification de l'objectif 7/10
 * ------------------------------------------------------------
 *
 * Important :
 * l'objectif est évalué sur les résultats réels,
 * jamais supposé à l'avance.
 */

function checkSevenOfTen(results) {
    const metrics =
        evaluateBatch(results);

    const total =
        metrics.totalMatches;

    const hits =
        metrics.exactScore.totalHits;

    return {
        totalMatches: total,
        exactTop3Hits: hits,

        sevenOfTen:
            total >= 10
                ? hits >= 7
                : false,

        rate:
            total > 0
                ? hits / total
                : 0
    };
}

/**
 * ------------------------------------------------------------
 * Exports
 * ------------------------------------------------------------
 */

export {
    parseScore,
    getDirection,
    normalizeScore,
    isExactScoreInTop3,
    getExactScoreRank,
    getPredictedDirection,
    evaluatePrediction,
    evaluateBatch,
    createEmptyMetrics,
    analyzeError,
    analyzeBatch,
    getPerformanceVerdict,
    checkSevenOfTen
};