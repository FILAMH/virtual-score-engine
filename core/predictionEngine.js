/**
 * core/predictionEngine.js
 *
 * ============================================================
 * FINAL PREDICTION ENGINE
 * ============================================================
 *
 * Rôle :
 * Transformer la distribution finale produite par
 * scoreFusion.js en une prédiction exploitable.
 *
 * Pipeline :
 *
 * parser
 *      ↓
 * normalizer
 *      ↓
 * featureEngine
 *      ↓
 * historicalEngine
 * marketEngine
 * directionEngine
 * regimeEngine
 * upsetEngine
 * lambdaEngine
 * distributionEngine
 * scoreFusion
 *      ↓
 * predictionEngine.js
 *      ↓
 * TOP 3 FINAL
 *
 * IMPORTANT :
 * Ce module ne simule PAS le match.
 * Il ne génère PAS artificiellement un résultat.
 * Il sélectionne les trois scores les mieux classés
 * selon la distribution finale fournie par les moteurs.
 * ============================================================
 */

"use strict";


import { analyzeMarket } from "./marketEngine.js";
import { analyzeHistoricalMemory } from "./historicalEngine.js";
import { analyzeDirection } from "./directionEngine.js";
import { analyzeRegime } from "./regimeEngine.js";
import { analyzeUpset } from "./upsetEngine.js";
import { calculateLambdas } from "./lambdaEngine.js";
import * as scoreFusion from "./scoreFusion.js";

import { poissonDistribution } from "../models/poisson.js";
import { negativeBinomialDistribution } from "../models/negativeBinomial.js";
import dixonColes from "../models/dixonColes.js";
import ensemble from "../models/ensemble.js";

/**
 * Limites de sécurité.
 */
const DEFAULT_TOP_N = 3;

const MIN_SCORE = 0;
const MAX_SCORE = 9;

/**
 * Convertit "2-1" en [2, 1].
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
        home < MIN_SCORE ||
        away < MIN_SCORE ||
        home > MAX_SCORE ||
        away > MAX_SCORE
    ) {
        return null;
    }

    return [home, away];
}

/**
 * Détermine la direction correspondant à un score.
 */
function getScoreDirection(score) {
    const parsed = parseScore(score);

    if (!parsed) {
        return "UNKNOWN";
    }

    const [home, away] = parsed;

    if (home > away) {
        return "HOME";
    }

    if (away > home) {
        return "AWAY";
    }

    return "DRAW";
}

/**
 * Nettoyage et normalisation de la distribution.
 */
function normalizeDistribution(distribution) {
    if (!distribution || typeof distribution !== "object") {
        return {};
    }

    const result = {};
    let total = 0;

    for (const [score, probability] of Object.entries(distribution)) {
        const parsed = parseScore(score);

        if (!parsed) {
            continue;
        }

        const p = Number(probability);

        if (!Number.isFinite(p) || p < 0) {
            continue;
        }

        result[score] = p;
        total += p;
    }

    if (total <= 0) {
        return {};
    }

    for (const score of Object.keys(result)) {
        result[score] /= total;
    }

    return result;
}

/**
 * Classe tous les scores disponibles.
 */
function rankScores(distribution) {
    const normalized = normalizeDistribution(distribution);

    return Object.entries(normalized)
        .map(([score, probability]) => ({
            score,
            probability,
            direction: getScoreDirection(score)
        }))
        .sort((a, b) => {
            if (b.probability !== a.probability) {
                return b.probability - a.probability;
            }

            /**
             * En cas d'égalité, préférence légère pour
             * le score avec moins de buts.
             *
             * Cela évite un départage arbitraire.
             */
            const aParsed = parseScore(a.score);
            const bParsed = parseScore(b.score);

            const aTotal = aParsed[0] + aParsed[1];
            const bTotal = bParsed[0] + bParsed[1];

            return aTotal - bTotal;
        });
}

/**
 * Distance de Manhattan entre deux scores (en buts).
 */
