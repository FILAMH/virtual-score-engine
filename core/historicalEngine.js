/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * core/historicalEngine.js
 * ============================================================
 *
 * RÔLE :
 * Comparer le nouvel événement avec les matchs historiques
 * disponibles et construire une mémoire probabiliste exploitable
 * par les moteurs suivants.
 *
 * ENTRÉE :
 *   - features du match actuel
 *   - historique normalisé
 *
 * SORTIE :
 *   - matchs similaires
 *   - scores historiques similaires
 *   - distribution historique des scores
 *   - direction historique
 *   - niveau de confiance de la mémoire
 *
 * IMPORTANT :
 * Ce module NE fait PAS la prédiction finale.
 * Il ne choisit PAS les Top 3.
 * Il fournit uniquement la mémoire historique.
 *
 * ============================================================
 */

'use strict';

/* ============================================================
 * CONFIGURATION
 * ============================================================ */

const DEFAULT_CONFIG = {
    cosineWeight: 0.70,
    tanimotoWeight: 0.30,
    
    topK: 10,
    
    minimumSimilarity: 0.20,
    
    exactSignatureThreshold: 0.95,
    
    similarityPower: 2.0,
    
    maxGoalsPerTeam: 10,
    
    /*
     * Un match historique "score seul" (sans cotes capturées,
     * cas normal selon la section 5 du cahier des charges) ne
     * peut pas être comparé par similarité de marché — son
     * vecteur de features est vide. Plutôt que de l'exclure
     * silencieusement (ce qui viderait la mémoire historique
     * entière quand aucun snapshot de marché n'a été conservé),
     * on lui attribue une similarité de référence modérée, en
     * dessous du seuil "haute similarité" mais suffisante pour
     * qu'il contribue proportionnellement aux distributions.
     */
    scoreOnlyBaselineSimilarity: 0.30
};


/* ============================================================
 * OUTILS DE BASE
 * ============================================================ */

/**
 * Convertit une valeur en nombre sûr.
 */
function safeNumber(value, fallback = 0) {
    const n = Number(value);

    return Number.isFinite(n) ? n : fallback;
}


/**
 * Limite une valeur dans [min, max].
 */
function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}


/**
 * Arrondissement contrôlé.
 */
function round(value, decimals = 6) {
    const factor = 10 ** decimals;

    return Math.round(value * factor) / factor;
}


/* ============================================================
 * VECTORISATION
 * ============================================================ */

/**
 * Transforme les features produites par featureEngine.js
 * en vecteur numérique stable.
 *
 * Si featureEngine fournit déjà :
 *
 * {
 *   vector: [...]
 * }
 *
 * celui-ci est utilisé directement.
 *
 * Sinon, le moteur tente de construire le vecteur à partir
 * des propriétés numériques disponibles.
 */
function extractFeatureVector(features) {
    if (!features || typeof features !== 'object') {
        return [];
    }

    if (Array.isArray(features.vector)) {
        return features.vector
            .map(value => safeNumber(value))
            .filter(Number.isFinite);
    }

    if (Array.isArray(features.featureVector)) {
        return features.featureVector
            .map(value => safeNumber(value))
            .filter(Number.isFinite);
    }

    const vector = [];

    function collect(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            vector.push(value);
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                collect(item);
            }

            return;
        }

        if (
            value &&
            typeof value === 'object'
        ) {
            for (const nested of Object.values(value)) {
                collect(nested);
            }
        }
    }

    collect(features);

    return vector;
}


/**
 * Rend deux vecteurs de même dimension.
 *
 * IMPORTANT :
 * On ne tronque pas silencieusement.
 * Les valeurs manquantes sont complétées par 0 afin de conserver
 * une comparaison déterministe.
 */
function alignVectors(a, b) {
    const size = Math.max(a.length, b.length);

    const vectorA = new Array(size).fill(0);
    const vectorB = new Array(size).fill(0);

    for (let i = 0; i < a.length; i++) {
        vectorA[i] = safeNumber(a[i]);
    }

    for (let i = 0; i < b.length; i++) {
        vectorB[i] = safeNumber(b[i]);
    }

    return {
        a: vectorA,
        b: vectorB
    };
}


