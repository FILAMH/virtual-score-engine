/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * ============================================================
 * File: core/lambdaEngine.js
 *
 * ROLE
 * ----
 * Convertit les informations produites par les moteurs précédents
 * en intensités de buts finales :
 *
 *      λ_home
 *      λ_away
 *
 * Ce fichier NE choisit PAS les scores Top 3.
 * Il prépare les paramètres qui seront utilisés par :
 *
 *      distributionEngine.js
 *          ↓
 *      scoreFusion.js
 *          ↓
 *      predictionEngine.js
 *
 * IMPORTANT
 * ---------
 * Ce moteur ne parse aucune cote brute.
 * Il ne recherche pas directement dans l'historique.
 * Il ne recrée pas les moteurs précédents.
 *
 * Il fusionne leurs informations.
 *
 * Architecture :
 *
 * parser
 *    ↓
 * normalizer
 *    ↓
 * featureEngine
 *    ↓
 * marketEngine
 * historicalEngine
 * directionEngine
 * regimeEngine
 * upsetEngine
 *    ↓
 * lambdaEngine       ← CE FICHIER
 *    ↓
 * distributionEngine
 *    ↓
 * scoreFusion
 *    ↓
 * predictionEngine
 *
 * ============================================================
 */


/* ============================================================
 * CONFIGURATION
 * ============================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    minLambda: 0.05,
    maxLambda: 5.50,

    /*
     * Poids de base.
     *
     * Ils ne représentent PAS des vérités universelles.
     * Ils constituent des paramètres calibrables par
     * parameters.json / modelTrainer ultérieurement.
     */
    weights: {
        market: 0.38,
        historical: 0.27,
        direction: 0.15,
        regime: 0.10,
        upset: 0.10
    },

    /*
     * Intensité maximale des corrections.
     * Les moteurs précédents fournissent des signaux,
     * lambdaEngine les transforme en corrections limitées.
     */
    corrections: {
        directionMax: 0.25,
        regimeMax: 0.30,
        upsetMax: 0.35,
        historicalMax: 0.30
    },

    /*
     * Limite de sécurité permettant d'éviter qu'un seul signal
     * produise artificiellement une lambda extrême.
     */
    maxAdjustment: 0.75
});


/* ============================================================
 * UTILITAIRES LOCAUX
 * ============================================================
 */

function clamp(value, min, max) {
    const x = Number(value);

    if (!Number.isFinite(x)) {
        return min;
    }

    return Math.min(max, Math.max(min, x));
}


function safeNumber(value, fallback = 0) {
    const x = Number(value);

    return Number.isFinite(x) ? x : fallback;
}


function safeProbability(value, fallback = 0.5) {
    return clamp(safeNumber(value, fallback), 0, 1);
}


function safeLambda(value, fallback = 1.0) {
    return clamp(
        safeNumber(value, fallback),
        DEFAULT_CONFIG.minLambda,
        DEFAULT_CONFIG.maxLambda
    );
}


function sigmoid(x) {
    const value = safeNumber(x, 0);

    /*
     * Protection contre overflow.
     */
    if (value >= 40) return 1;
    if (value <= -40) return 0;

    return 1 / (1 + Math.exp(-value));
}


function normalizePair(home, away) {
    const h = Math.max(0, safeNumber(home, 0));
    const a = Math.max(0, safeNumber(away, 0));

    const total = h + a;

    if (total <= 0) {
        return {
            home: 0.5,
            away: 0.5
        };
    }

    return {
        home: h / total,
        away: a / total
    };
}


/* ============================================================
 * EXTRACTION DES PROBABILITÉS
 * ============================================================
 *
 * Les moteurs précédents peuvent utiliser des noms légèrement
 * différents. Ces fonctions permettent à lambdaEngine de rester
 * robuste sans recréer leur logique.
 */

function extractProbability(object, keys, fallback = null) {
    if (!object || typeof object !== "object") {
        return fallback;
    }

    for (const key of keys) {
        const value = object[key];

        if (value !== undefined && value !== null) {
            const number = Number(value);

            if (Number.isFinite(number)) {
                return number > 1 ? number / 100 : number;
            }
        }
    }

    return fallback;
}


