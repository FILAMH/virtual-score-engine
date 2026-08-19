/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * core/directionEngine.js
 * ============================================================
 *
 * RÔLE UNIQUE
 * ------------------------------------------------------------
 * Déterminer la direction probabiliste du nouvel événement
 * à partir des résultats déjà produits par :
 *
 *   - historicalEngine.js
 *   - marketEngine.js
 *
 * Ce module ne lit PAS les cotes brutes.
 * Ce module ne reconstruit PAS l'historique.
 * Ce module ne calcule PAS les distributions de scores.
 * Ce module ne génère PAS les Top 3.
 *
 * Il transforme les signaux existants en une estimation
 * directionnelle :
 *
 *   HOME / DRAW / AWAY
 *
 * avec une attention particulière à la domination extérieure,
 * car notre système doit éviter de favoriser artificiellement
 * l'équipe domicile lorsque l'équipe extérieure possède des
 * signaux forts et cohérents.
 *
 * ============================================================
 */

'use strict';


/* ============================================================
 * CONFIGURATION
 * ============================================================ */

const DEFAULT_CONFIG = {
    marketWeight: 0.55,
    historicalWeight: 0.30,
    scoringWeight: 0.15,

    minimumConfidence: 0.05,

    strongFavoriteGap: 0.20,
    extremeFavoriteGap: 0.35,

    conflictPenalty: 0.20,

    drawBase: 0.10
};


/* ============================================================
 * UTILITAIRES
 * ============================================================ */

function safeNumber(value, fallback = 0) {
    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;
}


function clamp(value, min = 0, max = 1) {
    return Math.max(
        min,
        Math.min(max, value)
    );
}


function round(value, decimals = 6) {
    const factor = 10 ** decimals;

    return Math.round(
        value * factor
    ) / factor;
}


/**
 * Normalisation simple d'un triplet HOME/DRAW/AWAY.
 */
function normalizeDirection(home, draw, away) {
    home = Math.max(0, safeNumber(home));
    draw = Math.max(0, safeNumber(draw));
    away = Math.max(0, safeNumber(away));

    const total =
        home +
        draw +
        away;

    if (total <= Number.EPSILON) {
        return {
            home: 1 / 3,
            draw: 1 / 3,
            away: 1 / 3
        };
    }

    return {
        home: home / total,
        draw: draw / total,
        away: away / total
    };
}


/* ============================================================
 * EXTRACTION DU SIGNAL MARKET
 * ============================================================ */

/**
 * marketEngine.js fournit déjà :
 *
 * direction = {
 *   home,
 *   away,
 *   raw
 * }
 *
 * On réutilise directement cette sortie.
 *
 * Aucune nouvelle analyse des cotes n'est effectuée ici.
 */
function extractMarketDirection(marketAnalysis) {
    const direction =
        marketAnalysis?.direction;

    if (!direction) {
        return {
            home: 0.5,
            draw: 0,
            away: 0.5,
            raw: 0
        };
    }

    return {
        home: clamp(
            safeNumber(direction.home)
        ),

        away: clamp(
            safeNumber(direction.away)
        ),

        raw: safeNumber(direction.raw)
    };
}


/* ============================================================
 * SIGNAL 1X2
 * ============================================================ */

/**
 * Le 1X2 constitue le signal directionnel principal du marché.
 */
function extractOneXTwoDirection(marketAnalysis) {
    const probability =
        marketAnalysis
            ?.oneXTwo
            ?.probability;

    if (!probability) {
        return {
            home: 1 / 3,
            draw: 1 / 3,
            away: 1 / 3
        };
    }

    return normalizeDirection(
        probability.home,
        probability.draw,
        probability.away
    );
}


/* ============================================================
 * SIGNAL HANDICAP
 * ============================================================ */

/**
 * Le handicap est utilisé comme deuxième confirmation
 * directionnelle.
 *
 * Plusieurs lignes peuvent exister.
 *
 * On calcule une moyenne pondérée simple des directions
 * disponibles.
 */
function extractHandicapDirection(marketAnalysis) {
    const handicap =
        marketAnalysis?.handicap;

    if (
        !handicap ||
        typeof handicap !== 'object'
    ) {
        return {
            home: 0.5,
            away: 0.5,
            confidence: 0
        };
    }

    let homeTotal = 0;
    let awayTotal = 0;
    let count = 0;

    for (const line of Object.values(handicap)) {
        const home =
            safeNumber(
                line?.probability?.home,
                NaN
            );

        const away =
            safeNumber(
                line?.probability?.away,
                NaN
            );

        if (
            !Number.isFinite(home) ||
            !Number.isFinite(away)
        ) {
            continue;
        }

        homeTotal += home;
        awayTotal += away;
        count++;
    }

    if (count === 0) {
        return {
            home: 0.5,
            away: 0.5,
            confidence: 0
        };
    }

    const normalized =
        normalizeDirection(
            homeTotal / count,
            0,
            awayTotal / count
        );

    return {
        home: normalized.home,
        away: normalized.away,
        confidence:
            clamp(count / 5)
    };
}


