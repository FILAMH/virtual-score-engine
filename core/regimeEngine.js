/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * core/regimeEngine.js
 * ============================================================
 *
 * RÔLE
 * ------------------------------------------------------------
 * Déterminer le régime probabiliste du match :
 *
 *   LOW       = faible intensité / faible volume de buts
 *   NORMAL    = comportement intermédiaire
 *   BLOWOUT   = forte intensité / potentiel de score élevé
 *
 * Ce module ne :
 *   - lit pas directement les cotes brutes ;
 *   - ne recherche pas l'historique ;
 *   - ne calcule pas les lambdas définitives ;
 *   - ne génère pas les scores exacts ;
 *   - ne génère pas les Top 3.
 *
 * Il consomme les informations déjà préparées par les modules
 * précédents et fournit un régime probabiliste aux modules
 * suivants.
 *
 * ============================================================
 */

'use strict';


/* ============================================================
 * CONFIGURATION
 * ============================================================ */

const DEFAULT_CONFIG = {
    temperature: 0.85,

    /*
     * Les coefficients ne sont pas des "vérités universelles".
     * Ils constituent les paramètres initiaux du moteur.
     * Le futur calibrationEngine / learning layer pourra les
     * recalibrer à partir des historiques.
     */
    low: {
        btts: 0.45,
        over25: 0.20,
        over35: 0.10,
        totalGoals: 0.30,
        cleanSheet: 0.20
    },

    normal: {
        btts: 0.60,
        over25: 0.50,
        over35: 0.30,
        totalGoals: 0.50,
        cleanSheet: 0.10
    },

    blowout: {
        btts: 0.45,
        over25: 0.80,
        over35: 0.65,
        totalGoals: 0.70,
        cleanSheet: 0.55
    },

    /*
     * Un signal de buts très fort doit pouvoir augmenter
     * l'intensité sans décider à lui seul du régime.
     */
    extremeGoalSignal: 0.85,

    /*
     * Seuil de confiance descriptive.
     */
    highConfidence: 0.60
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


/* ============================================================
 * SIGMOID
 * ============================================================ */

function sigmoid(x) {
    const value = safeNumber(x);

    if (value >= 0) {
        const z = Math.exp(-value);

        return 1 / (1 + z);
    }

    const z = Math.exp(value);

    return z / (1 + z);
}


/* ============================================================
 * SOFTMAX
 * ============================================================ */

/**
 * Transforme les scores latents des trois régimes en
 * probabilités :
 *
 * P(R_i) =
 * exp(z_i / T)
 * -------------------------
 * Σ_j exp(z_j / T)
 *
 * Le décalage max est utilisé pour éviter les overflow
 * numériques.
 */
function softmax(scores, temperature = 1) {
    const T =
        Math.max(
            safeNumber(temperature, 1),
            0.05
        );

    const values = [
        safeNumber(scores.low),
        safeNumber(scores.normal),
        safeNumber(scores.blowout)
    ];

    const scaled =
        values.map(
            value => value / T
        );

    const maxValue =
        Math.max(...scaled);

    const exponentials =
        scaled.map(
            value =>
                Math.exp(
                    value -
                    maxValue
                )
        );

    const total =
        exponentials.reduce(
            (sum, value) =>
                sum + value,
            0
        );

    if (total <= Number.EPSILON) {
        return {
            LOW: 1 / 3,
            NORMAL: 1 / 3,
            BLOWOUT: 1 / 3
        };
    }

    return {
        LOW:
            exponentials[0] /
            total,

        NORMAL:
            exponentials[1] /
            total,

        BLOWOUT:
            exponentials[2] /
            total
    };
}


/* ============================================================
 * EXTRACTION DES FEATURES
 * ============================================================ */

/**
 * Le featureEngine / marketEngine peut exposer différentes
 * structures selon la version des données.
 *
 * Cette fonction accepte plusieurs noms sans recréer les
 * calculs effectués dans les modules précédents.
 */
function extractProbability(
    source,
    paths,
    fallback = 0
) {
    for (const path of paths) {
        let current = source;

        for (const key of path) {
            if (
                current === null ||
                current === undefined
            ) {
                current = undefined;
                break;
            }

            current = current[key];
        }

        const value =
            Number(current);

        if (Number.isFinite(value)) {
            return clamp(value);
        }
    }

    return fallback;
}


/**
 * Extraction centralisée des signaux nécessaires au régime.
 */
function extractRegimeSignals(
    featureAnalysis = {},
    marketAnalysis = {},
    directionAnalysis = {}
) {
    const bttsYes =
        extractProbability(
            marketAnalysis,
            [
                ['btts', 'yesProbability'],
                ['btts', 'probability', 'yes'],
                ['btts', 'yes'],
                ['bothTeamsToScore', 'yesProbability']
            ]
        );

    const over25 =
        extractProbability(
            marketAnalysis,
            [
                ['totals', 'over25Probability'],
                ['total', 'over25Probability'],
                ['over25', 'probability'],
                ['over25']
            ]
        );

    const over35 =
        extractProbability(
            marketAnalysis,
            [
                ['totals', 'over35Probability'],
                ['total', 'over35Probability'],
                ['over35', 'probability'],
                ['over35']
            ]
        );

    const totalGoals =
        extractProbability(
            featureAnalysis,
            [
                /*
                 * featureEngine.buildFeatures() expose cette
                 * estimation sous goalEnvironment.expectedTotalGoals.
                 */
                ['goalEnvironment', 'expectedTotalGoals'],
                ['exactGoals', 'expectedGoals'],
                ['goal', 'expectedTotalGoals'],
                ['goals', 'expectedTotal'],
                ['expectedTotalGoals'],
                ['totalGoals']
            ]
        );

    /*
     * Si une estimation de total n'est pas disponible,
     * le marché Over 2.5 fournit un proxy.
     */
    const normalizedTotalGoals =
        totalGoals > 0
            ? clamp(totalGoals / 5)
            : over25;

    const cleanSheetHome =
        extractProbability(
            marketAnalysis,
            [
                ['cleanSheet', 'home'],
                ['cleanSheet', 'homeProbability'],
                ['homeCleanSheetProbability']
            ]
        );

    const cleanSheetAway =
        extractProbability(
            marketAnalysis,
            [
                ['cleanSheet', 'away'],
                ['cleanSheet', 'awayProbability'],
                ['awayCleanSheetProbability']
            ]
        );

    const cleanSheet =
        clamp(
            (
                cleanSheetHome +
                cleanSheetAway
            ) / 2
        );

    const awayStrength =
        extractProbability(
            directionAnalysis,
            [
                ['probabilities', 'away'],
                ['awayProbability']
            ]
        );

    const homeStrength =
        extractProbability(
            directionAnalysis,
            [
                ['probabilities', 'home'],
                ['homeProbability']
            ]
        );

    const directionalGap =
        Math.abs(
            awayStrength -
            homeStrength
        );

    return {
        bttsYes,
        over25,
        over35,
        totalGoals:
            normalizedTotalGoals,

        cleanSheet,

        homeStrength,
        awayStrength,
        directionalGap
    };
}


/* ============================================================
 * FEATURES DERIVEES
 * ============================================================ */

/**
 * Le régime ne dépend pas d'une seule cote.
 *
 * On construit des signaux composites :
 *
 * GoalPressure
 *     = combinaison Over 2.5 / Over 3.5 / BTTS
 *
 * LowGoalPressure
 *     = complément de la pression offensive
 *
 * BlowoutPressure
 *     = combinaison volume + asymétrie directionnelle
 */
function deriveRegimeSignals(signals) {
    const goalPressure =
        clamp(
            0.40 * signals.over25 +
            0.25 * signals.over35 +
            0.20 * signals.bttsYes +
            0.15 * signals.totalGoals
        );

    const lowGoalPressure =
        clamp(
            0.60 * (1 - signals.over25) +
            0.25 * (1 - signals.over35) +
            0.15 * signals.cleanSheet
        );

    /*
     * Une forte asymétrie ne signifie PAS automatiquement
     * "blowout".
     *
     * Elle ne devient importante que si elle est accompagnée
     * d'une pression de buts suffisante.
     */
    const blowoutPressure =
        clamp(
            0.50 * goalPressure +
            0.25 * signals.over35 +
            0.15 * signals.directionalGap +
            0.10 * (
                1 - signals.cleanSheet
            )
        );

    return {
        goalPressure:
            round(goalPressure),

        lowGoalPressure:
            round(lowGoalPressure),

        blowoutPressure:
            round(blowoutPressure)
    };
}


/* ============================================================
 * SCORE LATENT DES RÉGIMES
 * ============================================================ */

/**
 * Chaque régime obtient un score latent.
 *
 * Ces scores ne sont PAS encore des probabilités.
 *
 * Ils sont ensuite transformés par softmax.
 */
function calculateLatentRegimeScores(
    signals,
    derived,
    config
) {
    const low =
        config.low;

    const normal =
        config.normal;

    const blowout =
        config.blowout;

    /*
     * LOW
     *
     * Forte probabilité de faible volume,
     * faible Over 2.5,
     * faible Over 3.5,
     * présence potentielle de clean sheets.
     */
    const lowScore =
        (
            low.btts *
            (1 - signals.bttsYes)
        ) +
        (
            low.over25 *
            (1 - signals.over25)
        ) +
        (
            low.over35 *
            (1 - signals.over35)
        ) +
        (
            low.totalGoals *
            (1 - signals.totalGoals)
        ) +
        (
            low.cleanSheet *
            signals.cleanSheet
        );


    /*
     * NORMAL
     *
     * Zone intermédiaire.
     *
     * On évite de considérer NORMAL comme simplement
     * "ce qui reste".
     */
    const normalScore =
        (
            normal.btts *
            (
                1 -
                Math.abs(
                    signals.bttsYes -
                    0.50
                )
            )
        ) +
        (
            normal.over25 *
            (
                1 -
                Math.abs(
                    signals.over25 -
                    0.50
                )
            )
        ) +
        (
            normal.over35 *
            (
                1 -
                Math.abs(
                    signals.over35 -
                    0.35
                )
            )
        ) +
        (
            normal.totalGoals *
            (
                1 -
                Math.abs(
                    signals.totalGoals -
                    0.50
                )
            )
        );


    /*
     * BLOWOUT
     *
     * IMPORTANT :
     * l'asymétrie seule ne suffit jamais.
     *
     * Le régime BLOWOUT nécessite un signal de volume
     * suffisamment élevé.
     */
    const blowoutScore =
        (
            blowout.btts *
            signals.bttsYes
        ) +
        (
            blowout.over25 *
            signals.over25
        ) +
        (
            blowout.over35 *
            signals.over35
        ) +
        (
            blowout.totalGoals *
            signals.totalGoals
        ) +
        (
            blowout.cleanSheet *
            signals.directionalGap *
            signals.over25
        );

    return {
        LOW:
            round(lowScore),

        NORMAL:
            round(normalScore),

        BLOWOUT:
            round(blowoutScore)
    };
}


/* ============================================================
 * AJUSTEMENT DES RÉGIMES EXTRÊMES
 * ============================================================ */

/**
 * Protection contre deux erreurs classiques :
 *
 * 1. BLOWOUT uniquement parce qu'une équipe est favorite.
 * 2. LOW uniquement parce que BTTS est faible.
 *
 * Le régime doit être soutenu par plusieurs signaux.
 */
function applyRegimeGuards(
    latent,
    signals,
    derived,
    config
) {
    const result = {
        ...latent
    };

    /*
     * Pas assez de pression offensive :
     * on réduit BLOWOUT.
     */
    if (
        derived.goalPressure < 0.45
    ) {
        result.BLOWOUT *= 0.70;
    }

    /*
     * Over 2.5 faible + Over 3.5 faible :
     * réduction supplémentaire du régime BLOWOUT.
     */
    if (
        signals.over25 < 0.35 &&
        signals.over35 < 0.20
    ) {
        result.BLOWOUT *= 0.55;
    }

    /*
     * Forte pression de buts :
     * LOW ne doit pas dominer artificiellement.
     */
    if (
        signals.over25 > 0.70 &&
        signals.over35 > 0.45
    ) {
        result.LOW *= 0.60;
    }

    /*
     * Si la pression offensive est extrêmement faible,
     * LOW reçoit une confirmation.
     */
    if (
        signals.over25 < 0.30 &&
        signals.bttsYes < 0.40
    ) {
        result.LOW *= 1.25;
    }

    /*
     * Un favori extérieur très fort ne signifie pas
     * automatiquement BLOWOUT.
     *
     * Nous exigeons toujours une pression offensive.
     */
    if (
        signals.awayStrength > 0.65 &&
        signals.over25 < 0.50
    ) {
        result.BLOWOUT *= 0.80;
    }

    return {
        LOW:
            Math.max(
                0,
                result.LOW
            ),

        NORMAL:
            Math.max(
                0,
                result.NORMAL
            ),

        BLOWOUT:
            Math.max(
                0,
                result.BLOWOUT
            )
    };
}


/* ============================================================
 * CONFIDENCE DU RÉGIME
 * ============================================================ */

function calculateRegimeConfidence(
    probabilities
) {
    const values = [
        probabilities.LOW,
        probabilities.NORMAL,
        probabilities.BLOWOUT
    ].sort(
        (a, b) => b - a
    );

    const first =
        values[0] ?? 0;

    const second =
        values[1] ?? 0;

    /*
     * Plus l'écart entre le premier et le deuxième régime
     * est grand, plus la classification est nette.
     */
    const margin =
        clamp(
            first -
            second
        );

    return {
        confidence:
            round(
                clamp(
                    0.50 * first +
                    0.50 * margin
                )
            ),

        margin:
            round(margin)
    };
}


/* ============================================================
 * LABEL FINAL
 * ============================================================ */

function classifyRegime(
    probabilities,
    config = DEFAULT_CONFIG
) {
    const entries = [
        ['LOW', probabilities.LOW],
        ['NORMAL', probabilities.NORMAL],
        ['BLOWOUT', probabilities.BLOWOUT]
    ];

    entries.sort(
        (a, b) => b[1] - a[1]
    );

    const regime =
        entries[0][0];

    const probability =
        entries[0][1];

    const confidence =
        calculateRegimeConfidence(
            probabilities
        );

    let certainty =
        'LOW';

    if (
        probability >=
        config.highConfidence
    ) {
        certainty = 'HIGH';
    } else if (
        probability >= 0.45
    ) {
        certainty = 'MEDIUM';
    }

    return {
        regime,

        probability:
            round(probability),

        confidence:
            confidence.confidence,

        margin:
            confidence.margin,

        certainty
    };
}


/* ============================================================
 * ANALYSE PRINCIPALE
 * ============================================================ */

function analyzeRegime(
    featureAnalysis = {},
    marketAnalysis = {},
    directionAnalysis = {},
    config = {}
) {
    const finalConfig = {
        ...DEFAULT_CONFIG,
        ...config,

        low: {
            ...DEFAULT_CONFIG.low,
            ...(config.low || {})
        },

        normal: {
            ...DEFAULT_CONFIG.normal,
            ...(config.normal || {})
        },

        blowout: {
            ...DEFAULT_CONFIG.blowout,
            ...(config.blowout || {})
        }
    };


    /*
     * 1. Récupération des informations déjà produites.
     */
    const signals =
        extractRegimeSignals(
            featureAnalysis,
            marketAnalysis,
            directionAnalysis
        );


    /*
     * 2. Construction des signaux composites.
     */
    const derived =
        deriveRegimeSignals(
            signals
        );


    /*
     * 3. Scores latents.
     */
    const latent =
        calculateLatentRegimeScores(
            signals,
            derived,
            finalConfig
        );


    /*
     * 4. Protections contre les faux régimes.
     */
    const guarded =
        applyRegimeGuards(
            latent,
            signals,
            derived,
            finalConfig
        );


    /*
     * 5. Softmax.
     */
    const probabilities =
        softmax(
            {
                low:
                    guarded.LOW,

                normal:
                    guarded.NORMAL,

                blowout:
                    guarded.BLOWOUT
            },
            finalConfig.temperature
        );


    /*
     * 6. Classification finale.
     */
    const classification =
        classifyRegime(
            probabilities,
            finalConfig
        );


    return {
        regime:
            classification.regime,

        probabilities: {
            LOW:
                round(
                    probabilities.LOW
                ),

            NORMAL:
                round(
                    probabilities.NORMAL
                ),

            BLOWOUT:
                round(
                    probabilities.BLOWOUT
                )
        },

        confidence:
            classification.confidence,

        margin:
            classification.margin,

        certainty:
            classification.certainty,

        signals: {
            ...signals,

            derived
        },

        latentScores: {
            LOW:
                round(guarded.LOW),

            NORMAL:
                round(guarded.NORMAL),

            BLOWOUT:
                round(guarded.BLOWOUT)
        },

        metadata: {
            model:
                'SOFTMAX_REGIME_ENGINE',

            temperature:
                finalConfig.temperature,

            generatedAt:
                new Date().toISOString()
        }
    };
}


/* ============================================================
 * VALIDATION
 * ============================================================ */

function validateRegimeResult(result) {
    if (!result) {
        return false;
    }

    const validRegimes = [
        'LOW',
        'NORMAL',
        'BLOWOUT'
    ];

    if (
        !validRegimes.includes(
            result.regime
        )
    ) {
        return false;
    }

    const p =
        result.probabilities;

    if (!p) {
        return false;
    }

    const total =
        safeNumber(p.LOW) +
        safeNumber(p.NORMAL) +
        safeNumber(p.BLOWOUT);

    return (
        Math.abs(total - 1) <
        1e-6
    );
}


/* ============================================================
 * EXPORTS
 * ============================================================ */

export {
    sigmoid,
    softmax,

    extractRegimeSignals,
    deriveRegimeSignals,

    calculateLatentRegimeScores,
    applyRegimeGuards,

    calculateRegimeConfidence,
    classifyRegime,

    analyzeRegime,
    validateRegimeResult
};