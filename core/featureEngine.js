/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * core/featureEngine.js
 * ============================================================
 *
 * RÔLE
 * ------------------------------------------------------------
 * Construire les variables/features mathématiques à partir
 * des données normalisées par normalizer.js.
 *
 * IMPORTANT :
 * Ce fichier ne produit PAS les Top 3.
 * Il ne choisit PAS le vainqueur.
 * Il ne modifie PAS les lambdas finales.
 *
 * Il prépare uniquement une représentation mathématique
 * cohérente du nouvel événement et de son historique.
 *
 * PRINCIPES :
 * - aucune donnée absente n'est inventée ;
 * - les probabilités brutes restent distinctes des
 *   probabilités normalisées ;
 * - les signaux HOME/AWAY sont conservés séparément ;
 * - les marchés contradictoires sont conservés ;
 * - les features sont déterministes ;
 * - les moteurs suivants pourront recalibrer leurs poids.
 * ============================================================
 */


// ============================================================
// CONSTANTES
// ============================================================

const EPSILON = 1e-12;

const MARKET_KEYS = Object.freeze({

    HOME: [
        "1",
        "home",
        "v1"
    ],

    DRAW: [
        "x",
        "draw"
    ],

    AWAY: [
        "2",
        "away",
        "v2"
    ]
});


// ============================================================
// API PRINCIPALE
// ============================================================

export function buildFeatures(
    match,
    historicalMatches = []
) {

    if (
        !match ||
        typeof match !== "object"
    ) {
        throw new Error(
            "featureEngine: match invalide."
        );
    }


    const markets =
        match.markets || {};


    const oneXTwo =
        extract1X2(markets);


    const handicap =
        extractHandicap(
            markets.handicap
        );


    const btts =
        extractBTTS(
            markets.btts
        );


    const totals =
        extractTotals(
            markets.matchTotals
        );


    const team1Goals =
        extractTeamGoalMarkets(
            markets.team1Totals
        );


    const team2Goals =
        extractTeamGoalMarkets(
            markets.team2Totals
        );


    const scoringSignals =
        extractScoringSignals(
            markets
        );


    const mtFin =
        extractMTFin(
            markets.halfTimeFullTime
        );


    const exactScores =
        extractExactScores(
            markets.exactScore
        );


    const exactGoals =
        extractExactGoals(
            markets.exactTotalGoals
        );


    const firstGoal =
        extractFirstGoal(
            markets.firstGoalTime
        );


    const direction =
        buildDirectionFeatures({
            oneXTwo,
            handicap,
            team1Goals,
            team2Goals,
            scoringSignals,
            mtFin
        });


    const goalEnvironment =
        buildGoalEnvironment({
            btts,
            totals,
            team1Goals,
            team2Goals,
            scoringSignals,
            exactGoals
        });


    const marketConflict =
        buildMarketConflict({
            oneXTwo,
            handicap,
            btts,
            totals,
            team1Goals,
            team2Goals,
            mtFin
        });


    const strength =
        buildStrengthFeatures({
            oneXTwo,
            handicap,
            direction
        });


    const signature =
        buildSignature({
            oneXTwo,
            handicap,
            btts,
            totals,
            team1Goals,
            team2Goals,
            mtFin,
            scoringSignals,
            firstGoal,
            exactGoals,
            direction,
            goalEnvironment,
            marketConflict
        });


    return {

    version: "1.1.0",

    matchId:
        match.id || null,

    teams:
        match.teams || null,

    temporal:
        match.temporal || null,

    dataQuality:
        match.dataQuality || null,

    oneXTwo,

    handicap,

    btts,

    totals,

    team1Goals,

    team2Goals,

    scoringSignals,

    mtFin,

    exactScores,

    exactGoals,

    firstGoal,

    direction,

    strength,

    goalEnvironment,

    marketConflict,

    signature,

   // VECTEUR OFFICIEL UTILISÉ PAR historicalEngine.js
vector:
    signature.map(
        value =>
            Number.isFinite(value)
                ? clamp01(value)
                : 0
    ),

historicalContext:
    buildHistoricalContext(
        historicalMatches
    )
};
}


// ============================================================
// 1X2
// ============================================================

function extract1X2(markets) {

    const group =
        markets.oneXTwo || {};


    const home =
        findMarketValue(
            group,
            MARKET_KEYS.HOME
        );


    const draw =
        findMarketValue(
            group,
            MARKET_KEYS.DRAW
        );


    const away =
        findMarketValue(
            group,
            MARKET_KEYS.AWAY
        );


    const raw =
        collectProbabilities(
            home,
            draw,
            away
        );


    return {

        home,
        draw,
        away,

        rawProbabilities:
            raw,

        marketStrength:
            calculateMarketStrength(
                raw
            ),

        favorite:
            determineFavorite(
                raw
            ),

        favoriteMargin:
            calculateFavoriteMargin(
                raw
            )
    };
}