/* ============================================================
 * SIGNAL HISTORIQUE
 * ============================================================ */

/**
 * historicalEngine.js fournit :
 *
 * directionDistribution = {
 *   HOME,
 *   DRAW,
 *   AWAY
 * }
 *
 * On réutilise cette mémoire.
 */
function extractHistoricalDirection(
    historicalAnalysis
) {
    const direction =
        historicalAnalysis
            ?.directionDistribution;

    if (!direction) {
        return {
            home: 1 / 3,
            draw: 1 / 3,
            away: 1 / 3,
            confidence: 0
        };
    }

    return {
        home:
            clamp(
                safeNumber(direction.HOME)
            ),

        draw:
            clamp(
                safeNumber(direction.DRAW)
            ),

        away:
            clamp(
                safeNumber(direction.AWAY)
            ),

        confidence:
            clamp(
                safeNumber(
                    historicalAnalysis.confidence
                )
            )
    };
}


/* ============================================================
 * SIGNAL BUTS
 * ============================================================ */

/**
 * Les marchés de buts ne déterminent pas directement le
 * vainqueur.
 *
 * Ils servent ici uniquement de confirmation directionnelle.
 *
 * Exemple :
 *
 * équipe 2 très forte sur "2 va marquer"
 * +
 * équipe 2 forte sur "2 va marquer 2+"
 *
 * => renforcement du signal AWAY.
 */
function extractScoringDirection(
    marketAnalysis
) {
    const teamScoring =
        marketAnalysis?.teamScoring;

    const twoPlus =
        marketAnalysis?.twoPlusGoals;

    const homeScoring =
        safeNumber(
            teamScoring
                ?.relativeProbability
                ?.home
        );

    const awayScoring =
        safeNumber(
            teamScoring
                ?.relativeProbability
                ?.away
        );

    const homeTwoPlus =
        safeNumber(
            twoPlus
                ?.probability
                ?.home
        );

    const awayTwoPlus =
        safeNumber(
            twoPlus
                ?.probability
                ?.away
        );

    const scoringHome =
        normalizeDirection(
            homeScoring,
            0,
            awayScoring
        );

    const twoPlusHome =
        normalizeDirection(
            homeTwoPlus,
            0,
            awayTwoPlus
        );

    const home =
        0.60 * scoringHome.home +
        0.40 * twoPlusHome.home;

    const away =
        0.60 * scoringHome.away +
        0.40 * twoPlusHome.away;

    return {
        home,
        away,

        confidence:
            clamp(
                Math.abs(
                    home -
                    away
                )
            )
    };
}


/* ============================================================
 * CONCORDANCE DES SIGNAUX
 * ============================================================ */

/**
 * Mesure la concordance entre plusieurs sources.
 *
 * Une forte concordance signifie que plusieurs marchés
 * indépendants pointent vers la même direction.
 */
function calculateConcordance(
    signals
) {
    const values = [
        signals.market.home -
            signals.market.away,

        signals.handicap.home -
            signals.handicap.away,

        signals.historical.home -
            signals.historical.away,

        signals.scoring.home -
            signals.scoring.away
    ];

    const positive =
        values.filter(
            value => value > 0.05
        ).length;

    const negative =
        values.filter(
            value => value < -0.05
        ).length;

    const neutral =
        values.length -
        positive -
        negative;

    const strongest =
        Math.max(
            positive,
            negative
        );

    return {
        positive,
        negative,
        neutral,

        agreement:
            clamp(
                strongest /
                values.length
            ),

        direction:
            positive > negative
                ? 'HOME'
                : negative > positive
                    ? 'AWAY'
                    : 'BALANCED'
    };
}


/* ============================================================
 * CONFLIT DIRECTIONNEL
 * ============================================================ */

/**
 * Détecte une situation comme :
 *
 * 1X2  -> AWAY
 * Handicap -> AWAY
 * Historique -> HOME
 *
 * Ce type de conflit est important.
 *
 * On ne force pas artificiellement le domicile.
 */