/* ============================================================
 * MARKET BASELINE
 * ============================================================
 *
 * Le marketEngine est supposé avoir déjà transformé les cotes
 * en probabilités implicites / probabilités normalisées.
 *
 * Nous ne faisons donc PAS :
 *
 *     1 / cote
 *
 * aveuglément ici.
 *
 * Le marketEngine reste responsable de cette opération.
 */

function getMarketSignal(market) {
    const fallback = {
        home: 0.33,
        draw: 0.34,
        away: 0.33
    };

    if (!market || typeof market !== "object") {
        return fallback;
    }

    /*
     * marketEngine.analyzeMarket() expose les probabilités 1X2
     * sous oneXTwo.probability.{home,draw,away}. On lit cette
     * structure en priorité ; les clés plates restent une
     * sécurité pour d'autres formes d'appel éventuelles.
     */
    const nested = market.oneXTwo?.probability;

    const home = extractProbability(
        nested || market,
        [
            "home",
            "homeProbability",
            "probHome",
            "pHome",
            "homeWinProbability"
        ],
        null
    );

    const draw = extractProbability(
        nested || market,
        [
            "draw",
            "drawProbability",
            "probDraw",
            "pDraw"
        ],
        null
    );

    const away = extractProbability(
        nested || market,
        [
            "away",
            "awayProbability",
            "probAway",
            "pAway",
            "awayWinProbability"
        ],
        null
    );

    if (
        home === null &&
        draw === null &&
        away === null
    ) {
        return fallback;
    }

    const values = [
        Math.max(0, safeNumber(home, 0)),
        Math.max(0, safeNumber(draw, 0)),
        Math.max(0, safeNumber(away, 0))
    ];

    const total = values.reduce((sum, value) => sum + value, 0);

    if (total <= 0) {
        return fallback;
    }

    return {
        home: values[0] / total,
        draw: values[1] / total,
        away: values[2] / total
    };
}


/* ============================================================
 * MARKET → GOAL INTENSITY
 * ============================================================
 *
 * Le résultat 1X2 donne principalement une information
 * directionnelle.
 *
 * Il ne suffit PAS à déterminer λ_home et λ_away.
 *
 * C'est pourquoi le total-goals signal doit également être
 * utilisé lorsqu'il est disponible.
 */

