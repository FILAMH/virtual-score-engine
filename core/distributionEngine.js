/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * ============================================================
 * File: core/distributionEngine.js
 *
 * ROLE
 * ----
 * Transformer les λ produits par lambdaEngine.js en une
 * distribution complète des scores exacts.
 *
 * Ce fichier NE :
 *   - parse pas les matchs ;
 *   - ne lit pas directement les cotes ;
 *   - ne recherche pas l'historique ;
 *   - ne calcule pas la direction ;
 *   - ne calcule pas P_Upset ;
 *   - ne sélectionne pas définitivement les Top 3.
 *
 * Il prépare la matrice :
 *
 *             Away goals
 *
 *             0      1      2      3 ...
 * Home  0    P00    P01    P02    P03
 * goals 1    P10    P11    P12    P13
 *       2    P20    P21    P22    P23
 *       ...
 *
 * Cette matrice sera ensuite consommée par :
 *
 * distributionEngine
 *        ↓
 * scoreFusion.js
 *        ↓
 * predictionEngine.js
 *
 * ============================================================
 */

const DEFAULT_CONFIG = Object.freeze({

    /*
     * Limite maximale des buts examinés pour chaque équipe.
     *
     * 8 permet de conserver la queue de distribution tout en
     * gardant le calcul très léger sur mobile.
     */
    maxGoals: 8,

    /*
     * Probabilité minimale utilisée pour éviter des valeurs
     * numériques nulles causées par les limites flottantes.
     */
    epsilon: 1e-15,

    /*
     * Méthode principale.
     *
     * "poisson" sera la base actuelle.
     * Les modèles Negative Binomial / Dixon-Coles seront
     * intégrés ensuite dans leur propre couche modèle.
     */
    model: "poisson",

    /*
     * Active la renormalisation finale de la matrice.
     */
    normalize: true
});


/* ============================================================
 * UTILITAIRES
 * ============================================================
 */

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function clamp(value, min, max) {
    return Math.min(
        max,
        Math.max(min, safeNumber(value, min))
    );
}


/* ============================================================
 * FACTORIELLE
 * ============================================================
 *
 * Pour les petites valeurs de buts, cette méthode est suffisante.
 *
 * Nous utilisons une version itérative afin d'éviter une
 * récursion inutile.
 */

function factorial(n) {

    const k = Math.floor(
        safeNumber(n, 0)
    );

    if (k <= 1) {
        return 1;
    }

    let result = 1;

    for (let i = 2; i <= k; i++) {
        result *= i;
    }

    return result;
}


/* ============================================================
 * POISSON PMF
 * ============================================================
 *
 * P(X = k) =
 *
 *       e^(-λ) λ^k
 *       -----------
 *           k!
 *
 * ============================================================
 */

export function poissonProbability(
    lambda,
    goals
) {

    const λ = Math.max(
        0,
        safeNumber(lambda, 0)
    );

    const k = Math.max(
        0,
        Math.floor(
            safeNumber(goals, 0)
        )
    );

    if (λ === 0) {
        return k === 0 ? 1 : 0;
    }

    const probability =
        Math.exp(-λ) *
        Math.pow(λ, k) /
        factorial(k);

    return Number.isFinite(probability)
        ? probability
        : 0;
}


/* ============================================================
 * POISSON DISTRIBUTION
 * ============================================================
 */

export function buildPoissonDistribution(
    lambda,
    maxGoals = DEFAULT_CONFIG.maxGoals
) {

    const maximum = Math.max(
        0,
        Math.floor(
            safeNumber(
                maxGoals,
                DEFAULT_CONFIG.maxGoals
            )
        )
    );

    const probabilities = [];

    for (
        let goals = 0;
        goals <= maximum;
        goals++
    ) {

        probabilities.push(
            poissonProbability(
                lambda,
                goals
            )
        );
    }

    return normalizeVector(
        probabilities
    );
}


/* ============================================================
 * VECTOR NORMALIZATION
 * ============================================================
 */

function normalizeVector(vector) {

    const total = vector.reduce(
        (sum, value) =>
            sum + Math.max(0, safeNumber(value)),
        0
    );

    if (total <= 0) {

        const uniform =
            1 / Math.max(vector.length, 1);

        return vector.map(
            () => uniform
        );
    }

    return vector.map(
        value =>
            Math.max(
                0,
                safeNumber(value)
            ) / total
    );
}