/* ============================================================
 * COSINE SIMILARITY
 * ============================================================ */

/**
 * Similarité cosinus :
 *
 *              Σ(aᵢbᵢ)
 * C(a,b) = --------------------
 *           ||a|| ||b||
 */
function cosineSimilarity(vectorA, vectorB) {
    const {
        a,
        b
    } = alignVectors(vectorA, vectorB);

    if (a.length === 0) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];

        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator =
        Math.sqrt(normA) *
        Math.sqrt(normB);

    if (denominator <= Number.EPSILON) {
        return 0;
    }

    return clamp(dot / denominator, 0, 1);
}


/* ============================================================
 * TANIMOTO / JACCARD CONTINU
 * ============================================================ */

/**
 * Similarité de Tanimoto pour vecteurs numériques :
 *
 *              a·b
 * T(a,b) = -----------------
 *           ||a||² + ||b||² - a·b
 */
function tanimotoSimilarity(vectorA, vectorB) {
    const {
        a,
        b
    } = alignVectors(vectorA, vectorB);

    if (a.length === 0) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];

        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator =
        normA +
        normB -
        dot;

    if (Math.abs(denominator) <= Number.EPSILON) {
        return 1;
    }

    return clamp(dot / denominator, 0, 1);
}


/* ============================================================
 * SIMILARITÉ COMPOSITE
 * ============================================================ */

/**
 * Similarité finale :
 *
 * S = 0.70 × Cosine + 0.30 × Tanimoto
 */
function compositeSimilarity(
    vectorA,
    vectorB,
    config = DEFAULT_CONFIG
) {
    const cosine =
        cosineSimilarity(vectorA, vectorB);

    const tanimoto =
        tanimotoSimilarity(vectorA, vectorB);

    const cosineWeight =
        safeNumber(config.cosineWeight, 0.70);

    const tanimotoWeight =
        safeNumber(config.tanimotoWeight, 0.30);

    const totalWeight =
        cosineWeight +
        tanimotoWeight;

    if (totalWeight <= 0) {
        return {
            cosine,
            tanimoto,
            similarity: 0
        };
    }

    const similarity =
        (
            cosine * cosineWeight +
            tanimoto * tanimotoWeight
        ) / totalWeight;

    return {
        cosine: round(cosine),
        tanimoto: round(tanimoto),
        similarity: round(clamp(similarity))
    };
}


/* ============================================================
 * EXTRACTION DU SCORE HISTORIQUE
 * ============================================================ */

function extractHistoricalScore(match) {
    if (!match || typeof match !== 'object') {
        return null;
    }

    const result =
        match.result ??
        match.score ??
        null;

    if (!result) {
        return null;
    }

    const home = Number(
        result.home ??
        result.homeGoals ??
        result.team1
    );

    const away = Number(
        result.away ??
        result.awayGoals ??
        result.team2
    );

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
        away,
        total: home + away,

        outcome:
            home > away
                ? 'HOME'
                : home < away
                    ? 'AWAY'
                    : 'DRAW'
    };
}


/* ============================================================
 * IDENTIFIANT DU SCORE
 * ============================================================ */

function scoreKey(home, away) {
    return `${home}-${away}`;
}


/* ============================================================
 * EXTRACTION DES FEATURES HISTORIQUES
 * ============================================================ */

function extractHistoricalFeatures(match) {
    if (!match || typeof match !== 'object') {
        return [];
    }

    /*
     * Le normalizer/featureEngine peut stocker les features
     * à différents endroits selon la structure utilisée.
     */
    if (match.features) {
        return extractFeatureVector(match.features);
    }

    if (match.featureVector) {
        return extractFeatureVector({
            vector: match.featureVector
        });
    }

    if (match.features?.vector) {
        return extractFeatureVector(match.features);
    }

    return [];
}