function estimateMarketLambdas(market, features = {}) {
    const signal = getMarketSignal(market);

    /*
     * Intensité totale initiale.
     *
     * Priorité :
     *
     * 1. totalLambda fourni par marketEngine
     * 2. expectedGoals / totalGoals
     * 3. valeur par défaut calibrable
     */
    let totalLambda =
        safeNumber(market?.totalLambda, NaN);

    if (!Number.isFinite(totalLambda)) {
        totalLambda =
            safeNumber(market?.expectedGoals, NaN);
    }

    if (!Number.isFinite(totalLambda)) {
        totalLambda =
            safeNumber(market?.expectedTotalGoals, NaN);
    }

    if (!Number.isFinite(totalLambda)) {
        /*
         * featureEngine.buildFeatures() calcule déjà une
         * estimation du nombre total de buts, dérivée du
         * marché "Nombre exact" (exactGoals.expectedGoals),
         * exposée sous goalEnvironment.expectedTotalGoals.
         */
        totalLambda =
            safeNumber(
                features?.goalEnvironment?.expectedTotalGoals,
                NaN
            );
    }

    if (!Number.isFinite(totalLambda)) {
        totalLambda =
            safeNumber(
                features?.exactGoals?.expectedGoals,
                NaN
            );
    }

    if (!Number.isFinite(totalLambda)) {
        /*
         * Fallback neutre.
         * Il sera remplacé par les autres signaux disponibles.
         */
        totalLambda = 2.50;
    }

    /*
     * Direction de marché.
     *
     * On utilise une transformation douce plutôt qu'un
     * multiplicateur brutal.
     */
    const homeShare =
        clamp(
            signal.home + 0.5 * signal.draw,
            0.10,
            0.90
        );

    const awayShare =
        clamp(
            signal.away + 0.5 * signal.draw,
            0.10,
            0.90
        );

    /*
     * Normalisation.
     */
    const shares = normalizePair(homeShare, awayShare);

    let lambdaHome = totalLambda * shares.home;
    let lambdaAway = totalLambda * shares.away;

    /*
     * Si featureEngine fournit directement des estimations
     * de buts, elles sont préférées comme information
     * supplémentaire.
     */
    const featureHome = safeNumber(
        features.marketLambdaHome,
        NaN
    );

    const featureAway = safeNumber(
        features.marketLambdaAway,
        NaN
    );

    if (Number.isFinite(featureHome)) {
        lambdaHome = 0.70 * lambdaHome + 0.30 * featureHome;
    }

    if (Number.isFinite(featureAway)) {
        lambdaAway = 0.70 * lambdaAway + 0.30 * featureAway;
    }

    /*
     * PLANCHER INFORMÉ PAR LE MARCHÉ BTTS.
     *
     * Constat vérifié sur plusieurs matchs réels (Real Madrid vs
     * Gérone, Alaves vs Atlético, Alaves vs Valencia) : quand un
     * favori est très marqué, le plancher fixe de part de marché
     * (10%) pousse le lambda de l'équipe négligée si bas que le
     * Top 3 ne propose plus que des scores blancs (X-0) — alors
     * que le marché "Deux équipes vont marquer" (BTTS) annonçait
     * dans ces trois cas 50 à 58% de chances que l'équipe
     * négligée marque au moins un but, et c'est ce qui s'est
     * produit à chaque fois (4-1, 2-3, 1-1 en cours de match).
     *
     * Pour une loi de Poisson : P(X≥1) = 1 - e^(-λ).
     * On dérive donc un plancher minimal de λ à partir de
     * BTTS_yes : λ_min = -ln(1 - BTTS_yes).
     *
     * Le surplus est retiré du côté favori pour conserver le
     * total de buts attendu, plutôt que de l'ajouter arbitrairement.
     *
     * Ceci reste une hypothèse fondée sur 4 cas observés, pas une
     * calibration validée sur un grand échantillon — à confirmer
     * en continuant d'évaluer des matchs après ce changement.
     */
    const bttsYes = safeNumber(
        market?.btts?.yesProbability ??
        market?.btts?.probability?.yes,
        NaN
    );

    if (
        Number.isFinite(bttsYes) &&
        bttsYes > 0 &&
        bttsYes < 1
    ) {
        const impliedMinLambda =
            Math.min(-Math.log(1 - bttsYes), 2.0);

        if (
            lambdaHome <= lambdaAway &&
            lambdaHome < impliedMinLambda
        ) {
            const deficit = impliedMinLambda - lambdaHome;
            lambdaHome = impliedMinLambda;
            lambdaAway = Math.max(
                DEFAULT_CONFIG.minLambda,
                lambdaAway - deficit
            );
        } else if (
            lambdaAway < lambdaHome &&
            lambdaAway < impliedMinLambda
        ) {
            const deficit = impliedMinLambda - lambdaAway;
            lambdaAway = impliedMinLambda;
            lambdaHome = Math.max(
                DEFAULT_CONFIG.minLambda,
                lambdaHome - deficit
            );
        }
    }

    return {
        lambdaHome: safeLambda(lambdaHome),
        lambdaAway: safeLambda(lambdaAway),
        totalLambda: safeLambda(
            lambdaHome + lambdaAway,
            totalLambda
        ),
        probabilities: signal
    };
}


/* ============================================================
 * HISTORICAL MEMORY SIGNAL
 * ============================================================
 *
 * historicalEngine.js peut fournir :
 *
 * - historicalLambdaHome
 * - historicalLambdaAway
 * - similarity
 * - historicalDirection
 *
 * Nous utilisons la similarité pour contrôler l'influence.
 */