function calculateDirectionalConflict(
    signals
) {
    const market =
        signals.market.home -
        signals.market.away;

    const handicap =
        signals.handicap.home -
        signals.handicap.away;

    const historical =
        signals.historical.home -
        signals.historical.away;

    const scoring =
        signals.scoring.home -
        signals.scoring.away;

    const signs = [
        market,
        handicap,
        historical,
        scoring
    ]
        .filter(
            value =>
                Math.abs(value) >= 0.05
        )
        .map(
            value =>
                value > 0
                    ? 1
                    : -1
        );

    if (signs.length < 2) {
        return {
            value: 0,
            severity: 0,
            direction: 'NONE'
        };
    }

    let positive = 0;
    let negative = 0;

    for (const sign of signs) {
        if (sign > 0) {
            positive++;
        } else {
            negative++;
        }
    }

    const severity =
        Math.abs(
            positive -
            negative
        ) === 0
            ? 1
            : 0.5;

    return {
        value:
            round(
                Math.abs(
                    positive -
                    negative
                ) /
                signs.length
            ),

        severity,

        direction:
            positive > negative
                ? 'HOME'
                : negative > positive
                    ? 'AWAY'
                    : 'BALANCED'
    };
}


/* ============================================================
 * FORCE DU FAVORI EXTÉRIEUR
 * ============================================================ */

/**
 * Cette fonction est essentielle pour notre problème historique :
 *
 * équipe extérieure favorite
 * +
 * signaux de buts extérieurs
 * +
 * handicap extérieur
 *
 * ne doit PAS être écrasée par un avantage domicile arbitraire.
 *
 * Le moteur ne crée toutefois aucun "boost" de score.
 * Il produit seulement un coefficient directionnel.
 */
function calculateAwayFavoriteStrength(
    marketAnalysis
) {
    const oneXTwo =
        marketAnalysis?.oneXTwo;

    if (!oneXTwo) {
        return {
            probability: 0,
            strength: 0,
            isFavorite: false
        };
    }

    const away =
        safeNumber(
            oneXTwo
                ?.probability
                ?.away
        );

    const home =
        safeNumber(
            oneXTwo
                ?.probability
                ?.home
        );

    const gap =
        away -
        home;

    const isFavorite =
        away > home;

    const strength =
        isFavorite
            ? clamp(
                gap /
                0.50
            )
            : 0;

    return {
        probability:
            round(away),

        strength:
            round(strength),

        gap:
            round(gap),

        isFavorite
    };
}


/* ============================================================
 * SCORE DIRECTIONNEL FINAL
 * ============================================================ */

/**
 * Fusion directionnelle :
 *
 * D = wm·M + wh·H + ws·S
 *
 * avec une pondération historique adaptative selon sa confiance.
 */
function calculateDirectionalScore(
    signals,
    config = DEFAULT_CONFIG
) {
    const marketWeight =
        safeNumber(
            config.marketWeight,
            0.55
        );

    const historicalWeight =
        safeNumber(
            config.historicalWeight,
            0.30
        );

    const scoringWeight =
        safeNumber(
            config.scoringWeight,
            0.15
        );

    const historicalConfidence =
        clamp(
            signals.historical.confidence
        );

    const adaptiveHistoricalWeight =
        historicalWeight *
        historicalConfidence;

    const totalWeight =
        marketWeight +
        adaptiveHistoricalWeight +
        scoringWeight;

    const marketHome =
        signals.market.home;

    const marketAway =
        signals.market.away;

    const historicalHome =
        signals.historical.home;

    const historicalAway =
        signals.historical.away;

    const scoringHome =
        signals.scoring.home;

    const scoringAway =
        signals.scoring.away;

    const home =
        (
            marketWeight * marketHome +
            adaptiveHistoricalWeight *
                historicalHome +
            scoringWeight * scoringHome
        ) /
        totalWeight;

    const away =
        (
            marketWeight * marketAway +
            adaptiveHistoricalWeight *
                historicalAway +
            scoringWeight * scoringAway
        ) /
        totalWeight;

    const normalized =
        normalizeDirection(
            home,
            0,
            away
        );

    return {
        home:
            normalized.home,

        away:
            normalized.away,

        rawGap:
            round(
                normalized.away -
                normalized.home
            )
    };
}


/* ============================================================
 * PROBABILITÉ DE MATCH NUL
 * ============================================================ */

/**
 * Le nul est conservé séparément.
 *
 * On ne le crée pas artificiellement à partir du différentiel.
 *
 * Il provient principalement du 1X2 et des signaux historiques.
 */
function calculateDrawProbability(
    marketAnalysis,
    historicalAnalysis
) {
    const marketDraw =
        safeNumber(
            marketAnalysis
                ?.oneXTwo
                ?.probability
                ?.draw
        );

    const historicalDraw =
        safeNumber(
            historicalAnalysis
                ?.directionDistribution
                ?.DRAW
        );

    const historicalConfidence =
        clamp(
            safeNumber(
                historicalAnalysis?.confidence
            )
        );

    const weightMarket = 0.65;

    const weightHistorical =
        0.35 *
        historicalConfidence;

    const denominator =
        weightMarket +
        weightHistorical;

    if (denominator <= 0) {
        return 0;
    }

    return clamp(
        (
            weightMarket * marketDraw +
            weightHistorical * historicalDraw
        ) /
        denominator
    );
}