/* ============================================================
 * SCORE MATRIX
 * ============================================================
 *
 * P(H=h,A=a)
 *
 * = P(H=h) × P(A=a)
 *
 * Cette indépendance est le point de départ.
 *
 * Les corrections Dixon-Coles / ensemble seront appliquées
 * plus tard par les modèles correspondants et/ou scoreFusion.
 */

export function buildScoreMatrix(
    lambdaHome,
    lambdaAway,
    config = {}
) {

    const maxGoals = Math.max(
        0,
        Math.floor(
            safeNumber(
                config.maxGoals,
                DEFAULT_CONFIG.maxGoals
            )
        )
    );

    const homeDistribution =
        buildPoissonDistribution(
            lambdaHome,
            maxGoals
        );

    const awayDistribution =
        buildPoissonDistribution(
            lambdaAway,
            maxGoals
        );

    const matrix = [];

    for (
        let homeGoals = 0;
        homeGoals <= maxGoals;
        homeGoals++
    ) {

        const row = [];

        for (
            let awayGoals = 0;
            awayGoals <= maxGoals;
            awayGoals++
        ) {

            const probability =
                homeDistribution[homeGoals] *
                awayDistribution[awayGoals];

            row.push({
                homeGoals,
                awayGoals,
                score:
                    `${homeGoals}-${awayGoals}`,
                probability
            });
        }

        matrix.push(row);
    }

    return matrix;
}


/* ============================================================
 * FLATTEN SCORE MATRIX
 * ============================================================
 *
 * La matrice est transformée en tableau afin que les étapes
 * suivantes puissent facilement trier les scores.
 */

export function flattenScoreMatrix(matrix) {

    const scores = [];

    for (const row of matrix) {

        for (const item of row) {

            scores.push({
                homeGoals: item.homeGoals,
                awayGoals: item.awayGoals,
                score: item.score,
                probability: item.probability
            });
        }
    }

    return scores;
}


/* ============================================================
 * MATRIX NORMALIZATION
 * ============================================================
 *
 * Comme la distribution est tronquée à maxGoals, une petite
 * quantité de probabilité peut se trouver au-delà de la limite.
 *
 * Nous renormalisons donc la matrice calculée.
 */

export function normalizeScoreDistribution(
    scores
) {

    const total = scores.reduce(
        (sum, item) =>
            sum + Math.max(
                0,
                safeNumber(
                    item.probability
                )
            ),
        0
    );

    if (total <= 0) {

        const uniform =
            1 / Math.max(scores.length, 1);

        return scores.map(
            item => ({
                ...item,
                probability: uniform
            })
        );
    }

    return scores.map(
        item => ({
            ...item,
            probability:
                Math.max(
                    0,
                    safeNumber(
                        item.probability
                    )
                ) / total
        })
    );
}


/* ============================================================
 * TOTAL GOALS DISTRIBUTION
 * ============================================================
 *
 * Cette fonction est importante car les marchés "Nombre exact"
 * et "Total" décrivent directement la distribution du nombre
 * total de buts.
 *
 * T = H + A
 *
 * Pour deux Poisson indépendants :
 *
 * T ~ Poisson(λ_home + λ_away)
 *
 * ============================================================
 */

export function buildTotalGoalsDistribution(
    lambdaHome,
    lambdaAway,
    maxGoals = DEFAULT_CONFIG.maxGoals * 2
) {

    const totalLambda =
        Math.max(
            0,
            safeNumber(lambdaHome) +
            safeNumber(lambdaAway)
        );

    const distribution = [];

    for (
        let totalGoals = 0;
        totalGoals <= maxGoals;
        totalGoals++
    ) {

        distribution.push({
            totalGoals,
            probability:
                poissonProbability(
                    totalLambda,
                    totalGoals
                )
        });
    }

    return normalizeTotalDistribution(
        distribution
    );
}