// ============================================================
// HANDICAP
// ============================================================

function extractHandicap(group) {

    if (!group) {
        return {
            available: false,
            lines: []
        };
    }


    const lines = [];


    for (
        const [key, value]
        of Object.entries(group)
    ) {

        if (
            !value ||
            !Number.isFinite(value.odd)
        ) {
            continue;
        }


        const handicapValue =
            parseHandicapLine(key);


        lines.push({

            key,

            handicap:
                handicapValue,

            odd:
                value.odd,

            probability:
                value.impliedProbability
        });
    }


    lines.sort(
        (a, b) =>
            a.handicap - b.handicap
    );


    const zero =
        lines.find(
            item =>
                item.handicap === 0
        );


    return {

        available:
            lines.length > 0,

        lines,

        zeroLine:
            zero || null,

        curvature:
            calculateHandicapCurvature(
                lines
            ),

        asymmetry:
            calculateHandicapAsymmetry(
                lines
            )
    };
}


// ============================================================
// BTTS
// ============================================================

function extractBTTS(group) {

    if (!group) {

        return {
            available: false,
            yes: null,
            no: null,
            yesProbability: null,
            noProbability: null,
            normalizedYes: null,
            normalizedNo: null
        };
    }


    const yes =
        findMarketValue(
            group,
            [
                "yes",
                "oui"
            ]
        );


    const no =
        findMarketValue(
            group,
            [
                "no",
                "non"
            ]
        );


    const probabilities =
        normalizePair(
            yes,
            no
        );


    return {

        available:
            Boolean(
                yes || no
            ),

        yes,

        no,

        yesProbability:
            yes?.impliedProbability ??
            null,

        noProbability:
            no?.impliedProbability ??
            null,

        normalizedYes:
            probabilities.first,

        normalizedNo:
            probabilities.second
    };
}


// ============================================================
// TOTALS
// ============================================================

function extractTotals(group) {

    if (!group) {

        return {
            available: false,
            lines: [],
            over25: null,
            under25: null,
            over35: null,
            under35: null,
            over15: null,
            under15: null
        };
    }


    const lines = [];


    for (
        const [key, value]
        of Object.entries(group)
    ) {

        if (
            !value ||
            !Number.isFinite(value.odd)
        ) {
            continue;
        }


        const parsed =
            parseTotalLine(key);


        if (!parsed) {
            continue;
        }


        lines.push({

            key,

            line:
                parsed.line,

            side:
                parsed.side,

            odd:
                value.odd,

            probability:
                value.impliedProbability
        });
    }


    return {

        available:
            lines.length > 0,

        lines,

        over15:
            findTotalLine(
                lines,
                1.5,
                "over"
            ),

        under15:
            findTotalLine(
                lines,
                1.5,
                "under"
            ),

        over25:
            findTotalLine(
                lines,
                2.5,
                "over"
            ),

        under25:
            findTotalLine(
                lines,
                2.5,
                "under"
            ),

        over35:
            findTotalLine(
                lines,
                3.5,
                "over"
            ),

        under35:
            findTotalLine(
                lines,
                3.5,
                "under"
            )
    };
}


// ============================================================
// TOTALS ÉQUIPE
// ============================================================

function extractTeamGoalMarkets(group) {

    if (!group) {

        return {
            available: false,
            lines: []
        };
    }


    const lines = [];


    for (
        const [key, value]
        of Object.entries(group)
    ) {

        if (
            !value ||
            !Number.isFinite(value.odd)
        ) {
            continue;
        }


        const parsed =
            parseTotalLine(key);


        if (!parsed) {
            continue;
        }


        lines.push({

            key,

            line:
                parsed.line,

            side:
                parsed.side,

            odd:
                value.odd,

            probability:
                value.impliedProbability
        });
    }


    return {

        available:
            lines.length > 0,

        lines,

        over05:
            findTotalLine(
                lines,
                0.5,
                "over"
            ),

        under05:
            findTotalLine(
                lines,
                0.5,
                "under"
            ),

        over15:
            findTotalLine(
                lines,
                1.5,
                "over"
            ),

        under15:
            findTotalLine(
                lines,
                1.5,
                "under"
            ),

        over25:
            findTotalLine(
                lines,
                2.5,
                "over"
            ),

        under25:
            findTotalLine(
                lines,
                2.5,
                "under"
            )
    };
}