/**
 * Détecte un vecteur "nul" — toutes les composantes à zéro (ou
 * quasi-nulles). C'est le cas produit par featureEngine.js pour
 * un match sans aucun marché disponible : la signature garde sa
 * dimension (18 éléments) mais chaque valeur vaut 0, puisque
 * clamp01(null) = 0. Un vecteur nul n'est PAS un vecteur vide
 * (longueur 0) — il faut donc tester sa somme, pas sa longueur.
 */
function isZeroVector(vector) {
    if (!Array.isArray(vector) || vector.length === 0) {
        return true;
    }

    return vector.every(
        value => Math.abs(safeNumber(value)) <= 1e-9
    );
}


/* ============================================================
 * COMPARAISON D'UN MATCH
 * ============================================================ */

function compareMatch(
    currentFeatures,
    historicalMatch,
    config = DEFAULT_CONFIG
) {
    const historicalFeatures =
        extractHistoricalFeatures(
            historicalMatch
        );

    /*
     * Sans features côté événement actuel, aucune comparaison
     * n'est possible — ce cas reste exclu.
     */
    if (currentFeatures.length === 0) {
        return null;
    }

    const score =
        extractHistoricalScore(
            historicalMatch
        );

    /*
     * Match historique sans cotes capturées (score seul).
     * featureEngine.js produit alors une signature de 18 zéros
     * (pas un vecteur vide) — la comparaison cosinus/Tanimoto
     * donnerait 0 mathématiquement dans ce cas, quel que soit
     * l'événement comparé. On détecte donc ce cas par la nullité
     * du vecteur, pas par sa longueur, et on lui attribue la
     * similarité de référence configurée plutôt que de
     * l'exclure silencieusement.
     */
    if (
        historicalFeatures.length === 0 ||
        isZeroVector(historicalFeatures)
    ) {

        const baseline = clamp(
            safeNumber(
                config.scoreOnlyBaselineSimilarity,
                0.30
            )
        );

       return {
            matchId:
                historicalMatch.id ??
                null,

            similarity: baseline,

            cosine: null,

            tanimoto: null,

            scoreOnly: true,

            timestamp:
                historicalMatch.temporal?.timestamp ?? null,

            score
        };
    }

    const similarity =
        compositeSimilarity(
            currentFeatures,
            historicalFeatures,
            config
        );

   return {
        matchId:
            historicalMatch.id ??
            null,

        similarity:
            similarity.similarity,

        cosine:
            similarity.cosine,

        tanimoto:
            similarity.tanimoto,

        scoreOnly: false,

        timestamp:
            historicalMatch.temporal?.timestamp ?? null,

        score
    };
}


/* ============================================================
 * RECHERCHE DES MATCHS SIMILAIRES
 * ============================================================ */

function findSimilarMatches(
    currentFeatures,
    historicalMatches,
    config = DEFAULT_CONFIG
) {
    if (
        !Array.isArray(historicalMatches) ||
        historicalMatches.length === 0
    ) {
        return [];
    }

    const candidates = [];

    for (const match of historicalMatches) {
        const comparison =
            compareMatch(
                currentFeatures,
                match,
                config
            );

        if (!comparison) {
            continue;
        }

        if (
            comparison.similarity <
            safeNumber(
                config.minimumSimilarity,
                0.20
            )
        ) {
            continue;
        }

        candidates.push(comparison);
    }

    candidates.sort(
        (a, b) => {

            if (b.similarity !== a.similarity) {
                return b.similarity - a.similarity;
            }

            /*
             * À similarité égale (cas fréquent avec les matchs
             * "score seul", tous à la similarité de référence),
             * on départage par récence : le match le plus récent
             * est jugé plus pertinent, cohérent avec l'importance
             * des "séquences temporelles" (section 36 du cahier
             * des charges).
             */
            const timeA = safeNumber(a.timestamp, 0);
            const timeB = safeNumber(b.timestamp, 0);

            return timeB - timeA;
        }
    );

    return candidates.slice(
        0,
        Math.max(
            1,
            safeNumber(config.topK, 10)
        )
    );
}


/* ============================================================
 * POIDS DE MÉMOIRE
 * ============================================================ */

