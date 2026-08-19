/**
 * core/scoreFusion.js
 *
 * ============================================================
 * SCORE FUSION ENGINE
 * ============================================================
 *
 * Rôle :
 * Combiner les probabilités produites par le moteur mathématique
 * avec les probabilités issues de la mémoire historique.
 *
 * Ce fichier NE génère pas de match.
 * Ce fichier NE simule pas de match.
 * Ce fichier NE décide pas seul du Top 3.
 *
 * Il construit uniquement une distribution finale P(score).
 *
 * Pipeline :
 *
 * parser
 *    ↓
 * normalizer
 *    ↓
 * featureEngine
 *    ↓
 * historicalEngine ───────┐
 * marketEngine            │
 * directionEngine         │
 * regimeEngine            │
 * upsetEngine             │
 * lambdaEngine            │
 * distributionEngine ────┤
 *                         ↓
 *                  scoreFusion.js
 *                         ↓
 *                predictionEngine.js
 *
 * ============================================================
 */

"use strict";

/**
 * Clamp numérique.
 */
function clamp(value, min = 0, max = 1) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/**
 * Normalise une distribution de scores.
 *
 * Entrée :
 * {
 *   "0-0": 0.12,
 *   "1-0": 0.15,
 *   ...
 * }
 *
 * Sortie :
 * distribution dont la somme vaut exactement 1.
 */
function normalizeDistribution(distribution) {
    if (!distribution || typeof distribution !== "object") {
        return {};
    }

    const cleaned = {};
    let total = 0;

    for (const [score, probability] of Object.entries(distribution)) {
        const p = Number(probability);

        if (!Number.isFinite(p) || p < 0) {
            continue;
        }

        cleaned[score] = p;
        total += p;
    }

    if (total <= 0) {
        return {};
    }

    for (const score of Object.keys(cleaned)) {
        cleaned[score] /= total;
    }

    return cleaned;
}

/**
 * Fusion de deux distributions :
 *
 * P_final(s)
 * =
 * (1 - W_memory) * P_model(s)
 * +
 * W_memory * P_history(s)
 *
 * Le résultat est ensuite renormalisé.
 */
function fuseDistributions(
    modelDistribution,
    historicalDistribution,
    memoryWeight = 0
) {
    const model = normalizeDistribution(modelDistribution);
    const history = normalizeDistribution(historicalDistribution);

    const weight = clamp(memoryWeight);

    const scores = new Set([
        ...Object.keys(model),
        ...Object.keys(history)
    ]);

    const fused = {};

    for (const score of scores) {
        const pModel = model[score] || 0;
        const pHistory = history[score] || 0;

        fused[score] =
            (1 - weight) * pModel +
            weight * pHistory;
    }

    return normalizeDistribution(fused);
}

/**
 * Calcul du poids mémoire à partir de la similarité.
 *
 * W =
 * σ(k(S - S0))
 *
 * avec :
 *
 * σ(x) = 1 / (1 + exp(-x))
 *
 * Une similarité faible conserve davantage le modèle mathématique.
 * Une similarité élevée donne davantage de poids à l'historique.
 */
function calculateMemoryWeight(
    similarity = 0,
    options = {}
) {
    const S = clamp(similarity);

    const S0 = Number.isFinite(options.S0)
        ? options.S0
        : 0.75;

    const k = Number.isFinite(options.k)
        ? options.k
        : 10;

    const raw = 1 / (
        1 + Math.exp(-k * (S - S0))
    );

    return clamp(raw);
}

/**
 * Renforcement contrôlé d'une distribution historique
 * lorsqu'une signature historique est extrêmement proche.
 *
 * Ce mécanisme ne crée aucun nouveau score.
 * Il ne fait que modifier le poids de la mémoire.
 */
function calculateEffectiveMemoryWeight({
    similarity = 0,
    exactMatch = false,
    baseWeight = null,
    S0 = 0.75,
    k = 10
} = {}) {

    let weight = baseWeight;

    if (!Number.isFinite(weight)) {
        weight = calculateMemoryWeight(
            similarity,
            { S0, k }
        );
    }

    /**
     * Une correspondance extrêmement forte doit permettre
     * à l'historique de devenir dominant.
     *
     * Important :
     * on ne force jamais arbitrairement un score.
     * La mémoire reste une distribution probabiliste.
     */
    if (exactMatch && similarity >= 0.95) {
        weight = Math.max(weight, 0.90);
    }

    if (similarity >= 0.98) {
        weight = Math.max(weight, 0.95);
    }

    return clamp(weight);
}

/**
 * Petit ajustement directionnel.
 *
 * Le but est d'éviter qu'un biais historique ou mathématique
 * écrase complètement la direction détectée par les autres moteurs.
 *
 * direction :
 *   HOME
 *   DRAW
 *   AWAY
 *   BALANCED
 */