// ============================================================
// SIGNAUX DE BUT
// ============================================================

function extractScoringSignals(markets) {

    const team1 =
        markets.team1ToScore || {};

    const team2 =
        markets.team2ToScore || {};

    const nextGoal =
        markets.nextGoal || {};


    const team1Yes =
        findMarketValue(
            team1,
            [
                "yes",
                "oui"
            ]
        );


    const team1No =
        findMarketValue(
            team1,
            [
                "no",
                "non"
            ]
        );


    const team2Yes =
        findMarketValue(
            team2,
            [
                "yes",
                "oui"
            ]
        );


    const team2No =
        findMarketValue(
            team2,
            [
                "no",
                "non"
            ]
        );


    const nextTeam1 =
        findMarketValue(
            nextGoal,
            [
                "team1",
                "1",
                "home"
            ]
        );


    const nextTeam2 =
        findMarketValue(
            nextGoal,
            [
                "team2",
                "2",
                "away"
            ]
        );


    return {

        team1: {

            yes:
                team1Yes,

            no:
                team1No,

            scoreProbability:
                team1Yes?.impliedProbability ??
                null
        },

        team2: {

            yes:
                team2Yes,

            no:
                team2No,

            scoreProbability:
                team2Yes?.impliedProbability ??
                null
        },

        nextGoal: {

            team1:
                nextTeam1,

            team2:
                nextTeam2
        }
    };
}


// ============================================================
// MT-FIN
// ============================================================

function extractMTFin(group) {

    if (!group) {

        return {
            available: false,
            outcomes: {},
            residuals: {}
        };
    }


    const outcomes = {};


    for (
        const [key, value]
        of Object.entries(group)
    ) {

        if (
            !value ||
            !Number.isFinite(value.odd)
        ) {
            continue;
        }


        outcomes[key] = {

            odd:
                value.odd,

            probability:
                value.impliedProbability
        };
    }


    const normalized =
        normalizeObjectProbabilities(
            outcomes
        );


    return {

        available:
            Object.keys(
                outcomes
            ).length > 0,

        outcomes,

        normalized,

        residuals:
            calculateMTFinResiduals(
                normalized
            )
    };
}


// ============================================================
// SCORE EXACT
// ============================================================

function extractExactScores(group) {

    if (!group) {

        return {
            available: false,
            scores: []
        };
    }


    const scores = [];


    for (
        const [key, value]
        of Object.entries(group)
    ) {

        if (
            !value ||
            !Number.isFinite(value.odd)
        ) {
            continue;
        }


        const score =
            parseScoreKey(key);


        if (!score) {
            continue;
        }


        scores.push({

            homeGoals:
                score.home,

            awayGoals:
                score.away,

            score:
                `${score.home}-${score.away}`,

            odd:
                value.odd,

            probability:
                value.impliedProbability
        });
    }


    scores.sort(
        (a, b) =>
            a.odd - b.odd
    );


    return {

        available:
            scores.length > 0,

        scores,

        mostLikely:
            scores[0] || null
    };
}


// ============================================================
// NOMBRE EXACT
// ============================================================

function extractExactGoals(group) {

    if (!group) {

        return {
            available: false,
            values: []
        };
    }


    const values = [];


    for (
        const [key, value]
        of Object.entries(group)
    ) {

        if (
            !value ||
            !Number.isFinite(value.odd)
        ) {
            continue;
        }


        const goals =
            parseGoalNumber(key);


        if (goals === null) {
            continue;
        }


        values.push({

            goals,

            odd:
                value.odd,

            probability:
                value.impliedProbability
        });
    }


    values.sort(
        (a, b) =>
            a.goals - b.goals
    );


    return {

        available:
            values.length > 0,

        values,

        expectedGoals:
            calculateExpectedDiscreteValue(
                values
            )
    };
}


// ============================================================
// PREMIER BUT
// ============================================================

function extractFirstGoal(group) {

    if (!group) {

        return {
            available: false,
            early: null,
            noGoal: null,
            late: null
        };
    }


    const early =
        findMarketValue(
            group,
            [
                "1-29",
                "1-29 mins",
                "early"
            ]
        );


    const noGoal =
        findMarketValue(
            group,
            [
                "no goal",
                "pas de but",
                "no_goal"
            ]
        );


    const late =
        findMarketValue(
            group,
            [
                "30-90",
                "30-90 mins",
                "late"
            ]
        );


    return {

        available:
            Boolean(
                early ||
                noGoal ||
                late
            ),

        early,

        noGoal,

        late
    };
}


// ============================================================
// DIRECTION
// ============================================================