function scoreDistance(scoreA, scoreB) {
    const a = parseScore(scoreA);
    const b = parseScore(scoreB);

    if (!a || !b) {
        return Infinity;
    }

    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

/**
 * Sélection du Top 3 avec diversification (suppression des
 * quasi-doublons).
 *
 * CONSTAT (vérifié sur 10 évaluations réelles) : distance moyenne
 * au score réel ≈ 1,3 but, mais 0% de réussite exacte. Classer
 * uniquement par probabilité brute sélectionne systématiquement
 * des scores voisins immédiats (ex. 0-1, 0-2, 1-1), parce que la
 * distribution Poisson/NB est unimodale et lisse autour de son
 * pic. Quand le score réel s'écarte même légèrement de cette
 * petite zone, les 3 candidats le manquent ensemble.
 *
 * On applique donc une suppression de quasi-doublons : après le
 * score le plus probable, chaque candidat suivant doit être à une
 * distance minimale (MIN_TOP3_DISTANCE, en somme de buts) des
 * scores déjà choisis pour être priorisé. Si la distribution est
 * trop concentrée pour fournir 3 scores suffisamment distincts,
 * les places restantes sont comblées avec les meilleurs candidats
 * restants — jamais moins de 3 scores retournés.
 *
 * Aucun score n'est inventé : les trois proviennent toujours
 * exclusivement de la distribution finale. Seul le CRITÈRE DE
 * SÉLECTION change — probabilité pure devient probabilité +
 * couverture.
 *
 * MIN_TOP3_DISTANCE=2 est un point de départ, pas une valeur
 * calibrée — à ajuster selon les résultats de l'évaluateur.
 */
const MIN_TOP3_DISTANCE = 2;

function selectTop3(distribution) {
    const ranked = rankScores(distribution);

    if (ranked.length <= DEFAULT_TOP_N) {
        return ranked.slice(0, DEFAULT_TOP_N);
    }

    const selected = [];
    const remaining = [...ranked];

    /*
     * 1. Toujours prendre le score le plus probable en premier.
     */
    selected.push(remaining.shift());

    /*
     * 2. Compléter en favorisant la diversité, tout en restant
     *    trié par probabilité parmi les candidats éligibles.
     */
    while (selected.length < DEFAULT_TOP_N && remaining.length > 0) {
        let bestIndex = -1;

        for (let i = 0; i < remaining.length; i++) {
            const candidate = remaining[i];

            const farEnough = selected.every(
                (item) =>
                    scoreDistance(item.score, candidate.score) >=
                    MIN_TOP3_DISTANCE
            );

            if (farEnough) {
                bestIndex = i;
                break;
            }
        }

        if (bestIndex === -1) {
            /*
             * Aucun candidat suffisamment distinct : on complète
             * avec le meilleur restant plutôt que de renvoyer
             * moins de 3 scores.
             */
            bestIndex = 0;
        }

        selected.push(remaining.splice(bestIndex, 1)[0]);
    }

    return selected;
}

/**
 * Probabilité cumulée du Top N.
 */
function cumulativeTopProbability(topScores) {
    return topScores.reduce(
        (sum, item) => sum + item.probability,
        0
    );
}

/**
 * Détermine la direction dominante du Top 3.
 *
 * Cette information est secondaire par rapport aux
 * probabilités exactes des scores.
 */
function determineTop3Direction(top3) {
    if (!Array.isArray(top3) || top3.length === 0) {
        return {
            direction: "UNKNOWN",
            homeCount: 0,
            drawCount: 0,
            awayCount: 0
        };
    }

    let homeCount = 0;
    let drawCount = 0;
    let awayCount = 0;

    for (const prediction of top3) {
        if (prediction.direction === "HOME") {
            homeCount++;
        } else if (prediction.direction === "DRAW") {
            drawCount++;
        } else if (prediction.direction === "AWAY") {
            awayCount++;
        }
    }

    const counts = {
        HOME: homeCount,
        DRAW: drawCount,
        AWAY: awayCount
    };

    const direction = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])[0][0];

    return {
        direction,
        homeCount,
        drawCount,
        awayCount
    };
}

/**
 * Calcule une mesure simple de confiance basée sur
 * la concentration de probabilité du Top 3.
 *
 * Ce n'est PAS une garantie de réussite.
 */
function calculateConfidence(top3, distribution) {
    const normalized = normalizeDistribution(distribution);

    if (top3.length === 0 || Object.keys(normalized).length === 0) {
        return 0;
    }

    const top3Probability =
        cumulativeTopProbability(top3);

    /**
     * Entropie normalisée.
     *
     * H = -Σ p log(p)
     */
    let entropy = 0;

    for (const p of Object.values(normalized)) {
        if (p > 0) {
            entropy -= p * Math.log(p);
        }
    }

    const count = Object.keys(normalized).length;

    const maxEntropy =
        count > 1
            ? Math.log(count)
            : 1;

    const concentration =
        maxEntropy > 0
            ? 1 - entropy / maxEntropy
            : 1;

    /**
     * 75% de la confiance provient de la probabilité
     * réellement concentrée sur le Top 3.
     *
     * 25% provient de la concentration générale.
     */
    const confidence =
        0.75 * top3Probability +
        0.25 * concentration;

    return Math.max(
        0,
        Math.min(1, confidence)
    );
}