function normalizeTotalDistribution(
    distribution
) {

    const total =
        distribution.reduce(
            (sum, item) =>
                sum + item.probability,
            0
        );

    if (total <= 0) {
        return distribution;
    }

    return distribution.map(
        item => ({
            ...item,
            probability:
                item.probability / total
        })
    );
}


/* ============================================================
 * DIRECTION DISTRIBUTION
 * ============================================================
 *
 * On calcule :
 *
 * P(Home Win)
 * P(Draw)
 * P(Away Win)
 *
 * directement depuis la matrice des scores.
 */

export function calculateDirectionProbabilities(
    scores
) {

    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;

    for (const item of scores) {

        if (
            item.homeGoals >
            item.awayGoals
        ) {

            homeWin += item.probability;

        } else if (
            item.homeGoals ===
            item.awayGoals
        ) {

            draw += item.probability;

        } else {

            awayWin += item.probability;
        }
    }

    const total =
        homeWin +
        draw +
        awayWin;

    if (total <= 0) {

        return {
            homeWin: 1 / 3,
            draw: 1 / 3,
            awayWin: 1 / 3
        };
    }

    return {
        homeWin: homeWin / total,
        draw: draw / total,
        awayWin: awayWin / total
    };
}


/* ============================================================
 * BOTH TEAMS TO SCORE
 * ============================================================
 */

export function calculateBTTS(
    scores
) {

    let yes = 0;
    let no = 0;

    for (const item of scores) {

        if (
            item.homeGoals >= 1 &&
            item.awayGoals >= 1
        ) {

            yes += item.probability;

        } else {

            no += item.probability;
        }
    }

    const total = yes + no;

    if (total <= 0) {
        return {
            yes: 0.5,
            no: 0.5
        };
    }

    return {
        yes: yes / total,
        no: no / total
    };
}


/* ============================================================
 * OVER / UNDER
 * ============================================================
 */

export function calculateOverUnder(
    scores,
    line
) {

    const threshold =
        safeNumber(line, 2.5);

    let over = 0;
    let under = 0;

    for (const item of scores) {

        const totalGoals =
            item.homeGoals +
            item.awayGoals;

        if (totalGoals > threshold) {
            over += item.probability;
        } else {
            under += item.probability;
        }
    }

    const total = over + under;

    if (total <= 0) {
        return {
            over: 0.5,
            under: 0.5
        };
    }

    return {
        over: over / total,
        under: under / total
    };
}


/* ============================================================
 * TOP CANDIDATES
 * ============================================================
 *
 * ATTENTION :
 * Cette fonction ne constitue PAS encore le Top 3 officiel.
 *
 * Elle expose seulement les scores les plus probables de la
 * distribution brute.
 *
 * Le Top 3 final appartient à predictionEngine.js après
 * scoreFusion.js.
 */

export function getRawCandidates(
    scores,
    count = 10
) {

    const limit = Math.max(
        1,
        Math.floor(
            safeNumber(count, 10)
        )
    );

    return [...scores]
        .sort(
            (a, b) =>
                b.probability -
                a.probability
        )
        .slice(0, limit)
        .map(
            (item, index) => ({
                rank: index + 1,
                score: item.score,
                homeGoals: item.homeGoals,
                awayGoals: item.awayGoals,
                probability: item.probability
            })
        );
}


/* ============================================================
 * MAIN DISTRIBUTION ENGINE
 * ============================================================
 */