function buildDirectionFeatures({
    oneXTwo,
    handicap,
    team1Goals,
    team2Goals,
    scoringSignals,
    mtFin
}) {

    const home =
        safeProbability(
            oneXTwo.home
        );

    const away =
        safeProbability(
            oneXTwo.away
        );


    const homeScore =
        safeProbability(
            team1Goals.over05
        );

    const awayScore =
        safeProbability(
            team2Goals.over05
        );


    const homeNext =
        safeProbability(
            scoringSignals.nextGoal.team1
        );

    const awayNext =
        safeProbability(
            scoringSignals.nextGoal.team2
        );


    const baseDifference =
        home - away;


    const scoringDifference =
        homeScore - awayScore;


    const nextGoalDifference =
        homeNext - awayNext;


    return {

        homeProbability:
            home,

        awayProbability:
            away,

        baseDifference,

        scoringDifference,

        nextGoalDifference,

        homeFavorite:
            home > away,

        awayFavorite:
            away > home,

        favoriteStrength:
            Math.abs(
                baseDifference
            ),

        handicapAsymmetry:
            handicap.asymmetry,

        awayDominanceSignal:
            clamp01(
                weightedMean([
                    {
                        value:
                            away,
                        weight:
                            0.45
                    },
                    {
                        value:
                            awayScore,
                        weight:
                            0.30
                    },
                    {
                        value:
                            awayNext,
                        weight:
                            0.25
                    }
                ])
            ),

        homeDominanceSignal:
            clamp01(
                weightedMean([
                    {
                        value:
                            home,
                        weight:
                            0.45
                    },
                    {
                        value:
                            homeScore,
                        weight:
                            0.30
                    },
                    {
                        value:
                            homeNext,
                        weight:
                            0.25
                    }
                ])
            ),

        mtFin:
            mtFin.normalized
    };
}


// ============================================================
// ENVIRONNEMENT DE BUTS
// ============================================================

function buildGoalEnvironment({
    btts,
    totals,
    team1Goals,
    team2Goals,
    scoringSignals,
    exactGoals
}) {

    const values = [];


    pushIfFinite(
        values,
        totals.over25?.probability
    );

    pushIfFinite(
        values,
        btts.yesProbability
    );

    pushIfFinite(
        values,
        team1Goals.over15?.probability
    );

    pushIfFinite(
        values,
        team2Goals.over15?.probability
    );


    const scoring1 =
        scoringSignals.team1
            .scoreProbability;

    const scoring2 =
        scoringSignals.team2
            .scoreProbability;


    const bothScoringSignal =
        (
            Number.isFinite(scoring1) &&
            Number.isFinite(scoring2)
        )
            ? Math.min(
                scoring1,
                scoring2
            )
            : null;


    pushIfFinite(
        values,
        bothScoringSignal
    );


    return {

        averageSignal:
            values.length
                ? mean(values)
                : null,

        over25:
            totals.over25?.probability ??
            null,

        btts:
            btts.yesProbability,

        expectedTotalGoals:
            exactGoals.expectedGoals,

        homeScoring:
            scoring1,

        awayScoring:
            scoring2,

        bothScoringSignal,

        blowoutPotential:
            calculateBlowoutPotential({
                totals,
                team1Goals,
                team2Goals,
                scoringSignals,
                exactGoals
            })
    };
}



// ============================================================
// CONFLITS DE MARCHÉ
// ============================================================

function buildMarketConflict({
    oneXTwo,
    handicap,
    btts,
    totals,
    team1Goals,
    team2Goals,
    mtFin
}) {

    const directionConflict =
        calculateDirectionConflict(
            oneXTwo,
            handicap,
            team1Goals,
            team2Goals
        );


    const goalConflict =
        calculateGoalConflict(
            btts,
            totals,
            team1Goals,
            team2Goals
        );


    const temporalConflict =
        calculateTemporalConflict(
            mtFin,
            oneXTwo
        );


    return {

        direction:
            directionConflict,

        goals:
            goalConflict,

        temporal:
            temporalConflict,

        total:
            clamp01(
                weightedMean([
                    {
                        value:
                            directionConflict,
                        weight:
                            0.45
                    },
                    {
                        value:
                            goalConflict,
                        weight:
                            0.35
                    },
                    {
                        value:
                            temporalConflict,
                        weight:
                            0.20
                    }
                ])
            )
    };
}


// ============================================================
// FORCE RELATIVE
// ============================================================