function getHistoricalSignal(historical) {
    if (!historical || typeof historical !== "object") {
        return null;
    }

    let home = safeNumber(
        historical.lambdaHome ??
        historical.historicalLambdaHome ??
        historical.avgHomeGoals ??
        historical.homeGoalsMean,
        NaN
    );

    let away = safeNumber(
        historical.lambdaAway ??
        historical.historicalLambdaAway ??
        historical.avgAwayGoals ??
        historical.awayGoalsMean,
        NaN
    );

    /*
     * historicalEngine.analyzeHistoricalMemory() ne produit pas
     * de lambdaHome/lambdaAway directement. Il expose
     * goalDistribution.home / goalDistribution.away : des
     * distributions pondérées { nombre_de_buts: probabilité }.
     * On en dérive une espérance si les champs directs
     * ci-dessus sont absents.
     */
    if (!Number.isFinite(home)) {
        home = expectedValueFromDistribution(
            historical.goalDistribution?.home
        );
    }

    if (!Number.isFinite(away)) {
        away = expectedValueFromDistribution(
            historical.goalDistribution?.away
        );
    }

    if (!Number.isFinite(home) || !Number.isFinite(away)) {
        return null;
    }

    /*
     * historicalEngine expose la fiabilité de sa mémoire sous
     * "confidence" (calculateMemoryConfidence), et la similarité
     * du meilleur match sous bestMatch.similarity. Il n'existe
     * aucun champ "similarity" à la racine.
     */
    const similarity = clamp(
        safeNumber(
            historical.similarity ??
            historical.maxSimilarity ??
            historical.memorySimilarity ??
            historical.bestMatch?.similarity ??
            historical.confidence,
            0
        ),
        0,
        1
    );

    /*
     * Transition douce vers l'historique.
     *
     * similarity faible → faible influence
     * similarity forte → forte influence
     */
    const memoryWeight = sigmoid(
        10 * (similarity - 0.55)
    );

    return {
        lambdaHome: safeLambda(home),
        lambdaAway: safeLambda(away),
        similarity,
        memoryWeight
    };
}


/**
 * Calcule l'espérance mathématique d'une distribution de buts
 * pondérée telle que produite par historicalEngine.js :
 *
 *   { "0": 0.32, "1": 0.41, "2": 0.19, ... }
 *
 * où les clés sont des nombres de buts et les valeurs des
 * probabilités déjà normalisées (somme ≈ 1).
 */
function expectedValueFromDistribution(distribution) {
    if (!distribution || typeof distribution !== "object") {
        return NaN;
    }

    let numerator = 0;
    let denominator = 0;

    for (const [goals, probability] of Object.entries(distribution)) {
        const g = Number(goals);
        const p = Number(probability);

        if (!Number.isFinite(g) || !Number.isFinite(p) || p <= 0) {
            continue;
        }

        numerator += g * p;
        denominator += p;
    }

    return denominator > 0 ? numerator / denominator : NaN;
}


/* ============================================================
 * DIRECTION SIGNAL
 * ============================================================
 */

function getDirectionSignal(direction) {
    if (!direction || typeof direction !== "object") {
        return {
            home: 0,
            away: 0
        };
    }

    /*
     * directionEngine.analyzeDirection() expose les
     * probabilités finales sous probabilities.{home,draw,away}.
     * On les lit en priorité ; les clés plates ci-dessous
     * restent une sécurité pour d'autres formes d'appel.
     */
    const homeProbability = extractProbability(
        direction.probabilities || direction,
        [
            "home",
            "homeProbability",
            "pHome",
            "homeScore",
            "homeDominance"
        ],
        null
    );

    const awayProbability = extractProbability(
        direction.probabilities || direction,
        [
            "away",
            "awayProbability",
            "pAway",
            "awayScore",
            "awayDominance"
        ],
        null
    );

    if (
        homeProbability !== null &&
        awayProbability !== null
    ) {
        return normalizePair(
            homeProbability,
            awayProbability
        );
    }

    /*
     * classification est un objet { label, confidence },
     * pas une chaîne : on lit explicitement .label.
     */
    const state = String(
        direction.state ??
        direction.direction ??
        direction.classification?.label ??
        ""
    ).toUpperCase();

    if (state.includes("AWAY")) {
        return {
            home: 0.35,
            away: 0.65
        };
    }

    if (state.includes("HOME")) {
        return {
            home: 0.65,
            away: 0.35
        };
    }

    return {
        home: 0.5,
        away: 0.5
    };
}


