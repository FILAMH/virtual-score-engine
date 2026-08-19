/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * core/upsetEngine.js
 * ============================================================
 *
 * RÔLE UNIQUE
 * ------------------------------------------------------------
 * Détecter les situations dans lesquelles les signaux du
 * marché, de la direction, des buts et du régime présentent
 * une anomalie ou une divergence susceptible d'indiquer un
 * résultat inattendu.
 *
 * Ce module ne :
 *   - ne lit pas directement les cotes brutes ;
 *   - ne reconstruit pas l'historique ;
 *   - ne calcule pas les lambdas définitives ;
 *   - ne génère pas les scores exacts ;
 *   - ne génère pas les Top 3.
 *
 * Il fournit principalement :
 *
 *   P_UPSET
 *   P_AWAY_UPSET
 *   P_HOME_UPSET
 *   P_AWAY_BLOWOUT
 *
 * ainsi que les composantes permettant aux modules suivants
 * de comprendre POURQUOI un résultat atypique est détecté.
 *
 * ============================================================
 */

'use strict';


/* ============================================================
 * CONFIGURATION
 * ============================================================ */

const DEFAULT_CONFIG = {
    temperature: 0.80,

    weights: {
        marketConflict: 0.24,
        handicapConflict: 0.20,
        scoringConflict: 0.18,
        directionConflict: 0.16,
        historicalDivergence: 0.10,
        regimeInteraction: 0.12
    },

    awayBlowout: {
        awayStrength: 0.30,
        scoringPressure: 0.25,
        overPressure: 0.20,
        handicapStrength: 0.15,
        directionConfidence: 0.10
    },
    
    homeBlowout: {
        homeStrength: 0.30,
        scoringPressure: 0.25,
        overPressure: 0.20,
        handicapStrength: 0.15,
        directionConfidence: 0.10
    },
    
    thresholds: {
        strongAwayFavorite: 0.60,
        strongHomeFavorite: 0.60,
        strongOver25: 0.65,
        strongOver35: 0.45,
        strongAwayScoring: 0.65,
        strongHomeScoring: 0.65
    }
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


function sigmoid(x) {
    const value = safeNumber(x);

    if (value >= 0) {
        const z = Math.exp(-value);

        return 1 / (1 + z);
    }

    const z = Math.exp(value);

    return z / (1 + z);
}


function softmax3(
    home,
    draw,
    away,
    temperature = 1
) {
    const T =
        Math.max(
            safeNumber(
                temperature,
                1
            ),
            0.05
        );

    const values = [
        safeNumber(home),
        safeNumber(draw),
        safeNumber(away)
    ].map(
        value => value / T
    );

    const max =
        Math.max(...values);

    const expValues =
        values.map(
            value =>
                Math.exp(
                    value - max
                )
        );

    const total =
        expValues.reduce(
            (sum, value) =>
                sum + value,
            0
        );

    if (
        total <=
        Number.EPSILON
    ) {
        return {
            home: 1 / 3,
            draw: 1 / 3,
            away: 1 / 3
        };
    }

    return {
        home:
            expValues[0] / total,

        draw:
            expValues[1] / total,

        away:
            expValues[2] / total
    };
}


/* ============================================================
 * EXTRACTION
 * ============================================================ */

function extractDirection(
    directionAnalysis = {}
) {
    const probabilities =
        directionAnalysis
            ?.probabilities || {};

    return {
        home:
            clamp(
                safeNumber(
                    probabilities.home,
                    1 / 3
                )
            ),

        draw:
            clamp(
                safeNumber(
                    probabilities.draw,
                    1 / 3
                )
            ),

        away:
            clamp(
                safeNumber(
                    probabilities.away,
                    1 / 3
                )
            ),

        confidence:
            clamp(
                safeNumber(
                    directionAnalysis.confidence
                )
            ),

        gap:
            safeNumber(
                directionAnalysis.directionalGap
            )
    };
}


function extractRegime(
    regimeAnalysis = {}
) {
    const probabilities =
        regimeAnalysis
            ?.probabilities || {};

    return {
        low:
            clamp(
                safeNumber(
                    probabilities.LOW,
                    1 / 3
                )
            ),

        normal:
            clamp(
                safeNumber(
                    probabilities.NORMAL,
                    1 / 3
                )
            ),

        blowout:
            clamp(
                safeNumber(
                    probabilities.BLOWOUT,
                    1 / 3
                )
            ),

        label:
            regimeAnalysis.regime ||
            'NORMAL',

        confidence:
            clamp(
                safeNumber(
                    regimeAnalysis.confidence
                )
            )
    };
}


function extractMarket(
    marketAnalysis = {}
) {
    const oneXTwo =
        marketAnalysis?.oneXTwo
            ?.probability || {};

    const btts =
        marketAnalysis?.btts || {};

    const totals =
        marketAnalysis?.totals ||
        marketAnalysis?.total ||
        {};

    const scoring =
        marketAnalysis?.teamScoring ||
        {};

    return {
        home:
            clamp(
                safeNumber(
                    oneXTwo.home,
                    1 / 3
                )
            ),

        draw:
            clamp(
                safeNumber(
                    oneXTwo.draw,
                    1 / 3
                )
            ),

        away:
            clamp(
                safeNumber(
                    oneXTwo.away,
                    1 / 3
                )
            ),

        bttsYes:
            clamp(
                safeNumber(
                    btts.yesProbability ??
                    btts.probability?.yes
                )
            ),

        over25:
            clamp(
                safeNumber(
                    totals.over25Probability ??
                    totals.over25 ??
                    totals.probability?.over25
                )
            ),

        over35:
            clamp(
                safeNumber(
                    totals.over35Probability ??
                    totals.over35 ??
                    totals.probability?.over35
                )
            ),

        awayScoring:
            clamp(
                safeNumber(
                    scoring.relativeProbability?.away ??
                    scoring.probability?.away
                )
            ),

        homeScoring:
            clamp(
                safeNumber(
                    scoring.relativeProbability?.home ??
                    scoring.probability?.home
                )
            )
    };
}


function extractHistorical(
    historicalAnalysis = {}
) {
    const direction =
        historicalAnalysis
            ?.directionDistribution || {};

    return {
        home:
            clamp(
                safeNumber(
                    direction.HOME,
                    1 / 3
                )
            ),

        draw:
            clamp(
                safeNumber(
                    direction.DRAW,
                    1 / 3
                )
            ),

        away:
            clamp(
                safeNumber(
                    direction.AWAY,
                    1 / 3
                )
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
 * 1. CONFLIT 1X2 / DIRECTION
 * ============================================================ */

function calculateMarketDirectionConflict(
    market,
    direction
) {
    const marketGap =
        market.away -
        market.home;

    const directionGap =
        direction.away -
        direction.home;

    /*
     * Même signe = cohérence.
     * Signe opposé = conflit.
     */
    const product =
        marketGap *
        directionGap;

    if (product >= 0) {
        return {
            value: 0,
            direction: 'NONE'
        };
    }

    const magnitude =
        clamp(
            Math.abs(
                marketGap -
                directionGap
            )
        );

    return {
        value:
            round(magnitude),

        direction:
            marketGap > 0
                ? 'AWAY_MARKET_HOME_DIRECTION'
                : 'HOME_MARKET_AWAY_DIRECTION'
    };
}


/* ============================================================
 * 2. CONFLIT HANDICAP
 * ============================================================ */

function calculateHandicapConflict(
    marketAnalysis,
    direction
) {
    const handicap =
        marketAnalysis?.handicap;

    if (
        !handicap ||
        typeof handicap !== 'object'
    ) {
        return {
            value: 0,
            direction: 'NONE'
        };
    }

    let home = 0;
    let away = 0;
    let count = 0;

    for (
        const line
        of Object.values(handicap)
    ) {
        const h =
            safeNumber(
                line?.probability?.home,
                NaN
            );

        const a =
            safeNumber(
                line?.probability?.away,
                NaN
            );

        if (
            !Number.isFinite(h) ||
            !Number.isFinite(a)
        ) {
            continue;
        }

        home += h;
        away += a;
        count++;
    }

    if (count === 0) {
        return {
            value: 0,
            direction: 'NONE'
        };
    }

    const handicapGap =
        (
            away / count
        ) -
        (
            home / count
        );

    const directionGap =
        direction.away -
        direction.home;

    if (
        handicapGap *
        directionGap >= 0
    ) {
        return {
            value: 0,
            direction: 'NONE'
        };
    }

    return {
        value:
            round(
                clamp(
                    Math.abs(
                        handicapGap -
                        directionGap
                    )
                )
            ),

        direction:
            handicapGap > 0
                ? 'HANDICAP_AWAY_DIRECTION_HOME'
                : 'HANDICAP_HOME_DIRECTION_AWAY'
    };
}


/* ============================================================
 * 3. CONFLIT MARCHÉ DES BUTS
 * ============================================================ */

function calculateScoringConflict(
    market,
    direction
) {
    const scoringGap =
        market.awayScoring -
        market.homeScoring;

    const directionGap =
        direction.away -
        direction.home;

    if (
        scoringGap *
        directionGap >= 0
    ) {
        return {
            value: 0,
            direction: 'NONE'
        };
    }

    return {
        value:
            round(
                clamp(
                    Math.abs(
                        scoringGap -
                        directionGap
                    )
                )
            ),

        direction:
            scoringGap > 0
                ? 'AWAY_SCORING_HOME_DIRECTION'
                : 'HOME_SCORING_AWAY_DIRECTION'
    };
}


/* ============================================================
 * 4. DIVERGENCE HISTORIQUE
 * ============================================================ */

function calculateHistoricalDivergence(
    direction,
    historical
) {
    const currentGap =
        direction.away -
        direction.home;

    const historicalGap =
        historical.away -
        historical.home;

    const difference =
        currentGap -
        historicalGap;

    const conflict =
        currentGap *
        historicalGap < 0;

    return {
        value:
            round(
                conflict
                    ? clamp(
                        Math.abs(difference)
                    )
                    : 0
            ),

        direction:
            conflict
                ? historicalGap > 0
                    ? 'HISTORICAL_AWAY_CURRENT_HOME'
                    : 'HISTORICAL_HOME_CURRENT_AWAY'
                : 'NONE'
    };
}


/* ============================================================
 * 5. PRESSION AWAY BLOWOUT
 * ============================================================ */

/**
 * Estimation d'un scénario de forte domination extérieure.
 *
 * IMPORTANT :
 *
 * Ce signal ne dit PAS :
 *
 *     "le score sera 0-4".
 *
 * Il indique uniquement qu'une configuration statistique
 * compatible avec une forte production offensive extérieure
 * existe.
 *
 * La transformation en lambdas appartient à lambdaEngine.js.
 */
function calculateAwayBlowoutProbability(
    market,
    direction,
    regime,
    config
) {
    const weights =
        config.awayBlowout;

    const awayStrength =
        direction.away;

    const scoringPressure =
        market.awayScoring;

    const overPressure =
        (
            0.65 * market.over25 +
            0.35 * market.over35
        );

    const directionalConfidence =
        direction.confidence;

    /*
     * Handicap strength est approchée ici par la différence
     * de probabilité directionnelle du marché.
     *
     * Le handicap détaillé est déjà traité dans le conflit
     * handicap ; il n'est pas recalculé ici.
     */
    const handicapStrength =
        clamp(
            Math.abs(
                market.away -
                market.home
            )
        );

    let raw =
        weights.awayStrength *
            awayStrength +

        weights.scoringPressure *
            scoringPressure +

        weights.overPressure *
            overPressure +

        weights.handicapStrength *
            handicapStrength +

        weights.directionConfidence *
            directionalConfidence;


    /*
     * Interaction fondamentale :
     *
     * Une domination extérieure n'est considérée comme
     * "blowout-compatible" que si elle est accompagnée
     * d'une pression de buts.
     */
    const interaction =
        Math.sqrt(
            clamp(awayStrength) *
            clamp(overPressure)
        );

    raw =
        0.65 * raw +
        0.35 * interaction;


    /*
     * Le régime BLOWOUT renforce le signal sans le créer
     * artificiellement.
     */
   raw =
    raw *
    (
        0.70 +
        0.30 *
        regime.blowout
    );


return clamp(raw);
}


/**
 * Estimation d'un scénario de forte domination domicile.
 *
 * Symétrique exact de calculateAwayBlowoutProbability.
 *
 * IMPORTANT :
 *
 * Ce signal ne dit PAS :
 *
 *     "le score sera 4-0".
 *
 * Il indique uniquement qu'une configuration statistique
 * compatible avec une forte production offensive domicile
 * existe.
 *
 * La transformation en lambdas appartient à lambdaEngine.js.
 */
function calculateHomeBlowoutProbability(
    market,
    direction,
    regime,
    config
) {
    const weights =
        config.homeBlowout;
    
    const homeStrength =
        direction.home;
    
    const scoringPressure =
        market.homeScoring;
    
    const overPressure =
        (
            0.65 * market.over25 +
            0.35 * market.over35
        );
    
    const directionalConfidence =
        direction.confidence;
    
    const handicapStrength =
        clamp(
            Math.abs(
                market.home -
                market.away
            )
        );
    
    let raw =
        weights.homeStrength *
        homeStrength +
        
        weights.scoringPressure *
        scoringPressure +
        
        weights.overPressure *
        overPressure +
        
        weights.handicapStrength *
        handicapStrength +
        
        weights.directionConfidence *
        directionalConfidence;
    
    
    /*
     * Même interaction que pour l'extérieur : une domination
     * domicile n'est "blowout-compatible" que si elle est
     * accompagnée d'une pression de buts.
     */
    const interaction =
        Math.sqrt(
            clamp(homeStrength) *
            clamp(overPressure)
        );
    
    raw =
        0.65 * raw +
        0.35 * interaction;
    
    
    raw =
        raw *
        (
            0.70 +
            0.30 *
            regime.blowout
        );
    
    
    return clamp(raw);
}


/* ============================================================
 * 6. UPSET DIRECTIONNEL
 * ============================================================ */

function calculateDirectionalUpset(
    market,
    direction
) {
    const marketFavorite =
        market.away >
        market.home
            ? 'AWAY'
            : market.home >
                market.away
                ? 'HOME'
                : 'NONE';

    const directionFavorite =
        direction.away >
        direction.home
            ? 'AWAY'
            : direction.home >
                direction.away
                ? 'HOME'
                : 'NONE';

    if (
        marketFavorite === 'NONE' ||
        directionFavorite === 'NONE' ||
        marketFavorite ===
            directionFavorite
    ) {
        return {
            probability: 0,
            side: 'NONE'
        };
    }

    const marketGap =
        Math.abs(
            market.away -
            market.home
        );

    const directionGap =
        Math.abs(
            direction.away -
            direction.home
        );

    const probability =
        clamp(
            (
                marketGap +
                directionGap
            ) / 2
        );

    return {
        probability:
            round(probability),

        side:
            directionFavorite
    };
}


/* ============================================================
 * 7. COMBINAISON DES SIGNAUX
 * ============================================================ */

function calculateUpsetProbability(
    components,
    config
) {
    const weights =
        config.weights;

    const weighted =
        weights.marketConflict *
            components.marketConflict +

        weights.handicapConflict *
            components.handicapConflict +

        weights.scoringConflict *
            components.scoringConflict +

        weights.directionConflict *
            components.directionConflict +

        weights.historicalDivergence *
            components.historicalDivergence +

        weights.regimeInteraction *
            components.regimeInteraction;

    /*
     * Transformation sigmoïde.
     *
     * Elle empêche qu'un seul conflit fasse immédiatement
     * passer P_UPSET à 1.
     */
    const centered =
        (
            weighted -
            0.35
        ) *
        7;

    return clamp(
        sigmoid(centered)
    );
}


/* ============================================================
 * 8. ANALYSE PRINCIPALE
 * ============================================================ */

function analyzeUpset(
    marketAnalysis = {},
    directionAnalysis = {},
    regimeAnalysis = {},
    historicalAnalysis = {},
    featureAnalysis = {},
    config = {}
) {
    const finalConfig = {
        ...DEFAULT_CONFIG,
        ...config,

        weights: {
            ...DEFAULT_CONFIG.weights,
            ...(config.weights || {})
        },

        awayBlowout: {
            ...DEFAULT_CONFIG.awayBlowout,
            ...(config.awayBlowout || {})
        },

        thresholds: {
            ...DEFAULT_CONFIG.thresholds,
            ...(config.thresholds || {})
        }
    };


    /*
     * Extraction.
     */
    const market =
        extractMarket(
            marketAnalysis
        );

    const direction =
        extractDirection(
            directionAnalysis
        );

    const regime =
        extractRegime(
            regimeAnalysis
        );

    const historical =
        extractHistorical(
            historicalAnalysis
        );


    /*
     * Conflits.
     */
    const marketConflict =
        calculateMarketDirectionConflict(
            market,
            direction
        );

    const handicapConflict =
        calculateHandicapConflict(
            marketAnalysis,
            direction
        );

    const scoringConflict =
        calculateScoringConflict(
            market,
            direction
        );

    const historicalDivergence =
        calculateHistoricalDivergence(
            direction,
            historical
        );


    /*
     * Interaction régime / direction.
     *
     * Un régime BLOWOUT accompagné d'une forte direction
     * extérieure est particulièrement important pour le futur
     * lambdaEngine.
     */
    const regimeInteraction =
        clamp(
            regime.blowout *
            Math.abs(
                direction.away -
                direction.home
            )
        );


    /*
     * Conflit directionnel global.
     */
    const directionConflict =
        clamp(
            0.50 *
                marketConflict.value +

            0.30 *
                handicapConflict.value +

            0.20 *
                scoringConflict.value
        );


   /*
     * Probabilité globale d'UPSET.
     */
    const P_UPSET =
        calculateUpsetProbability(
            {
                marketConflict:
                    marketConflict.value,

                handicapConflict:
                    handicapConflict.value,

                scoringConflict:
                    scoringConflict.value,

                directionConflict,

                historicalDivergence:
                    historicalDivergence.value,

                regimeInteraction
            },
            finalConfig
        );


    /*
 * Probabilité spécifique d'un scénario
 * de domination extérieure.
 */
const P_AWAY_BLOWOUT =
    calculateAwayBlowoutProbability(
        market,
        direction,
        regime,
        finalConfig
    );


/*
 * Probabilité spécifique d'un scénario
 * de domination domicile.
 */
const P_HOME_BLOWOUT =
    calculateHomeBlowoutProbability(
        market,
        direction,
        regime,
        finalConfig
    );


/*
 * Upset directionnel.
 */
    const directionalUpset =
        calculateDirectionalUpset(
            market,
            direction
        );


    /*
     * Séparation des scénarios.
     *
     * P_AWAY_UPSET n'est pas simplement P_UPSET.
     * On exige une direction extérieure cohérente.
     */
    const awayDirectionFactor =
        clamp(
            direction.away
        );

    const homeDirectionFactor =
        clamp(
            direction.home
        );

    const P_AWAY_UPSET =
        clamp(
            P_UPSET *
            (
                0.50 +
                0.50 *
                awayDirectionFactor
            )
        );

    const P_HOME_UPSET =
        clamp(
            P_UPSET *
            (
                0.50 +
                0.50 *
                homeDirectionFactor
            )
        );


    /*
     * Distribution directionnelle des scénarios.
     */
    const scenarioDistribution =
        softmax3(
            P_HOME_UPSET,
            Math.max(
                0,
                1 -
                P_UPSET
            ),
            P_AWAY_UPSET,
            finalConfig.temperature
        );


   return {
        probabilities: {
            upset:
                round(P_UPSET),

            awayUpset:
                round(P_AWAY_UPSET),

            homeUpset:
                round(P_HOME_UPSET),

            awayBlowout:
                round(P_AWAY_BLOWOUT),

            homeBlowout:
                round(P_HOME_BLOWOUT)
        },

        scenarios: {
            HOME:
                round(
                    scenarioDistribution.home
                ),

            DRAW:
                round(
                    scenarioDistribution.draw
                ),

            AWAY:
                round(
                    scenarioDistribution.away
                )
        },

        conflicts: {
            market:
                marketConflict,

            handicap:
                handicapConflict,

            scoring:
                scoringConflict,

            historical:
                historicalDivergence,

            direction:
                round(directionConflict)
        },

        direction: {
            marketFavorite:
                market.away >
                market.home
                    ? 'AWAY'
                    : market.home >
                        market.away
                        ? 'HOME'
                        : 'NONE',

            modelDirection:
                direction.away >
                direction.home
                    ? 'AWAY'
                    : direction.home >
                        direction.away
                        ? 'HOME'
                        : 'BALANCED',

            directionalUpset
        },

        regime: {
            label:
                regime.label,

            blowoutProbability:
                round(
                    regime.blowout
                ),

            confidence:
                round(
                    regime.confidence
                )
        },

        signals: {
            market,
            direction,
            historical
        },

        metadata: {
            model:
                'UPSET_CONFLICT_ENGINE',

            generatedAt:
                new Date().toISOString()
        }
    };
}


/* ============================================================
 * VALIDATION
 * ============================================================ */

function validateUpsetResult(
    result
) {
    if (!result) {
        return false;
    }

    const probabilities =
        result.probabilities;

    if (!probabilities) {
        return false;
    }

    const fields = [
    'upset',
    'awayUpset',
    'homeUpset',
    'awayBlowout',
    'homeBlowout'
];

    return fields.every(
        field =>
            Number.isFinite(
                Number(
                    probabilities[field]
                )
            ) &&
            probabilities[field] >= 0 &&
            probabilities[field] <= 1
    );
}


/* ============================================================
 * EXPORTS
 * ============================================================ */

export {
    sigmoid,
    softmax3,

    extractDirection,
    extractRegime,
    extractMarket,
    extractHistorical,

    calculateMarketDirectionConflict,
    calculateHandicapConflict,
    calculateScoringConflict,
    calculateHistoricalDivergence,

    calculateAwayBlowoutProbability,
calculateHomeBlowoutProbability,
calculateDirectionalUpset,
calculateUpsetProbability,

    analyzeUpset,
    validateUpsetResult
};