function buildStrengthFeatures({
    oneXTwo,
    handicap,
    direction
}) {

    const home =
        safeProbability(
            oneXTwo.home
        );

    const away =
        safeProbability(
            oneXTwo.away
        );


    const total =
        home +
        away;


    const homeShare =
        total > EPSILON
            ? home / total
            : null;


    const awayShare =
        total > EPSILON
            ? away / total
            : null;


    return {

        homeShare,

        awayShare,

        relativeAwayStrength:
            awayShare,

        relativeHomeStrength:
            homeShare,

        favorite:
            oneXTwo.favorite,

        favoriteMargin:
            oneXTwo.favoriteMargin,

        handicapCurvature:
            handicap.curvature,

        awayDominance:
            direction.awayDominanceSignal,

        homeDominance:
            direction.homeDominanceSignal
    };
}


// ============================================================
// SIGNATURE 12+ VARIABLES
// ============================================================

function buildSignature({
    oneXTwo,
    handicap,
    btts,
    totals,
    team1Goals,
    team2Goals,
    mtFin,
    scoringSignals,
    firstGoal,
    exactGoals,
    direction,
    goalEnvironment,
    marketConflict
}) {

    return [

        // 1
        safeProbability(
            oneXTwo.home
        ),

        // 2
        safeProbability(
            oneXTwo.draw
        ),

        // 3
        safeProbability(
            oneXTwo.away
        ),

        // 4
        safeProbability(
            btts.yes
        ),

        // 5
        safeProbability(
            totals.over25
        ),

        // 6
        safeProbability(
            handicap.zeroLine
        ),

        // 7
        safeProbability(
            team1Goals.over05
        ),

        // 8
        safeProbability(
            team2Goals.over05
        ),

        // 9
        safeProbability(
            scoringSignals.team1.yes
        ),

        // 10
        safeProbability(
            scoringSignals.team2.yes
        ),

        // 11
        direction.awayDominanceSignal,

        // 12
        direction.homeDominanceSignal,

        // Additional signals
        goalEnvironment.blowoutPotential,

        marketConflict.direction,

        marketConflict.goals,

        marketConflict.temporal,

        exactGoals.expectedGoals,

        firstGoal.early?.impliedProbability ??
            null
    ];
}


// ============================================================
// CONTEXTE HISTORIQUE
// ============================================================

function buildHistoricalContext(
    historicalMatches
) {

    if (
        !Array.isArray(
            historicalMatches
        ) ||
        historicalMatches.length === 0
    ) {

        return {

            count: 0,

            averageGoals:
                null,

            homeWinRate:
                null,

            drawRate:
                null,

            awayWinRate:
                null
        };
    }


    let totalGoals = 0;
    let matchesWithResult = 0;

    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;


    for (
        const match
        of historicalMatches
    ) {

        const result =
            match.result;


        if (
            !result ||
            !result.available
        ) {
            continue;
        }


        matchesWithResult++;


        totalGoals +=
            result.totalGoals;


        if (
            result.winner ===
            "HOME"
        ) {
            homeWins++;
        }

        else if (
            result.winner ===
            "AWAY"
        ) {
            awayWins++;
        }

        else if (
            result.winner ===
            "DRAW"
        ) {
            draws++;
        }
    }


    return {

        count:
            historicalMatches.length,

        matchesWithResult,

        averageGoals:
            matchesWithResult
                ? totalGoals /
                  matchesWithResult
                : null,

        homeWinRate:
            matchesWithResult
                ? homeWins /
                  matchesWithResult
                : null,

        drawRate:
            matchesWithResult
                ? draws /
                  matchesWithResult
                : null,

        awayWinRate:
            matchesWithResult
                ? awayWins /
                  matchesWithResult
                : null
    };
}



// ============================================================
// BLOWOUT POTENTIAL
// ============================================================

function calculateBlowoutPotential({
    totals,
    team1Goals,
    team2Goals,
    scoringSignals,
    exactGoals
}) {

    const signals = [];


    /*
     * Le signal ne prédit pas encore un blowout.
     * Il mesure uniquement la présence de conditions
     * compatibles avec une queue de distribution élevée.
     */

    pushIfFinite(
        signals,
        totals.over35?.probability
    );


    pushIfFinite(
        signals,
        team1Goals.over25?.probability
    );


    pushIfFinite(
        signals,
        team2Goals.over25?.probability
    );


    pushIfFinite(
        signals,
        scoringSignals.team1
            .scoreProbability
    );


    pushIfFinite(
        signals,
        scoringSignals.team2
            .scoreProbability
    );


    if (
        Number.isFinite(
            exactGoals.expectedGoals
        )
    ) {

        signals.push(
            clamp01(
                (
                    exactGoals.expectedGoals -
                    2.5
                ) / 2.5
            )
        );
    }


    if (!signals.length) {
        return null;
    }


    return clamp01(
        mean(signals)
    );
}