/* ============================================================
 * REGIME SIGNAL
 * ============================================================
 */

function getRegimeAdjustment(regime) {
    const state = String(
        regime?.regime ??
        regime?.classification ??
        regime?.state ??
        "NORMAL"
    ).toUpperCase();

    /*
     * Le régime agit surtout sur le total de buts.
     * Il ne doit pas inverser arbitrairement la direction.
     */
    switch (state) {
        case "LOW":
            return {
                totalMultiplier: 0.78,
                state
            };

        case "BLOWOUT":
            return {
                totalMultiplier: 1.30,
                state
            };

        case "NORMAL":
        default:
            return {
                totalMultiplier: 1.00,
                state: "NORMAL"
            };
    }
}


/* ============================================================
 * UPSET / SURPRISE SIGNAL
 * ============================================================
 *
 * upsetEngine.js fournit idéalement :
 *
 *     pUpset
 *     upsetProbability
 *     awayUpset
 *     homeUpset
 *
 * Le lambdaEngine ne recrée PAS l'upsetEngine.
 */

function getUpsetSignal(upset) {
    if (!upset || typeof upset !== "object") {
        return {
            pUpset: 0,
            awayBoost: 0,
            homeBoost: 0
        };
    }

    /*
     * upsetEngine.analyzeUpset() expose P_UPSET sous
     * probabilities.upset (pas upset.pUpset à la racine).
     */
    const pUpset = clamp(
        safeNumber(
            upset.pUpset ??
            upset.upsetProbability ??
            upset.surpriseProbability ??
            upset.probabilities?.upset,
            0
        ),
        0,
        1
    );

    /*
     * upsetEngine ne produit aucun champ "boost" direct. Il
     * fournit direction.directionalUpset = { probability, side }
     * (side vaut "HOME", "AWAY" ou "NONE"), qui indique quel
     * côté le conflit favorise et avec quelle intensité. On le
     * traduit ici en awayBoost/homeBoost.
     */
    const directionalUpset =
        upset.direction?.directionalUpset;

    let awayBoost = clamp(
        safeNumber(
            upset.awayBoost ??
            upset.awayAdjustment ??
            upset.awayDominanceBoost,
            NaN
        ),
        -1,
        1
    );

    let homeBoost = clamp(
        safeNumber(
            upset.homeBoost ??
            upset.homeAdjustment ??
            upset.homeDominanceBoost,
            NaN
        ),
        -1,
        1
    );

    if (!Number.isFinite(awayBoost) && !Number.isFinite(homeBoost)) {
        const magnitude = clamp(
            safeNumber(directionalUpset?.probability, 0),
            0,
            1
        );

        awayBoost = directionalUpset?.side === "AWAY" ? magnitude : 0;
        homeBoost = directionalUpset?.side === "HOME" ? magnitude : 0;
    } else {
        awayBoost = Number.isFinite(awayBoost) ? awayBoost : 0;
        homeBoost = Number.isFinite(homeBoost) ? homeBoost : 0;
    }

    return {
        pUpset,
        awayBoost,
        homeBoost
    };
}


/* ============================================================
 * DIRECTIONAL CORRECTION
 * ============================================================
 *
 * IMPORTANT :
 *
 * Nous ne voulons pas reproduire l'ancien problème :
 *
 *     "home outsider → énorme home boost"
 *
 * La correction est symétrique.
 *
 * La force du signal directionnel dépend de l'écart entre
 * les deux probabilités.
 */