/**
 * Construit une prédiction complète.
 */
function buildPrediction({
    distribution = {},
    matchId = null,
    homeTeam = null,
    awayTeam = null,
    timestamp = null,
    metadata = {},
    fusion = null,
    directionAnalysis = null,
    regimeAnalysis = null,
    upsetAnalysis = null
} = {}) {

    const normalized = normalizeDistribution(distribution);

    if (Object.keys(normalized).length === 0) {
        throw new Error(
            "predictionEngine: distribution finale vide ou invalide."
        );
    }

    /**
     * --------------------------------------------------------
     * 1. TOP 3
     * --------------------------------------------------------
     */
    const top3 = selectTop3(normalized);

    /**
     * --------------------------------------------------------
     * 2. DIRECTION
     * --------------------------------------------------------
     */
    const direction = determineTop3Direction(top3);

    /**
     * --------------------------------------------------------
     * 3. PROBABILITÉ CUMULÉE
     * --------------------------------------------------------
     */
    const top3Probability =
        cumulativeTopProbability(top3);

    /**
     * --------------------------------------------------------
     * 4. CONFIANCE
     * --------------------------------------------------------
     */
    const confidence =
        calculateConfidence(
            top3,
            normalized
        );

    /**
     * --------------------------------------------------------
     * 5. SCORE PRINCIPAL
     * --------------------------------------------------------
     */
    const primary =
        top3[0] || null;

    /**
     * --------------------------------------------------------
     * 6. STRUCTURE FINALE
     * --------------------------------------------------------
     */
    return {
        success: true,

        match: {
            id: matchId,
            homeTeam,
            awayTeam,
            timestamp
        },

        prediction: {
            primaryScore: primary
                ? primary.score
                : null,

            top3: top3.map((item, index) => ({
                rank: index + 1,
                score: item.score,
                probability: Number(
                    item.probability.toFixed(8)
                ),
                direction: item.direction
            })),

            direction: direction.direction,

            directionBreakdown: {
                home: direction.homeCount,
                draw: direction.drawCount,
                away: direction.awayCount
            },

            top3Probability: Number(
                top3Probability.toFixed(8)
            ),

            confidence: Number(
                confidence.toFixed(8)
            )
        },

        analysis: {
            fusion: fusion || null,
            direction: directionAnalysis || null,
            regime: regimeAnalysis || null,
            upset: upsetAnalysis || null
        },

        metadata: {
            generatedAt:
                timestamp ||
                new Date().toISOString(),

            modelVersion:
                metadata.modelVersion ||
                "VSE-1.0",

            virtualMatch: true,

            simulationPerformed: false
        }
    };
}

/**
 * Fonction principale appelée par app.js
 * ou par le pipeline final.
 */
function predict({
    distribution,
    matchId = null,
    homeTeam = null,
    awayTeam = null,
    timestamp = null,
    metadata = {},
    fusion = null,
    directionAnalysis = null,
    regimeAnalysis = null,
    upsetAnalysis = null
} = {}) {

    return buildPrediction({
        distribution,
        matchId,
        homeTeam,
        awayTeam,
        timestamp,
        metadata,
        fusion,
        directionAnalysis,
        regimeAnalysis,
        upsetAnalysis
    });
}

/**
 * Vérification de structure du résultat.
 */
function validatePrediction(prediction) {
    if (!prediction || prediction.success !== true) {
        return false;
    }

    const top3 =
        prediction.prediction?.top3;

    if (!Array.isArray(top3)) {
        return false;
    }

    /**
     * Obligation fondamentale du système :
     * produire exactement trois propositions lorsque
     * trois scores sont disponibles.
     */
    if (top3.length !== 3) {
        return false;
    }

    for (const item of top3) {
        if (
            typeof item.score !== "string" ||
            !Number.isFinite(item.probability)
        ) {
            return false;
        }

        if (!parseScore(item.score)) {
            return false;
        }
    }

    return true;
}


/**
 * ============================================================
 * ORCHESTRATION COMPLÈTE DU PIPELINE
 * ============================================================
 *
 * Appelée par app.js. Reçoit les données brutes normalisées
 * et enrichies (currentMatch, currentFeatures, historicalMatches,
 * historicalFeatures) et exécute la totalité de la chaîne :
 *
 * historicalEngine, marketEngine, directionEngine, regimeEngine,
 * upsetEngine, lambdaEngine, models/*, scoreFusion, predict()
 *
 * puis reformate la sortie pour correspondre exactement à ce que
 * displayPrediction() attend dans app.js.
 * ============================================================
 */