// ============================================================
// CONFLIT DIRECTIONNEL
// ============================================================

function calculateDirectionConflict(
    oneXTwo,
    handicap,
    team1Goals,
    team2Goals
) {

    const marketHome =
        safeProbability(
            oneXTwo.home
        );

    const marketAway =
        safeProbability(
            oneXTwo.away
        );


    const scoringHome =
        safeProbability(
            team1Goals.over05
        );

    const scoringAway =
        safeProbability(
            team2Goals.over05
        );


    const marketDirection =
        marketHome -
        marketAway;


    const scoringDirection =
        scoringHome -
        scoringAway;


    const residual =
        Math.abs(
            marketDirection -
            scoringDirection
        );


    const handicapSignal =
        handicap.asymmetry;


    return clamp01(
        (
            residual +
            handicapSignal
        ) / 2
    );
}


// ============================================================
// CONFLIT DE BUTS
// ============================================================

function calculateGoalConflict(
    btts,
    totals,
    team1Goals,
    team2Goals
) {

    const bttsSignal =
        btts.yesProbability;


    const overSignal =
        totals.over25?.probability ??
        null;


    const team1Signal =
        team1Goals.over05?.probability ??
        null;


    const team2Signal =
        team2Goals.over05?.probability ??
        null;


    const values = [];


    if (
        Number.isFinite(bttsSignal) &&
        Number.isFinite(overSignal)
    ) {

        values.push(
            Math.abs(
                bttsSignal -
                overSignal
            )
        );
    }


    if (
        Number.isFinite(team1Signal) &&
        Number.isFinite(team2Signal)
    ) {

        values.push(
            Math.abs(
                team1Signal -
                team2Signal
            )
        );
    }


    return values.length
        ? clamp01(mean(values))
        : 0;
}


// ============================================================
// CONFLIT TEMPOREL
// ============================================================

function calculateTemporalConflict(
    mtFin,
    oneXTwo
) {

    if (
        !mtFin ||
        !mtFin.normalized
    ) {
        return 0;
    }


    const awayFinal =
        findObjectProbability(
            mtFin.normalized,
            [
                "v2/v2",
                "x/v2",
                "v1/v2"
            ]
        );


    const homeFinal =
        findObjectProbability(
            mtFin.normalized,
            [
                "v1/v1",
                "x/v1",
                "v2/v1"
            ]
        );


    const marketAway =
        safeProbability(
            oneXTwo.away
        );


    const marketHome =
        safeProbability(
            oneXTwo.home
        );


    if (
        awayFinal === null ||
        homeFinal === null
    ) {
        return 0;
    }


    return clamp01(
        Math.abs(
            (
                awayFinal -
                homeFinal
            ) -
            (
                marketAway -
                marketHome
            )
        )
    );
}


// ============================================================
// HANDICAP CURVATURE
// ============================================================

function calculateHandicapCurvature(
    lines
) {

    if (!lines || lines.length < 3) {
        return 0;
    }


    const probabilities =
        lines
            .map(
                item =>
                    item.probability
            )
            .filter(
                Number.isFinite
            );


    if (probabilities.length < 3) {
        return 0;
    }


    let curvature = 0;


    for (
        let i = 1;
        i <
        probabilities.length - 1;
        i++
    ) {

        curvature +=
            Math.abs(
                probabilities[i - 1] -
                2 * probabilities[i] +
                probabilities[i + 1]
            );
    }


    return clamp01(
        curvature
    );
}


// ============================================================
// HANDICAP ASYMÉTRIE
// ============================================================

function calculateHandicapAsymmetry(
    lines
) {

    if (!lines || !lines.length) {
        return 0;
    }


    const positive =
        lines
            .filter(
                item =>
                    item.handicap > 0
            )
            .map(
                item =>
                    item.probability
            );


    const negative =
        lines
            .filter(
                item =>
                    item.handicap < 0
            )
            .map(
                item =>
                    item.probability
            );


    if (
        !positive.length ||
        !negative.length
    ) {
        return 0;
    }


    return clamp01(
        Math.abs(
            mean(positive) -
            mean(negative)
        )
    );
}


// ============================================================
// MT-FIN RESIDUALS
// ============================================================