function applyDirectionCorrection(
    lambdaHome,
    lambdaAway,
    direction,
    config = DEFAULT_CONFIG
) {
    const d = getDirectionSignal(direction);

    const imbalance = d.away - d.home;

    /*
     * Fonction bornée :
     *
     * tanh(x)
     *
     * permet une correction forte mais jamais infinie.
     */
    const directionMax =
        Number.isFinite(
            config.corrections?.directionMax
        )
            ? config.corrections.directionMax
            : DEFAULT_CONFIG.corrections.directionMax;

    const correction =
        Math.tanh(2.5 * imbalance) *
        directionMax;

    return {
        lambdaHome:
            lambdaHome * Math.exp(-correction),

        lambdaAway:
            lambdaAway * Math.exp(correction),

        correction
    };
}


/* ============================================================
 * HISTORICAL CORRECTION
 * ============================================================
 */

function applyHistoricalCorrection(
    lambdaHome,
    lambdaAway,
    historical,
    config = DEFAULT_CONFIG
) {
    const h = getHistoricalSignal(historical);

    if (!h) {
        return {
            lambdaHome,
            lambdaAway,
            memoryWeight: 0,
            similarity: 0
        };
    }

    const historicalMax =
        Number.isFinite(
            config.corrections?.historicalMax
        )
            ? config.corrections.historicalMax
            : DEFAULT_CONFIG.corrections.historicalMax;

    const weight =
        h.memoryWeight * historicalMax;

    /*
     * Fusion multiplicative log-space.
     *
     * log(λ_final)
     * =
     * (1-w)log(λ_market)
     * +
     * w log(λ_history)
     *
     * Cette méthode évite les sauts brutaux.
     */
    const finalHome = Math.exp(
        (1 - weight) * Math.log(
            Math.max(lambdaHome, 1e-6)
        ) +
        weight * Math.log(
            Math.max(h.lambdaHome, 1e-6)
        )
    );

    const finalAway = Math.exp(
        (1 - weight) * Math.log(
            Math.max(lambdaAway, 1e-6)
        ) +
        weight * Math.log(
            Math.max(h.lambdaAway, 1e-6)
        )
    );

    return {
        lambdaHome: finalHome,
        lambdaAway: finalAway,
        memoryWeight: weight,
        similarity: h.similarity
    };
}


/* ============================================================
 * REGIME CORRECTION
 * ============================================================
 */

function applyRegimeCorrection(
    lambdaHome,
    lambdaAway,
    regime,
    config = DEFAULT_CONFIG
) {
    const r = getRegimeAdjustment(regime);

    const regimeMax =
        Number.isFinite(
            config.corrections?.regimeMax
        )
            ? config.corrections.regimeMax
            : DEFAULT_CONFIG.corrections.regimeMax;

    const multiplier =
        clamp(
            r.totalMultiplier,
            1 - regimeMax,
            1 + regimeMax
        );

    /*
     * On conserve la proportion Home/Away.
     * Le régime agit sur l'intensité totale.
     */
    return {
        lambdaHome: lambdaHome * multiplier,
        lambdaAway: lambdaAway * multiplier,
        multiplier,
        regime: r.state
    };
}


/* ============================================================
 * UPSET CORRECTION
 * ============================================================
 */

function applyUpsetCorrection(
    lambdaHome,
    lambdaAway,
    upset,
    config = DEFAULT_CONFIG
) {
    const u = getUpsetSignal(upset);

    /*
     * P_Upset ne signifie PAS automatiquement :
     *
     *     "Home wins"
     *
     * ou :
     *
     *     "Away wins"
     *
     * Il contrôle seulement la force d'une correction
     * lorsque upsetEngine a déjà identifié la direction.
     */

    const p = u.pUpset;

    const upsetMax =
        Number.isFinite(
            config.corrections?.upsetMax
        )
            ? config.corrections.upsetMax
            : DEFAULT_CONFIG.corrections.upsetMax;

    const awayFactor =
        Math.exp(
            clamp(
                p * u.awayBoost,
                -upsetMax,
                upsetMax
            )
        );

    const homeFactor =
        Math.exp(
            clamp(
                p * u.homeBoost,
                -upsetMax,
                upsetMax
            )
        );

    return {
        lambdaHome: lambdaHome * homeFactor,
        lambdaAway: lambdaAway * awayFactor,
        pUpset: p,
        homeFactor,
        awayFactor
    };
}