export function calculateDistribution(
    input = {},
    customConfig = {}
) {

    const config = {
        ...DEFAULT_CONFIG,
        ...customConfig
    };

    /*
     * Le lambdaEngine précédent est la source officielle
     * des intensités.
     */
    const lambdaHome =
        safeNumber(
            input.lambdaHome ??
            input.lambda?.home ??
            input.lambdas?.home,
            NaN
        );

    const lambdaAway =
        safeNumber(
            input.lambdaAway ??
            input.lambda?.away ??
            input.lambdas?.away,
            NaN
        );

    /*
     * Impossible de construire une distribution correcte
     * sans λ valides.
     */
    if (
        !Number.isFinite(lambdaHome) ||
        !Number.isFinite(lambdaAway) ||
        lambdaHome < 0 ||
        lambdaAway < 0
    ) {

        throw new Error(
            "distributionEngine: lambdaHome et lambdaAway sont requis."
        );
    }


    /* --------------------------------------------------------
     * 1. DISTRIBUTIONS INDIVIDUELLES
     * --------------------------------------------------------
     */

    const homeDistribution =
        buildPoissonDistribution(
            lambdaHome,
            config.maxGoals
        );

    const awayDistribution =
        buildPoissonDistribution(
            lambdaAway,
            config.maxGoals
        );


    /* --------------------------------------------------------
     * 2. MATRICE DES SCORES
     * --------------------------------------------------------
     */

    let scoreMatrix =
        buildScoreMatrix(
            lambdaHome,
            lambdaAway,
            config
        );


    /* --------------------------------------------------------
     * 3. TABLEAU PLAT
     * --------------------------------------------------------
     */

    let scores =
        flattenScoreMatrix(
            scoreMatrix
        );


    /* --------------------------------------------------------
     * 4. NORMALISATION
     * --------------------------------------------------------
     */

    if (config.normalize) {

        scores =
            normalizeScoreDistribution(
                scores
            );
    }


    /* --------------------------------------------------------
     * 5. MÉTRIQUES
     * --------------------------------------------------------
     */

    const direction =
        calculateDirectionProbabilities(
            scores
        );

    const btts =
        calculateBTTS(
            scores
        );

    const overUnder25 =
        calculateOverUnder(
            scores,
            2.5
        );

    const overUnder35 =
        calculateOverUnder(
            scores,
            3.5
        );

    const totalGoals =
        buildTotalGoalsDistribution(
            lambdaHome,
            lambdaAway
        );


    /* --------------------------------------------------------
     * 6. CANDIDATS BRUTS
     * --------------------------------------------------------
     */

    const candidates =
        getRawCandidates(
            scores,
            10
        );


    /* --------------------------------------------------------
     * 7. SORTIE
     * --------------------------------------------------------
     */

    return {

    model: config.model,

    lambda: {
        home: lambdaHome,
        away: lambdaAway,
        total:
            lambdaHome +
            lambdaAway
    },

    distributions: {

        home:
            homeDistribution,

        away:
            awayDistribution,

        totalGoals,

        /*
         * Tableau détaillé utilisé pour les métriques,
         * diagnostics et affichage.
         */
        scores,

        /*
         * Distribution sous forme :
         *
         * {
         *     "0-0": 0.12,
         *     "1-0": 0.15,
         *     "1-1": 0.10,
         *     ...
         * }
         *
         * Cette structure est directement compatible
         * avec scoreFusion.js et predictionEngine.js.
         */
        scoreDistribution:
            Object.fromEntries(
                scores.map(item => [
                    item.score,
                    item.probability
                ])
            )
    },

    matrix: scoreMatrix,

    direction,

    btts,

    totals: {
        overUnder25,
        overUnder35
    },

    rawCandidates: candidates,

    metadata: {
        maxGoals:
            config.maxGoals,

        scoreCount:
            scores.length,

        generatedAt:
            new Date().toISOString(),

        engine:
            "distributionEngine",

        version:
            "1.0.0"
    }
};
}


/* ============================================================
 * CONVENIENCE EXPORT
 * ============================================================
 */

export function distributionEngine(
    input = {},
    config = {}
) {

    return calculateDistribution(
        input,
        config
    );
}


/* ============================================================
 * VALIDATION
 * ============================================================
 */

export function validateDistribution(
    result
) {

    if (
        !result ||
        typeof result !== "object"
    ) {
        return false;
    }

    if (
        !result.lambda ||
        !Number.isFinite(
            result.lambda.home
        ) ||
        !Number.isFinite(
            result.lambda.away
        )
    ) {
        return false;
    }

    if (
        !Array.isArray(
            result.distributions?.scores
        )
    ) {
        return false;
    }

    if (
        result.distributions.scores.length === 0
    ) {
        return false;
    }

    const totalProbability =
        result.distributions.scores.reduce(
            (sum, item) =>
                sum +
                safeNumber(
                    item.probability
                ),
            0
        );

    /*
     * Une distribution valide doit être proche de 1.
     */
    if (
        Math.abs(
            totalProbability - 1
        ) > 1e-8
    ) {
        return false;
    }

    return true;
}