/* ============================================================
 * CLASSIFICATION
 * ============================================================ */

function classifyDirection(
    probabilities,
    config = DEFAULT_CONFIG
) {
    const home =
        probabilities.home;

    const draw =
        probabilities.draw;

    const away =
        probabilities.away;

    const gap =
        Math.abs(
            home -
            away
        );

    const strongest =
        Math.max(
            home,
            away,
            draw
        );

    if (
        draw >= home &&
        draw >= away
    ) {
        return {
            label: 'DRAW',
            confidence: round(draw)
        };
    }

    if (
        strongest < 0.45 ||
        gap < 0.10
    ) {
        return {
            label: 'BALANCED',
            confidence:
                round(strongest)
        };
    }

    if (away > home) {
        return {
            label:
                gap >=
                safeNumber(
                    config.extremeFavoriteGap,
                    0.35
                )
                    ? 'AWAY_DOMINANT'
                    : 'AWAY_FAVORITE',

            confidence:
                round(away)
        };
    }

    return {
        label:
            gap >=
            safeNumber(
                config.extremeFavoriteGap,
                0.35
            )
                ? 'HOME_DOMINANT'
                : 'HOME_FAVORITE',

        confidence:
            round(home)
    };
}


/* ============================================================
 * ANALYSE PRINCIPALE
 * ============================================================ */

function analyzeDirection(
    marketAnalysis,
    historicalAnalysis,
    config = {}
) {
    const finalConfig = {
        ...DEFAULT_CONFIG,
        ...config
    };

    /*
     * 1. Récupération des sorties déjà calculées.
     */
    const signals = {
        market:
            extractMarketDirection(
                marketAnalysis
            ),

        oneXTwo:
            extractOneXTwoDirection(
                marketAnalysis
            ),

        handicap:
            extractHandicapDirection(
                marketAnalysis
            ),

        historical:
            extractHistoricalDirection(
                historicalAnalysis
            ),

        scoring:
            extractScoringDirection(
                marketAnalysis
            )
    };


    /*
     * 2. Force spécifique du favori extérieur.
     */
    const awayFavorite =
        calculateAwayFavoriteStrength(
            marketAnalysis
        );


    /*
     * 3. Concordance.
     */
    const concordance =
        calculateConcordance(
            signals
        );


    /*
     * 4. Conflit.
     */
    const conflict =
        calculateDirectionalConflict(
            signals
        );


    /*
     * 5. Score directionnel HOME/AWAY.
     */
    const directionalScore =
        calculateDirectionalScore(
            signals,
            finalConfig
        );


    /*
     * 6. Probabilité de nul.
     */
    const draw =
        calculateDrawProbability(
            marketAnalysis,
            historicalAnalysis
        );


    /*
     * 7. Construction finale.
     */
    const probabilities =
        normalizeDirection(
            directionalScore.home,
            draw,
            directionalScore.away
        );


   /*
     * 8. Classification.
     */
    const classification =
        classifyDirection(
            probabilities,
            finalConfig
        );


    /*
     * 9. Mesure de confiance globale.
     */
    const confidence =
        clamp(
            (
                classification.confidence *
                0.50
            ) +
            (
                concordance.agreement *
                0.30
            ) +
            (
                awayFavorite.strength *
                0.20
            )
        );


    return {
        probabilities: {
            home:
                round(probabilities.home),

            draw:
                round(probabilities.draw),

            away:
                round(probabilities.away)
        },

        classification,

        confidence:
            round(confidence),

        awayFavorite,

        concordance,

        conflict,

        signals: {
            market: signals.market,
            oneXTwo: signals.oneXTwo,
            handicap: signals.handicap,
            historical: signals.historical,
            scoring: signals.scoring
        },

        /*
         * Signal compact destiné aux moteurs suivants.
         */
        directionalGap:
            round(
                probabilities.away -
                probabilities.home
            ),

        metadata: {
            source:
                'MARKET_HISTORY_DIRECTION_FUSION',

            generatedAt:
                new Date().toISOString()
        }
    };
}


/* ============================================================
 * EXPORTS
 * ============================================================ */

export {
    normalizeDirection,

    extractMarketDirection,
    extractOneXTwoDirection,
    extractHandicapDirection,
    extractHistoricalDirection,
    extractScoringDirection,

    calculateConcordance,
    calculateDirectionalConflict,
    calculateAwayFavoriteStrength,

    calculateDirectionalScore,
    calculateDrawProbability,

    classifyDirection,

    analyzeDirection
};