/* ============================================================
 * GLOBAL SAFETY
 * ============================================================
 */

function stabilizeLambdas(
    lambdaHome,
    lambdaAway,
    config = DEFAULT_CONFIG
) {
    const minLambda =
        Number.isFinite(config.minLambda)
            ? config.minLambda
            : DEFAULT_CONFIG.minLambda;

    const maxLambda =
        Number.isFinite(config.maxLambda)
            ? config.maxLambda
            : DEFAULT_CONFIG.maxLambda;

    let home = clamp(
        safeNumber(lambdaHome, 1.0),
        minLambda,
        maxLambda
    );

    let away = clamp(
        safeNumber(lambdaAway, 1.0),
        minLambda,
        maxLambda
    );

    return {
        home,
        away
    };
}


/* ============================================================
 * MAIN ENGINE
 * ============================================================
 */

export function calculateLambdas(input = {}, customConfig = {}) {
    const config = {
        ...DEFAULT_CONFIG,
        ...customConfig,
        weights: {
            ...DEFAULT_CONFIG.weights,
            ...(customConfig.weights || {})
        },
        corrections: {
            ...DEFAULT_CONFIG.corrections,
            ...(customConfig.corrections || {})
        }
    };

    /*
     * Les données arrivent des moteurs précédents.
     */
    const market =
        input.market ??
        input.marketAnalysis ??
        {};

    const features =
        input.features ??
        input.featureVector ??
        {};

    const historical =
        input.historical ??
        input.memory ??
        input.historicalAnalysis ??
        {};

    const direction =
        input.direction ??
        input.directionAnalysis ??
        {};

    const regime =
        input.regime ??
        input.regimeAnalysis ??
        {};

    const upset =
        input.upset ??
        input.upsetAnalysis ??
        {};

 /*
     * --------------------------------------------------------
     * 1. MARKET BASELINE
     * --------------------------------------------------------
     */

    const marketBase =
        estimateMarketLambdas(
            market,
            features
        );

    let lambdaHome =
        marketBase.lambdaHome;

    let lambdaAway =
        marketBase.lambdaAway;


    /*
     * --------------------------------------------------------
     * 2. HISTORICAL MEMORY
     * --------------------------------------------------------
     */

    const historicalResult =
    applyHistoricalCorrection(
        lambdaHome,
        lambdaAway,
        historical,
        config
    );

    lambdaHome =
        historicalResult.lambdaHome;

    lambdaAway =
        historicalResult.lambdaAway;


    /*
     * --------------------------------------------------------
     * 3. DIRECTION
     * --------------------------------------------------------
     */

    const directionResult =
        applyDirectionCorrection(
            lambdaHome,
            lambdaAway,
            direction
        );

    lambdaHome =
        directionResult.lambdaHome;

    lambdaAway =
        directionResult.lambdaAway;


    /*
     * --------------------------------------------------------
     * 4. REGIME
     * --------------------------------------------------------
     */

    const regimeResult =
    applyRegimeCorrection(
        lambdaHome,
        lambdaAway,
        regime,
        config
    );

    lambdaHome =
        regimeResult.lambdaHome;

    lambdaAway =
        regimeResult.lambdaAway;


    /*
     * --------------------------------------------------------
     * 5. UPSET
     * --------------------------------------------------------
     */

    const upsetResult =
    applyUpsetCorrection(
        lambdaHome,
        lambdaAway,
        upset,
        config
    );

    lambdaHome =
        upsetResult.lambdaHome;

    lambdaAway =
        upsetResult.lambdaAway;


    /*
     * --------------------------------------------------------
     * 6. FINAL STABILIZATION
     * --------------------------------------------------------
     */

    const stabilized =
    stabilizeLambdas(
        lambdaHome,
        lambdaAway,
        config
    );

    lambdaHome = stabilized.home;
    lambdaAway = stabilized.away;


    /*
     * --------------------------------------------------------
     * 7. FINAL METRICS
     * --------------------------------------------------------
     */

    const totalLambda =
        lambdaHome + lambdaAway;

    const homeShare =
        lambdaHome / totalLambda;

    const awayShare =
        lambdaAway / totalLambda;

    let directionLabel = "DRAW";

    if (homeShare > awayShare + 0.08) {
        directionLabel = "HOME";
    } else if (awayShare > homeShare + 0.08) {
        directionLabel = "AWAY";
    }


    /*
     * --------------------------------------------------------
     * 8. CONFIDENCE
     * --------------------------------------------------------
     *
     * Ce n'est PAS encore la confiance Top-3.
     * C'est uniquement la stabilité de l'estimation λ.
     */

    const directionalConfidence =
        Math.abs(homeShare - awayShare);

    const memoryConfidence =
        clamp(
            safeNumber(
                historicalResult.similarity,
                0
            ),
            0,
            1
        );

    const confidence =
        clamp(
            0.60 * directionalConfidence +
            0.40 * memoryConfidence,
            0,
            1
        );


    /*
     * --------------------------------------------------------
     * 9. OUTPUT
     * --------------------------------------------------------
     */

    return {
        lambdaHome,
        lambdaAway,
        totalLambda,

        direction: directionLabel,

        confidence,

        regime: regimeResult.regime,

        components: {
            market: {
                lambdaHome: marketBase.lambdaHome,
                lambdaAway: marketBase.lambdaAway,
                totalLambda: marketBase.totalLambda,
                probabilities:
                    marketBase.probabilities
            },

            historical: {
                lambdaHome:
                    historical?.lambdaHome ??
                    historical?.historicalLambdaHome ??
                    null,

                lambdaAway:
                    historical?.lambdaAway ??
                    historical?.historicalLambdaAway ??
                    null,

                similarity:
                    historicalResult.similarity,

                memoryWeight:
                    historicalResult.memoryWeight
            },

            direction: {
                correction:
                    directionResult.correction
            },

            regime: {
                regime:
                    regimeResult.regime,

                multiplier:
                    regimeResult.multiplier
            },

            upset: {
                pUpset:
                    upsetResult.pUpset,

                homeFactor:
                    upsetResult.homeFactor,

                awayFactor:
                    upsetResult.awayFactor
            }
        },

        metadata: {
            engine: "lambdaEngine",
            version: "1.0.0",
            generatedAt:
                new Date().toISOString()
        }
    };
}



/* ============================================================
 * CONVENIENCE EXPORT
 * ============================================================
 *
 * Permet à predictionEngine.js ou app.js d'appeler :
 *
 *     import { lambdaEngine } from "./core/lambdaEngine.js";
 *
 *     const result = lambdaEngine(input);
 *
 * ============================================================
 */

export function lambdaEngine(input = {}, config = {}) {
    return calculateLambdas(input, config);
}


/* ============================================================
 * VALIDATION
 * ============================================================
 */

export function validateLambdaResult(result) {
    if (!result || typeof result !== "object") {
        return false;
    }

    if (!Number.isFinite(result.lambdaHome)) {
        return false;
    }

    if (!Number.isFinite(result.lambdaAway)) {
        return false;
    }

    if (
        result.lambdaHome < DEFAULT_CONFIG.minLambda ||
        result.lambdaAway < DEFAULT_CONFIG.minLambda
    ) {
        return false;
    }

    if (
        result.lambdaHome > DEFAULT_CONFIG.maxLambda ||
        result.lambdaAway > DEFAULT_CONFIG.maxLambda
    ) {
        return false;
    }

    if (!Number.isFinite(result.totalLambda)) {
        return false;
    }

    return true;
}