function calculateMTFinResiduals(
    normalized
) {

    if (!normalized) {
        return {};
    }


    const finalHome =
        findObjectProbability(
            normalized,
            [
                "v1/v1",
                "x/v1",
                "v2/v1"
            ]
        );


    const finalAway =
        findObjectProbability(
            normalized,
            [
                "v1/v2",
                "x/v2",
                "v2/v2"
            ]
        );


    const finalDraw =
        findObjectProbability(
            normalized,
            [
                "v1/x",
                "x/x",
                "v2/x"
            ]
        );


    return {

        home:
            finalHome,

        draw:
            finalDraw,

        away:
            finalAway,

        awayVsHome:
            (
                finalAway !== null &&
                finalHome !== null
            )
                ? finalAway - finalHome
                : null
    };
}




// ============================================================
// OUTILS MARCHÉ
// ============================================================

function findMarketValue(
    group,
    keys
) {

    if (
        !group ||
        typeof group !== "object"
    ) {
        return null;
    }


    const normalizedKeys =
        keys.map(
            normalizeKey
        );


    for (
        const [key, value]
        of Object.entries(group)
    ) {

        if (
            normalizedKeys.includes(
                normalizeKey(key)
            )
        ) {

            return value;
        }
    }


    return null;
}


function findObjectProbability(
    object,
    keys
) {

    const value =
        findMarketValue(
            object,
            keys
        );


    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }


    return Number.isFinite(value)
        ? value
        : value.normalizedProbability ??
          value.probability ??
          null;
}


// ============================================================
// PROBABILITÉS
// ============================================================

function safeProbability(
    marketValue
) {

    if (!marketValue) {
        return null;
    }


    if (
        Number.isFinite(
            marketValue.impliedProbability
        )
    ) {

        return marketValue.impliedProbability;
    }


    if (
        Number.isFinite(
            marketValue.probability
        )
    ) {

        return marketValue.probability;
    }


    if (
        Number.isFinite(
            marketValue.normalizedProbability
        )
    ) {

        return marketValue.normalizedProbability;
    }


    return null;
}


function collectProbabilities(
    home,
    draw,
    away
) {

    return {

        home:
            safeProbability(home),

        draw:
            safeProbability(draw),

        away:
            safeProbability(away)
    };
}


function normalizePair(
    first,
    second
) {

    const p1 =
        safeProbability(first);

    const p2 =
        safeProbability(second);


    if (
        !Number.isFinite(p1) ||
        !Number.isFinite(p2)
    ) {

        return {
            first: null,
            second: null
        };
    }


    const total =
        p1 + p2;


    if (total <= EPSILON) {

        return {
            first: null,
            second: null
        };
    }


    return {

        first:
            p1 / total,

        second:
            p2 / total
    };
}


function normalizeObjectProbabilities(
    object
) {

    const entries =
        Object.entries(
            object
        );


    const total =
        entries.reduce(
            (sum, [, value]) =>
                sum +
                (
                    value.probability || 0
                ),
            0
        );


    if (total <= EPSILON) {
        return {};
    }


    const result = {};


    for (
        const [key, value]
        of entries
    ) {

        result[key] =
            (
                value.probability /
                total
            );
    }


    return result;
}


// ============================================================
// FAVORI
// ============================================================

function determineFavorite(
    probabilities
) {

    const values = [

        {
            side: "HOME",
            value:
                probabilities.home
        },

        {
            side: "DRAW",
            value:
                probabilities.draw
        },

        {
            side: "AWAY",
            value:
                probabilities.away
        }
    ]
        .filter(
            item =>
                Number.isFinite(
                    item.value
                )
        )
        .sort(
            (a, b) =>
                b.value -
                a.value
        );


    return values.length
        ? values[0].side
        : null;
}


function calculateFavoriteMargin(
    probabilities
) {

    const values = [

        probabilities.home,

        probabilities.draw,

        probabilities.away

    ].filter(
        Number.isFinite
    );


    if (values.length < 2) {
        return null;
    }


    values.sort(
        (a, b) =>
            b - a
    );


    return clamp01(
        values[0] -
        values[1]
    );
}


function calculateMarketStrength(
    probabilities
) {

    const values =
        Object.values(
            probabilities
        ).filter(
            Number.isFinite
        );


    if (!values.length) {
        return null;
    }


    return clamp01(
        Math.max(
            ...values
        )
    );
}


// ============================================================
// PARSERS INTERNES
// ============================================================

function parseHandicapLine(
    key
) {

    const text =
        String(key)
            .replace(",", ".")
            .trim()
            .toLowerCase();


    const match =
        text.match(
            /(-?\d+(?:\.\d+)?)/
        );


    if (!match) {
        return null;
    }


    let value =
        Number(match[1]);


    /*
     * Le marché 2(-1) représente le côté opposé
     * au 1(+1) lorsque les données sont affichées
     * comme dans le bookmaker.
     *
     * Nous conservons ici le signe réellement écrit
     * dans la clé. La transformation sémantique complète
     * appartient à marketEngine.js.
     */

    return Number.isFinite(value)
        ? value
        : null;
}