/**
 * Transformation de la similarité en poids.
 *
 * W_i = S_i^γ
 *
 * Cela donne davantage d'importance aux historiques
 * réellement proches sans créer un saut brutal.
 */
function similarityWeight(
    similarity,
    config = DEFAULT_CONFIG
) {
    const s = clamp(
        safeNumber(similarity)
    );

    const gamma = Math.max(
        0.1,
        safeNumber(
            config.similarityPower,
            2
        )
    );

    return Math.pow(s, gamma);
}


/* ============================================================
 * DISTRIBUTION HISTORIQUE DES SCORES
 * ============================================================ */

function buildHistoricalScoreDistribution(
    similarMatches,
    config = DEFAULT_CONFIG
) {
    const distribution = {};

    let totalWeight = 0;

    for (const match of similarMatches) {
        if (!match.score) {
            continue;
        }

        const weight =
            similarityWeight(
                match.similarity,
                config
            );

        if (weight <= 0) {
            continue;
        }

        const key =
            scoreKey(
                match.score.home,
                match.score.away
            );

        if (!distribution[key]) {
            distribution[key] = {
                home: match.score.home,
                away: match.score.away,
                probability: 0,
                rawWeight: 0,
                occurrences: 0
            };
        }

        distribution[key].rawWeight += weight;
        distribution[key].occurrences += 1;

        totalWeight += weight;
    }

    if (totalWeight <= Number.EPSILON) {
        return {};
    }

    for (const value of Object.values(distribution)) {
        value.probability =
            round(
                value.rawWeight /
                totalWeight
            );
    }

    return distribution;
}


/* ============================================================
 * DISTRIBUTION DES DIRECTIONS
 * ============================================================ */

function buildHistoricalDirectionDistribution(
    similarMatches,
    config = DEFAULT_CONFIG
) {
    const totals = {
        HOME: 0,
        DRAW: 0,
        AWAY: 0
    };

    let totalWeight = 0;

    for (const match of similarMatches) {
        if (!match.score) {
            continue;
        }

        const weight =
            similarityWeight(
                match.similarity,
                config
            );

        const outcome =
            match.score.outcome;

        if (!(outcome in totals)) {
            continue;
        }

        totals[outcome] += weight;
        totalWeight += weight;
    }

    if (totalWeight <= Number.EPSILON) {
        return {
            HOME: 0,
            DRAW: 0,
            AWAY: 0
        };
    }

    return {
        HOME: round(totals.HOME / totalWeight),
        DRAW: round(totals.DRAW / totalWeight),
        AWAY: round(totals.AWAY / totalWeight)
    };
}


/* ============================================================
 * DISTRIBUTION DES BUTS
 * ============================================================ */

function buildHistoricalGoalDistribution(
    similarMatches,
    config = DEFAULT_CONFIG
) {
    const homeGoals = {};
    const awayGoals = {};
    const totalGoals = {};

    let totalWeight = 0;

    for (const match of similarMatches) {
        if (!match.score) {
            continue;
        }

        const weight =
            similarityWeight(
                match.similarity,
                config
            );

        const {
            home,
            away
        } = match.score;

        const total =
            home + away;

        homeGoals[home] =
            (homeGoals[home] || 0) +
            weight;

        awayGoals[away] =
            (awayGoals[away] || 0) +
            weight;

        totalGoals[total] =
            (totalGoals[total] || 0) +
            weight;

        totalWeight += weight;
    }

    if (totalWeight <= Number.EPSILON) {
        return {
            home: {},
            away: {},
            total: {}
        };
    }

    function normalize(object) {
        const output = {};

        for (const [key, value] of Object.entries(object)) {
            output[key] =
                round(value / totalWeight);
        }

        return output;
    }

    return {
        home: normalize(homeGoals),
        away: normalize(awayGoals),
        total: normalize(totalGoals)
    };
}


/* ============================================================
 * MEILLEUR MATCH HISTORIQUE
 * ============================================================ */

function getBestHistoricalMatch(
    similarMatches
) {
    if (
        !Array.isArray(similarMatches) ||
        similarMatches.length === 0
    ) {
        return null;
    }

    return similarMatches[0] ?? null;
}