function applyDirectionAdjustment(
    distribution,
    direction = null,
    strength = 0
) {
    const result = { ...distribution };

    const s = clamp(strength);

    if (!direction || s <= 0) {
        return result;
    }

    for (const score of Object.keys(result)) {
        const parts = score.split("-").map(Number);

        if (parts.length !== 2) continue;

        const home = parts[0];
        const away = parts[1];

        let multiplier = 1;

        if (direction === "HOME" && home > away) {
            multiplier = 1 + s;
        }

        if (direction === "AWAY" && away > home) {
            multiplier = 1 + s;
        }

        if (direction === "DRAW" && home === away) {
            multiplier = 1 + s;
        }

        result[score] *= multiplier;
    }

    return normalizeDistribution(result);
}

/**
 * Ajustement spécifique au scénario Away Blowout.
 *
 * Ce fichier ne décide PAS qu'un massacre aura lieu.
 * upsetEngine.js / directionEngine.js fournissent déjà
 * le signal.
 *
 * Ici nous ne faisons qu'intégrer ce signal dans la fusion.
 */
function applyAwayBlowoutAdjustment(
    distribution,
    probability = 0
) {
    const p = clamp(probability);

    if (p <= 0) {
        return distribution;
    }

    const result = { ...distribution };

    for (const score of Object.keys(result)) {
        const parts = score.split("-").map(Number);

        if (parts.length !== 2) continue;

        const home = parts[0];
        const away = parts[1];

        /**
         * Les scores 0-3, 0-4, 0-5, 1-4, 1-5, 2-4...
         * reçoivent progressivement plus de poids.
         */
        if (away > home && away >= 3) {
            const margin = away - home;

            const boost =
                1 +
                p *
                Math.min(
                    1.5,
                    0.35 + margin * 0.15
                );

            result[score] *= boost;
        }
    }

    return normalizeDistribution(result);
}

/**
 * Ajustement spécifique au scénario Home Blowout.
 *
 * Symétrique du signal Away Blowout.
 */
function applyHomeBlowoutAdjustment(
    distribution,
    probability = 0
) {
    const p = clamp(probability);

    if (p <= 0) {
        return distribution;
    }

    const result = { ...distribution };

    for (const score of Object.keys(result)) {
        const parts = score.split("-").map(Number);

        if (parts.length !== 2) continue;

        const home = parts[0];
        const away = parts[1];

        if (home > away && home >= 3) {
            const margin = home - away;

            const boost =
                1 +
                p *
                Math.min(
                    1.5,
                    0.35 + margin * 0.15
                );

            result[score] *= boost;
        }
    }

    return normalizeDistribution(result);
}

/**
 * Pipeline principal de fusion.
 *
 * Cette fonction reçoit les résultats des moteurs précédents.
 */
function fuseScorePredictions({
    modelDistribution = {},
    historicalDistribution = {},
    similarity = 0,
    exactMatch = false,
    direction = null,
    directionStrength = 0,
    awayBlowoutProbability = 0,
    homeBlowoutProbability = 0,
    memoryConfig = {}
} = {}) {

    const effectiveWeight =
        calculateEffectiveMemoryWeight({
            similarity,
            exactMatch,
            baseWeight: memoryConfig.baseWeight,
            S0: memoryConfig.S0 ?? 0.75,
            k: memoryConfig.k ?? 10
        });

    /**
     * Étape 1 :
     * fusion modèle + mémoire.
     */
    let fused = fuseDistributions(
        modelDistribution,
        historicalDistribution,
        effectiveWeight
    );

    /**
     * Étape 2 :
     * cohérence directionnelle.
     */
    fused = applyDirectionAdjustment(
        fused,
        direction,
        directionStrength
    );

    /**
     * Étape 3 :
     * intégration des scénarios de blowout.
     */
    fused = applyAwayBlowoutAdjustment(
        fused,
        awayBlowoutProbability
    );

    fused = applyHomeBlowoutAdjustment(
        fused,
        homeBlowoutProbability
    );

    /**
     * Dernière normalisation obligatoire.
     */
    fused = normalizeDistribution(fused);

    return {
        distribution: fused,
        memoryWeight: effectiveWeight,
        similarity: clamp(similarity),
        exactMemoryMatch: Boolean(exactMatch)
    };
}

/**
 * Retourne les scores classés par probabilité.
 *
 * predictionEngine.js utilisera cette sortie pour construire
 * le Top 3 final.
 */
function rankScores(distribution, limit = 3) {
    return Object.entries(
        normalizeDistribution(distribution)
    )
        .map(([score, probability]) => ({
            score,
            probability
        }))
        .sort(
            (a, b) =>
                b.probability - a.probability
        )
        .slice(0, limit);
}

export {
    normalizeDistribution,
    fuseDistributions,
    calculateMemoryWeight,
    calculateEffectiveMemoryWeight,
    applyDirectionAdjustment,
    applyAwayBlowoutAdjustment,
    applyHomeBlowoutAdjustment,
    fuseScorePredictions,
    rankScores
};