function parseTotalLine(
    key
) {

    const text =
        String(key)
            .replace(",", ".")
            .trim()
            .toLowerCase();


    const number =
        text.match(
            /(\d+(?:\.\d+)?)/
        );


    if (!number) {
        return null;
    }


    const line =
        Number(number[1]);


    let side = null;


    if (
        text.includes("over") ||
        text.includes("plus") ||
        text.includes("plus de") ||
        text.includes(">")
    ) {

        side = "over";
    }


    if (
        text.includes("under") ||
        text.includes("moins") ||
        text.includes("moins de") ||
        text.includes("<")
    ) {

        side = "under";
    }


    if (!side) {
        return null;
    }


    return {
        line,
        side
    };
}


function parseScoreKey(
    key
) {

    const match =
        String(key)
            .trim()
            .match(
                /^(\d+)\s*[-:]\s*(\d+)$/
            );


    if (!match) {
        return null;
    }


    return {

        home:
            Number(match[1]),

        away:
            Number(match[2])
    };
}


function parseGoalNumber(
    key
) {

    const match =
        String(key)
            .trim()
            .match(
                /(\d+)/
            );


    if (!match) {
        return null;
    }


    const value =
        Number(match[1]);


    return Number.isInteger(value)
        ? value
        : null;
}


function findTotalLine(
    lines,
    line,
    side
) {

    return (
        lines.find(
            item =>
                item.line === line &&
                item.side === side
        ) ||
        null
    );
}


// ============================================================
// VALEURS DISCRÈTES
// ============================================================

function calculateExpectedDiscreteValue(
    values
) {

    if (!values.length) {
        return null;
    }


    let numerator = 0;
    let denominator = 0;


    for (
        const item
        of values
    ) {

        if (
            !Number.isFinite(
                item.probability
            )
        ) {
            continue;
        }


        numerator +=
            item.goals *
            item.probability;


        denominator +=
            item.probability;
    }


    if (denominator <= EPSILON) {
        return null;
    }


    return (
        numerator /
        denominator
    );
}


// ============================================================
// UTILITAIRES GÉNÉRAUX
// ============================================================

function weightedMean(
    items
) {

    let numerator = 0;
    let denominator = 0;


    for (
        const item
        of items
    ) {

        if (
            !item ||
            !Number.isFinite(
                item.value
            ) ||
            !Number.isFinite(
                item.weight
            ) ||
            item.weight <= 0
        ) {
            continue;
        }


        numerator +=
            item.value *
            item.weight;


        denominator +=
            item.weight;
    }


    return denominator > EPSILON
        ? numerator / denominator
        : 0;
}


function mean(
    values
) {

    if (!values.length) {
        return null;
    }


    return (
        values.reduce(
            (sum, value) =>
                sum + value,
            0
        ) /
        values.length
    );
}


function pushIfFinite(
    array,
    value
) {

    if (
        Number.isFinite(value)
    ) {
        array.push(
            clamp01(value)
        );
    }
}


function clamp01(
    value
) {

    if (!Number.isFinite(value)) {
        return 0;
    }


    return Math.max(
        0,
        Math.min(
            1,
            value
        )
    );
}


function normalizeKey(
    key
) {

    return String(key)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}


// ============================================================
// ADAPTATEURS ATTENDUS PAR app.js
// ============================================================
//
// app.js importe précisément buildHistoricalFeatures et
// buildCurrentMatchFeatures. Ce fichier n'exportait jusqu'ici
// que buildFeatures. On ajoute deux fonctions nommées,
// sans dupliquer la logique de calcul.
// ============================================================

/*
 * Construit un tableau de features, une entrée par match
 * historique, chacun ayant accès au contexte historique complet.
 */
export function buildHistoricalFeatures(historicalMatches) {

    if (!Array.isArray(historicalMatches)) {
        return [];
    }

    return historicalMatches.map(
        match => buildFeatures(match, historicalMatches)
    );
}

/*
 * Construit les features du nouvel événement pré-match.
 * app.js appelle actuellement cette fonction avec un seul
 * argument (le match normalisé) ; historicalMatches reste
 * optionnel ici, la comparaison à la mémoire historique
 * étant la responsabilité de historicalEngine.js.
 */
export function buildCurrentMatchFeatures(
    match,
    historicalMatches = []
) {

    return buildFeatures(match, historicalMatches);
}


// ============================================================
// EXPORT
// ============================================================

export default {
    buildFeatures,
    buildHistoricalFeatures,
    buildCurrentMatchFeatures
};