const MAX_GOALS = 8;

/*
 * Dispersion Negative Binomial par défaut.
 *
 * ATTENTION : ceci est un point de départ conservateur, PAS une
 * valeur calibrée. Le cahier des charges (section 41) demande
 * une calibration par validation, à faire évoluer via
 * data/parameters.json une fois le pipeline stabilisé.
 */
const DEFAULT_DISPERSION = 0.20;

function buildJointMatrix(homeDistribution, awayDistribution) {
    const matrix = [];

    for (let h = 0; h < homeDistribution.length; h++) {
        for (let a = 0; a < awayDistribution.length; a++) {
            matrix.push({
                home: h,
                away: a,
                probability: homeDistribution[h] * awayDistribution[a]
            });
        }
    }

    return matrix;
}

function flatDistributionFromMatrix(matrix) {
    const result = {};

    for (const item of matrix) {
        result[`${item.home}-${item.away}`] = item.probability;
    }

    return result;
}

/*
 * historicalEngine.buildHistoricalScoreDistribution produit
 * { "1-0": { home, away, probability, ... } } — scoreFusion
 * attend un objet plat { "1-0": probability }.
 */
function flattenHistoricalDistribution(scoreDistribution) {
    const result = {};

    for (const [key, value] of Object.entries(scoreDistribution || {})) {
        result[key] = value?.probability ?? 0;
    }

    return result;
}

/*
 * directionEngine.classifyDirection produit des labels détaillés
 * (HOME_DOMINANT, HOME_FAVORITE, AWAY_DOMINANT, AWAY_FAVORITE,
 * BALANCED, DRAW). scoreFusion.applyDirectionAdjustment compare
 * strictement à "HOME"/"AWAY"/"DRAW".
 */
function simplifyDirectionLabel(label) {
    if (!label) return null;
    if (label.includes("HOME")) return "HOME";
    if (label.includes("AWAY")) return "AWAY";
    if (label === "DRAW") return "DRAW";
    return null;
}