/* ============================================================
 * DÉTECTION DE SIGNATURE QUASI IDENTIQUE
 * ============================================================ */

function detectExactHistoricalSignature(
    similarMatches,
    config = DEFAULT_CONFIG
) {
    const best =
        getBestHistoricalMatch(
            similarMatches
        );

    if (!best) {
        return {
            found: false,
            similarity: 0,
            match: null
        };
    }

    const threshold =
        safeNumber(
            config.exactSignatureThreshold,
            0.95
        );

    return {
        found:
            best.similarity >= threshold,

        similarity:
            best.similarity,

        match:
            best.similarity >= threshold
                ? best
                : null
    };
}


/* ============================================================
 * CONFIANCE DE LA MÉMOIRE
 * ============================================================ */

/**
 * La confiance tient compte de :
 *
 * 1. la similarité maximale ;
 * 2. le nombre de matchs réellement utilisables.
 *
 * Elle ne signifie PAS "probabilité que le score soit exact".
 */
function calculateMemoryConfidence(
    similarMatches
) {
    if (
        !Array.isArray(similarMatches) ||
        similarMatches.length === 0
    ) {
        return 0;
    }

    const usable =
        similarMatches.filter(
            match => Boolean(match.score)
        );

    if (usable.length === 0) {
        return 0;
    }

    const bestSimilarity =
        usable[0].similarity;

    const sampleFactor =
        1 -
        Math.exp(
            -usable.length / 3
        );

    return round(
        clamp(
            bestSimilarity *
            sampleFactor
        )
    );
}


/* ============================================================
 * ANALYSE HISTORIQUE COMPLÈTE
 * ============================================================ */

function analyzeHistoricalMemory(
    currentFeatures,
    historicalMatches,
    config = {}
) {
    const finalConfig = {
        ...DEFAULT_CONFIG,
        ...config
    };

    const currentVector =
        extractFeatureVector(
            currentFeatures
        );

    if (currentVector.length === 0) {
        return {
            available: false,
            reason: 'NO_CURRENT_FEATURES',
            similarMatches: [],
            scoreDistribution: {},
            directionDistribution: {
                HOME: 0,
                DRAW: 0,
                AWAY: 0
            },
            goalDistribution: {
                home: {},
                away: {},
                total: {}
            },
            exactSignature: {
                found: false,
                similarity: 0,
                match: null
            },
            confidence: 0
        };
    }

    const similarMatches =
        findSimilarMatches(
            currentVector,
            historicalMatches,
            finalConfig
        );

    const scoreDistribution =
        buildHistoricalScoreDistribution(
            similarMatches,
            finalConfig
        );

    const directionDistribution =
        buildHistoricalDirectionDistribution(
            similarMatches,
            finalConfig
        );

    const goalDistribution =
        buildHistoricalGoalDistribution(
            similarMatches,
            finalConfig
        );

    const exactSignature =
        detectExactHistoricalSignature(
            similarMatches,
            finalConfig
        );

    const confidence =
        calculateMemoryConfidence(
            similarMatches
        );

    return {
        available:
            similarMatches.length > 0,

        featureDimension:
            currentVector.length,

        historicalSampleSize:
            Array.isArray(historicalMatches)
                ? historicalMatches.length
                : 0,

        similarMatches,

        scoreDistribution,

        directionDistribution,

        goalDistribution,

        exactSignature,

        confidence,

        bestMatch:
            getBestHistoricalMatch(
                similarMatches
            )
    };
}


/* ============================================================
 * EXPORT
 * ============================================================ */

export {
    cosineSimilarity,
    tanimotoSimilarity,
    compositeSimilarity,

    extractFeatureVector,
    extractHistoricalFeatures,
    extractHistoricalScore,

    compareMatch,
    findSimilarMatches,

    similarityWeight,

    buildHistoricalScoreDistribution,
    buildHistoricalDirectionDistribution,
    buildHistoricalGoalDistribution,

    getBestHistoricalMatch,
    detectExactHistoricalSignature,
    calculateMemoryConfidence,
    analyzeHistoricalMemory
};