async function generatePrediction(request = {}) {
    const {
        currentMatch,
        currentFeatures,
        historicalMatches = [],
        historicalFeatures = []
    } = request;

    if (!currentMatch) {
        throw new Error(
            "generatePrediction: aucun événement courant fourni."
        );
    }

    /*
     * 1. Rattacher chaque vecteur de features au match historique
     *    correspondant, faute de quoi historicalEngine.js ne peut
     *    comparer aucun match (extractHistoricalFeatures cherche
     *    match.features.vector).
     */
    const historicalWithFeatures = historicalMatches.map((match, index) => ({
        ...match,
        features: {
            vector: historicalFeatures[index]?.vector || []
        }
    }));

    /*
     * 2. Analyse du marché du nouvel événement.
     */
    const marketAnalysis = analyzeMarket(currentMatch);

    /*
     * 3. Mémoire historique.
     */
    /*
     * topK par défaut (10) tronquait systématiquement l'historique,
     * même quand plusieurs centaines de matchs étaient fournis
     * (cf. section 3/13 du cahier des charges : la mémoire doit
     * couvrir la fenêtre historique réelle, généralement ~72h).
     * On le porte à la taille complète de l'historique fourni,
     * en laissant minimumSimilarity continuer à filtrer les
     * matchs réellement non pertinents.
     */
    const historicalAnalysis = analyzeHistoricalMemory(
        currentFeatures,
        historicalWithFeatures,
        {
            topK: Math.max(
                historicalWithFeatures.length,
                10
            )
        }
    );

    /*
     * 4. Direction.
     */
    const directionAnalysis = analyzeDirection(
        marketAnalysis,
        historicalAnalysis
    );

    /*
     * 5. Régime.
     */
    const regimeAnalysis = analyzeRegime(
        currentFeatures,
        marketAnalysis,
        directionAnalysis
    );

    /*
     * 6. Upset.
     */
    const upsetAnalysis = analyzeUpset(
        marketAnalysis,
        directionAnalysis,
        regimeAnalysis,
        historicalAnalysis,
        currentFeatures
    );

    /*
     * 7. Lambdas finales.
     */
    const lambdaResult = calculateLambdas({
        market: marketAnalysis,
        features: currentFeatures,
        historical: historicalAnalysis,
        direction: directionAnalysis,
        regime: regimeAnalysis,
        upset: upsetAnalysis
    });

    /*
     * 8. Trois distributions de base pour l'ensemble.
     */
    const poissonHome = poissonDistribution(lambdaResult.lambdaHome, MAX_GOALS);
    const poissonAway = poissonDistribution(lambdaResult.lambdaAway, MAX_GOALS);
    const poissonMatrix = buildJointMatrix(poissonHome, poissonAway);

    const negBinomHome = negativeBinomialDistribution(
        lambdaResult.lambdaHome,
        DEFAULT_DISPERSION,
        MAX_GOALS
    );
    const negBinomAway = negativeBinomialDistribution(
        lambdaResult.lambdaAway,
        DEFAULT_DISPERSION,
        MAX_GOALS
    );
    const negBinomMatrix = buildJointMatrix(negBinomHome, negBinomAway);

    const rhoInput = historicalMatches
        .map((match) => ({
            homeGoals: match.result?.homeGoals,
            awayGoals: match.result?.awayGoals
        }))
        .filter(
            (item) =>
                Number.isInteger(item.homeGoals) &&
                Number.isInteger(item.awayGoals)
        );

    const rho = dixonColes.estimateRho(rhoInput);

    const dixonColesMatrix = dixonColes.applyCorrection(
        poissonMatrix,
        lambdaResult.lambdaHome,
        lambdaResult.lambdaAway,
        rho
    );

    /*
     * 9. Fusion des trois modèles.
     */
    const ensembleResult = ensemble.buildEnsemble({
        poisson: poissonMatrix,
        negativeBinomial: negBinomMatrix,
        dixonColes: dixonColesMatrix,
        regime: regimeAnalysis.regime
    });

    const modelDistribution = flatDistributionFromMatrix(
        ensembleResult.distribution.map((item) => ({
            home: item.home,
            away: item.away,
            probability: item.probability
        }))
    );

   /*
     * 10. Fusion modèle + mémoire historique.
     *
     * IMPORTANT — calculateMemoryWeight (S0=0.75) a été conçue
     * pour une VRAIE similarité de marché (Cosine/Tanimoto sur
     * des cotes réellement capturées) : un seuil élevé signifie
     * "ne fais confiance à l'historique que si un match quasi
     * identique existe". La similarité de référence (0.30) qu'on
     * attribue aux matchs "score seul" n'est PAS cette même
     * grandeur — c'est un simple signal de participation, pas
     * une mesure de ressemblance. La faire passer par la même
     * formule l'écrase systématiquement (~1%), indépendamment
     * du nombre de matchs fournis.
     *
     * On distingue donc deux régimes :
     *  - au moins un match a une similarité RÉELLE (cotes
     *    historiques capturées) → on garde le comportement
     *    d'origine, pensé pour ce cas ;
     *  - aucun match n'a de cotes (cas actuel avec les 216
     *    matchs "score seul") → le poids mémoire est dérivé de
     *    historicalAnalysis.confidence (qui intègre déjà la
     *    taille de l'échantillon) via un seuil dédié, nettement
     *    plus bas, pour que le volume de données historiques ait
     *    un effet réel sur la fusion.
     *
     * AGGREGATE_MEMORY_S0 / _K sont des points de départ, pas des
     * valeurs calibrées — à ajuster via evaluator.js sur des
     * résultats réels (section 41 du cahier des charges,
     * calibration walk-forward), pas figés définitivement ici.
     */

    const hasRealMarketSimilarity =
        (historicalAnalysis.similarMatches || []).some(
            (match) => match.scoreOnly === false
        );

    /*
     * PLAFOND STRICT pour la mémoire agrégée (matchs "score seul").
     *
     * La formule sigmoïde d'origine (S0=0.75, k=10) est conçue
     * pour une vraie similarité par match — elle peut légitimement
     * approcher 100% face à un match quasi identique.
     *
     * Une confiance de mémoire AGRÉGÉE (calculée sur des dizaines
     * de matchs sans lien individuel avec l'événement en cours)
     * ne doit JAMAIS pouvoir dominer un signal de marché frais et
     * spécifique à ce match précis — quelle que soit la valeur de
     * confidence. On utilise donc une mise à l'échelle linéaire et
     * bornée (proportion directe, pas de sigmoïde qui peut
     * s'emballer), plafonnée à AGGREGATE_MEMORY_MAX_WEIGHT.
     *
     * 0.35 est un point de départ prudent, pas une valeur validée
     * empiriquement — à ajuster via evaluator.js une fois qu'on
     * aura assez de résultats réels pour comparer les deux réglages.
     */
    const AGGREGATE_MEMORY_MAX_WEIGHT = 0.35;

    const memorySimilarityInput = hasRealMarketSimilarity
        ? historicalAnalysis.bestMatch?.similarity ?? 0
        : historicalAnalysis.confidence ?? 0;

    const memoryConfig = hasRealMarketSimilarity
        ? {}
        : {
            baseWeight: Math.max(
                0,
                Math.min(
                    AGGREGATE_MEMORY_MAX_WEIGHT,
                    (historicalAnalysis.confidence ?? 0) *
                        AGGREGATE_MEMORY_MAX_WEIGHT
                )
            )
        };

    const fusionResult = scoreFusion.fuseScorePredictions({
        modelDistribution,
        historicalDistribution: flattenHistoricalDistribution(
            historicalAnalysis.scoreDistribution
        ),
        similarity: memorySimilarityInput,
        exactMatch: historicalAnalysis.exactSignature?.found ?? false,
        direction: simplifyDirectionLabel(
            directionAnalysis.classification?.label
        ),
        directionStrength: clamp01(directionAnalysis.confidence * 0.5),
    awayBlowoutProbability: upsetAnalysis.probabilities?.awayBlowout ?? 0,
    homeBlowoutProbability: upsetAnalysis.probabilities?.homeBlowout ?? 0,
    memoryConfig
});

    /*
     * 11. Sélection finale du Top 3.
     */
    const predictionResult = predict({
        distribution: fusionResult.distribution,
        matchId: currentMatch.id,
        homeTeam: currentMatch.teams?.home,
        awayTeam: currentMatch.teams?.away,
        timestamp: new Date().toISOString(),
        fusion: fusionResult,
        directionAnalysis,
        regimeAnalysis,
        upsetAnalysis
    });

    if (!validatePrediction(predictionResult)) {
        throw new Error(
            "generatePrediction: la prédiction finale n'a pas passé la validation."
        );
    }

/*
     * DEBUG TEMPORAIRE — à retirer une fois le diagnostic terminé.
     * Affiche les valeurs intermédiaires clés dans la console du
     * navigateur pour vérifier où la direction diverge du marché.
     */
    console.log("[DEBUG] oneXTwo.probability:", marketAnalysis.oneXTwo?.probability);
    console.log("[DEBUG] marketAnalysis.direction:", marketAnalysis.direction);
    console.log("[DEBUG] directionAnalysis.probabilities:", directionAnalysis.probabilities);
    console.log("[DEBUG] directionAnalysis.classification:", directionAnalysis.classification);
    console.log("[DEBUG] lambdaResult:", lambdaResult);
    console.log("[DEBUG] historicalAnalysis.confidence:", historicalAnalysis.confidence);

    /*
     * 12. Reformatage pour app.js (displayPrediction).
     */
    return {
        match: {
            homeTeam: currentMatch.teams?.home,
            awayTeam: currentMatch.teams?.away
        },

        top3: predictionResult.prediction.top3.map((item) => {
            const [home, away] = item.score.split("-").map(Number);
            return {
                homeGoals: home,
                awayGoals: away,
                probability: item.probability
            };
        }),

        direction: predictionResult.prediction.direction,

        directionExplanation: `Direction estimée à partir du marché, de l'historique et des signaux de score (confiance ${(
            directionAnalysis.confidence * 100
        ).toFixed(1)}%).`,

        regime: regimeAnalysis.regime,

        confidence: predictionResult.prediction.confidence,

        historicalSimilarity:
            historicalAnalysis.bestMatch?.similarity ??
            historicalAnalysis.confidence ??
            0,

        lambdaHome: lambdaResult.lambdaHome,
        lambdaAway: lambdaResult.lambdaAway,

        memoryWeight: fusionResult.memoryWeight,

        upsetProbability: upsetAnalysis.probabilities?.upset ?? 0,

        message: `${historicalAnalysis.similarMatches?.length ?? 0} match(s) historique(s) similaire(s) pris en compte. Régime détecté : ${regimeAnalysis.regime}.`
    };
}

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(0.5, value));
}

export {
    parseScore,
    getScoreDirection,
    normalizeDistribution,
    rankScores,
    selectTop3,
    cumulativeTopProbability,
    determineTop3Direction,
    calculateConfidence,
    buildPrediction,
    predict,
    validatePrediction,
    generatePrediction
};