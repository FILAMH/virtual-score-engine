/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * core/normalizer.js
 * ============================================================
 *
 * RÔLE
 * ------------------------------------------------------------
 * Transforme les données produites par parser.js en données
 * numériques et structurées utilisables par les moteurs.
 *
 * PRINCIPES
 * ------------------------------------------------------------
 * 1. Ne jamais inventer une donnée absente.
 * 2. Ne jamais transformer une absence en cote artificielle.
 * 3. Conserver les valeurs originales.
 * 4. Convertir les cotes valides en probabilités implicites.
 * 5. Séparer clairement :
 *      - identité du match
 *      - temporalité
 *      - résultat
 *      - marchés
 *      - métadonnées
 * 6. Supporter les matchs SCORE_ONLY et RICH.
 * 7. Produire une structure déterministe.
 * ============================================================
 */


// ============================================================
// CONSTANTES
// ============================================================

const MIN_ODD = 1.000001;
const MAX_REASONABLE_ODD = 100000;

const MATCH_TYPES = Object.freeze({
    SCORE_ONLY: "SCORE_ONLY",
    RICH: "RICH",
    UNKNOWN: "UNKNOWN"
});


// ============================================================
// API PUBLIQUE
// ============================================================

export function normalizeHistoricalData(parsedHistory) {

    if (!Array.isArray(parsedHistory)) {
        return [];
    }

    return parsedHistory
        .map(normalizeHistoricalMatch)
        .filter(Boolean);
}


export function normalizeMatchData(parsedMatch) {

    if (!parsedMatch || typeof parsedMatch !== "object") {
        throw new Error(
            "Impossible de normaliser le nouvel événement : données invalides."
        );
    }

    return normalizeMatch(parsedMatch, true);
}


/*
 * Alias attendus par app.js (qui importe précisément
 * normalizeHistoricalMatches et normalizeCurrentMatch).
 * On réexporte les mêmes fonctions sous ces noms,
 * sans dupliquer la logique.
 */
export {
    normalizeHistoricalData as normalizeHistoricalMatches,
    normalizeMatchData as normalizeCurrentMatch
};


// ============================================================
// NORMALISATION D'UN MATCH HISTORIQUE
// ============================================================

function normalizeHistoricalMatch(match) {

    if (!match || typeof match !== "object") {
        return null;
    }

    try {
        return normalizeMatch(match, false);
    } catch (error) {

        console.warn(
            "Match historique ignoré pendant la normalisation :",
            error.message
        );

        return null;
    }
}


// ============================================================
// NORMALISATION CENTRALE
// ============================================================

function normalizeMatch(match, isPredictionTarget) {

    const teams =
        normalizeTeams(match);

    const temporal =
        normalizeTemporal(match);

    const result =
        normalizeResult(match);

    const markets =
        normalizeMarkets(match);

    const matchType =
        detectMatchType(
            markets,
            result
        );


    return {

        // ----------------------------------------------------
        // IDENTITÉ
        // ----------------------------------------------------

        id:
            normalizeString(
                match.id
            ) || generateStableId(
                teams.home,
                teams.away,
                temporal.dateTime
            ),

        competition:
            normalizeString(
                match.competition
            ),

        teams,


        // ----------------------------------------------------
        // TEMPS
        // ----------------------------------------------------

        temporal,


        // ----------------------------------------------------
        // RÉSULTAT
        // ----------------------------------------------------

        result,


        // ----------------------------------------------------
        // MARCHÉS
        // ----------------------------------------------------

        markets,


        // ----------------------------------------------------
        // TYPE DE DONNÉES
        // ----------------------------------------------------

        dataQuality: {

            type:
                matchType,

            hasOdds:
                hasAnyOdds(markets),

            hasFullMarkets:
                hasRichMarkets(markets),

            hasResult:
                result.available,

            isPredictionTarget:
                Boolean(
                    isPredictionTarget
                )
        },


        // ----------------------------------------------------
        // INFORMATIONS DE TRAÇABILITÉ
        // ----------------------------------------------------

        metadata: {

            normalizedAt:
                new Date().toISOString(),

            source:
                normalizeString(
                    match.source
                ) || "manual-input"
        }
    };
}


// ============================================================
// ÉQUIPES
// ============================================================

function normalizeTeams(match) {

    const home =
        normalizeString(
            match.homeTeam ??
            match.home ??
            match.team1
        );

    const away =
        normalizeString(
            match.awayTeam ??
            match.away ??
            match.team2
        );

    return {

        home,
        away,

        homeKey:
            createTeamKey(home),

        awayKey:
            createTeamKey(away)
    };
}


// ============================================================
// TEMPS
// ============================================================

function normalizeTemporal(match) {

    const date =
        normalizeDate(
            match.date
        );

    const time =
        normalizeTime(
            match.time
        );

    let dateTime = null;

    if (match.dateTime) {

        const parsed =
            new Date(
                match.dateTime
            );

        if (
            !Number.isNaN(
                parsed.getTime()
            )
        ) {
            dateTime =
                parsed.toISOString();
        }
    }

    if (!dateTime && date && time) {

        const combined =
            new Date(
                `${date}T${time}:00`
            );

        if (
            !Number.isNaN(
                combined.getTime()
            )
        ) {
            dateTime =
                combined.toISOString();
        }
    }

    return {

        date,
        time,
        dateTime,

        timestamp:
            dateTime
                ? new Date(dateTime).getTime()
                : null
    };
}


// ============================================================
// RÉSULTAT
// ============================================================

function normalizeResult(match) {

    const homeGoals =
        toNonNegativeInteger(
            match.homeGoals ??
            match.homeScore ??
            match.score?.home
        );

    const awayGoals =
        toNonNegativeInteger(
            match.awayGoals ??
            match.awayScore ??
            match.score?.away
        );

    const available =
        homeGoals !== null &&
        awayGoals !== null;


    let winner = null;

    if (available) {

        if (homeGoals > awayGoals) {
            winner = "HOME";
        }

        else if (awayGoals > homeGoals) {
            winner = "AWAY";
        }

        else {
            winner = "DRAW";
        }
    }


    return {

        available,

        homeGoals,

        awayGoals,

        totalGoals:
            available
                ? homeGoals + awayGoals
                : null,

        score:
            available
                ? `${homeGoals}-${awayGoals}`
                : null,

        winner,

        cleanSheet:
            available
                ? (
                    homeGoals === 0 ||
                    awayGoals === 0
                )
                : null
    };
}


// ============================================================
// MARCHÉS
// ============================================================

function normalizeMarkets(match) {

    const source =
        match.markets ??
        match.odds ??
        match;


    /*
     * IMPORTANT — correction critique :
     *
     * core/parser.js (fonction marketKey) produit des clés en
     * MAJUSCULES avec underscores : "1X2", "DOUBLE_CHANCE",
     * "BTTS", "HANDICAP", "HALF_FULL", "EXACT_SCORE", etc.
     *
     * Les accès du type source.doubleChance (camelCase minuscule)
     * ne correspondaient à AUCUNE de ces clés réelles (accès objet
     * JS sensible à la casse) — seul source["1X2"] fonctionnait
     * par coïncidence de chaîne strictement identique.
     *
     * Conséquence avant correction : tous les marchés sauf le 1X2
     * étaient silencieusement vidés à cette étape, avant même
     * d'atteindre marketEngine.js.
     *
     * On ajoute donc les clés réelles du parser en dernier
     * recours, sans rien retirer des alias déjà présents (utiles
     * si une autre source de données, ex. JSON externe, utilise
     * un jour le camelCase).
     */

    return {

        // ----------------------------------------------------
        // 1X2
        // ----------------------------------------------------

        oneXTwo:
            normalizeMarketGroup(
                source.oneXTwo ??
                source.mainMarket ??
                source["1X2"]
            ),


        // ----------------------------------------------------
        // DOUBLE CHANCE
        // ----------------------------------------------------

        doubleChance:
            normalizeMarketGroup(
                source.doubleChance ??
                source["DOUBLE_CHANCE"]
            ),


        // ----------------------------------------------------
        // BTTS
        // ----------------------------------------------------

        btts:
            normalizeMarketGroup(
                source.btts ??
                source.bothTeamsToScore ??
                source["BTTS"]
            ),


        // ----------------------------------------------------
        // TOTAL ÉQUIPE 1
        // ----------------------------------------------------

        team1Totals:
            normalizeMarketGroup(
                source.team1Totals ??
                source.total1 ??
                source["TEAM1_TOTAL"]
            ),


        // ----------------------------------------------------
        // TOTAL ÉQUIPE 2
        // ----------------------------------------------------

        team2Totals:
            normalizeMarketGroup(
                source.team2Totals ??
                source.total2 ??
                source["TEAM2_TOTAL"]
            ),


        // ----------------------------------------------------
        // TOTAL MATCH
        // ----------------------------------------------------

        matchTotals:
            normalizeMarketGroup(
                source.matchTotals ??
                source.total ??
                source["TOTAL"]
            ),


        // ----------------------------------------------------
        // TOTAL PAIR
        // ----------------------------------------------------

        totalOddEven:
            normalizeMarketGroup(
                source.totalOddEven ??
                source["TOTAL_EVEN"]
            ),


        // ----------------------------------------------------
        // HANDICAP
        // ----------------------------------------------------

        handicap:
            normalizeMarketGroup(
                source.handicap ??
                source["HANDICAP"]
            ),


        // ----------------------------------------------------
        // MI-TEMPS / FIN
        // ----------------------------------------------------

        halfTimeFullTime:
            normalizeMarketGroup(
                source.halfTimeFullTime ??
                source.mtFin ??
                source["HALF_FULL"]
            ),


        // ----------------------------------------------------
        // SCORE EXACT
        // ----------------------------------------------------

        exactScore:
            normalizeMarketGroup(
                source.exactScore ??
                source["EXACT_SCORE"]
            ),


        // ----------------------------------------------------
        // PROCHAIN BUT
        // ----------------------------------------------------

        nextGoal:
            normalizeMarketGroup(
                source.nextGoal ??
                source["NEXT_GOAL"]
            ),


        // ----------------------------------------------------
        // 1 VA MARQUER
        // ----------------------------------------------------

        team1ToScore:
            normalizeMarketGroup(
                source.team1ToScore ??
                source.oneToScore ??
                source["TEAM1_SCORE"]
            ),


        // ----------------------------------------------------
        // 2 VA MARQUER
        // ----------------------------------------------------

        team2ToScore:
            normalizeMarketGroup(
                source.team2ToScore ??
                source.twoToScore ??
                source["TEAM2_SCORE"]
            ),


        // ----------------------------------------------------
        // BUT DANS CHAQUE MI-TEMPS
        // ----------------------------------------------------

        goalEachHalf:
            normalizeMarketGroup(
                source.goalEachHalf ??
                source["HALF_GOAL"]
            ),


        // ----------------------------------------------------
        // ÉQUIPE 1 GAGNE AU MOINS UNE MI-TEMPS
        // ----------------------------------------------------

        team1WinHalf:
            normalizeMarketGroup(
                source.team1WinHalf ??
                source["HALF_WIN_TEAM1"]
            ),


        // ----------------------------------------------------
        // ÉQUIPE 2 GAGNE AU MOINS UNE MI-TEMPS
        // ----------------------------------------------------

        team2WinHalf:
            normalizeMarketGroup(
                source.team2WinHalf ??
                source["HALF_WIN_TEAM2"]
            ),


        // ----------------------------------------------------
        // MOMENT DU PREMIER BUT
        // ----------------------------------------------------

        firstGoalTime:
            normalizeMarketGroup(
                source.firstGoalTime ??
                source["FIRST_GOAL_TIME"]
            ),


     // ----------------------------------------------------
        // NOMBRE EXACT DE BUTS
        // ----------------------------------------------------

        exactTotalGoals:
            normalizeMarketGroup(
                source.exactTotalGoals ??
                source.exactNumber ??
                source["EXACT_TOTAL"]
            ),


        // ----------------------------------------------------
        // CHAQUE ÉQUIPE MARQUE 2 BUTS OU PLUS
        // ----------------------------------------------------

        twoPlusGoals:
            normalizeMarketGroup(
                source.twoPlusGoals ??
                source["TWO_PLUS_GOALS"]
            ),


        // ----------------------------------------------------
        // AUTRES MARCHÉS
        // ----------------------------------------------------

        other:
            normalizeMarketGroup(
                source.other
            )
    };
}


// ============================================================
// NORMALISATION D'UN GROUPE DE MARCHÉ
// ============================================================

function normalizeMarketGroup(group) {

    if (!group) {
        return {};
    }


    // Déjà sous forme objet
    if (
        typeof group === "object" &&
        !Array.isArray(group)
    ) {

        const result = {};

        for (
            const [key, value]
            of Object.entries(group)
        ) {

            const normalized =
                normalizeMarketValue(
                    value
                );

            if (normalized !== null) {

                result[
                    normalizeMarketKey(key)
                ] = normalized;
            }
        }

        return result;
    }


    return {};
}


// ============================================================
// NORMALISATION D'UNE VALEUR DE MARCHÉ
// ============================================================

function normalizeMarketValue(value) {

    let odd = null;


    if (
        typeof value === "number"
    ) {

        odd = value;
    }

    else if (
        typeof value === "string"
    ) {

        odd =
            parseFloat(
                value
                    .replace(",", ".")
                    .replace(/[^\d.-]/g, "")
            );
    }

    else if (
        value &&
        typeof value === "object"
    ) {

        odd =
            toFiniteNumber(
                value.odd ??
                value.odds ??
                value.price
            );
    }


    if (
        odd === null ||
        odd < MIN_ODD ||
        odd > MAX_REASONABLE_ODD
    ) {

        return null;
    }


    return {

        odd,

        impliedProbability:
            1 / odd,

        logOdd:
            Math.log(odd)
    };
}


// ============================================================
// PROBABILITÉ IMPLICITE NORMALISÉE
// ============================================================
//
// IMPORTANT :
// 1 / cote est une probabilité implicite brute.
// Elle n'est PAS automatiquement une probabilité de marché
// normalisée. La normalisation est faite séparément afin de
// conserver l'information de marge du bookmaker.
// ============================================================

export function normalizeProbabilities(
    marketGroup
) {

    if (
        !marketGroup ||
        typeof marketGroup !== "object"
    ) {
        return {};
    }


    const entries =
        Object.entries(
            marketGroup
        ).filter(
            ([, value]) =>
                value &&
                Number.isFinite(
                    value.impliedProbability
                )
        );


    const total =
        entries.reduce(
            (sum, [, value]) =>
                sum +
                value.impliedProbability,
            0
        );


    if (total <= 0) {
        return {};
    }


    const result = {};


    for (
        const [key, value]
        of entries
    ) {

        result[key] = {

            ...value,

            normalizedProbability:
                value.impliedProbability /
                total
        };
    }


    return result;
}


// ============================================================
// AJOUT DES PROBABILITÉS NORMALISÉES AUX MARCHÉS
// ============================================================

export function normalizeAllMarketProbabilities(
    markets
) {

    if (!markets) {
        return {};
    }


    const result = {};


    for (
        const [marketName, group]
        of Object.entries(markets)
    ) {

        result[marketName] =
            normalizeProbabilities(
                group
            );
    }


    return result;
}


// ============================================================
// TYPE DU MATCH
// ============================================================

function detectMatchType(
    markets,
    result
) {

    const hasOdds =
        hasAnyOdds(markets);


    if (hasOdds) {
        return MATCH_TYPES.RICH;
    }


    if (result.available) {
        return MATCH_TYPES.SCORE_ONLY;
    }


    return MATCH_TYPES.UNKNOWN;
}


// ============================================================
// TEST : AU MOINS UNE COTE
// ============================================================

function hasAnyOdds(markets) {

    if (!markets) {
        return false;
    }


    for (
        const group
        of Object.values(markets)
    ) {

        if (
            group &&
            typeof group === "object" &&
            Object.values(group).some(
                value =>
                    value &&
                    Number.isFinite(
                        value.odd
                    )
            )
        ) {

            return true;
        }
    }


    return false;
}


// ============================================================
// TEST : MARCHÉS RICHES
// ============================================================

function hasRichMarkets(markets) {

    if (!markets) {
        return false;
    }


    let marketCount = 0;


    for (
        const group
        of Object.values(markets)
    ) {

        if (
            group &&
            typeof group === "object" &&
            Object.keys(group).length > 0
        ) {

            marketCount++;
        }
    }


    /*
     * Ce seuil n'est pas une décision mathématique de
     * prédiction. Il sert uniquement à distinguer un historique
     * pauvre d'un snapshot riche.
     */

    return marketCount >= 3;
}





// ============================================================
// UTILITAIRES DE CONVERSION
// ============================================================

function toFiniteNumber(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }


    const number =
        typeof value === "number"
            ? value
            : parseFloat(
                String(value)
                    .replace(",", ".")
            );


    return Number.isFinite(number)
        ? number
        : null;
}


function toNonNegativeInteger(value) {

    const number =
        toFiniteNumber(value);


    if (
        number === null ||
        number < 0 ||
        !Number.isInteger(number)
    ) {

        return null;
    }


    return number;
}


// ============================================================
// TEXTE
// ============================================================

function normalizeString(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }


    const text =
        String(value)
            .trim()
            .replace(/\s+/g, " ");


    return text.length > 0
        ? text
        : null;
}


// ============================================================
// DATE
// ============================================================

function normalizeDate(value) {

    const text =
        normalizeString(value);


    if (!text) {
        return null;
    }


    /*
     * Support :
     *
     * 13.08.2026
     * 13/08/2026
     * 2026-08-13
     */

    let match =
        text.match(
            /^(\d{2})[./-](\d{2})[./-](\d{4})$/
        );


    if (match) {

        const [, day, month, year] =
            match;

        return `${year}-${month}-${day}`;
    }


    match =
        text.match(
            /^(\d{4})-(\d{2})-(\d{2})$/
        );


    if (match) {
        return text;
    }


    return null;
}


// ============================================================
// HEURE
// ============================================================

function normalizeTime(value) {

    const text =
        normalizeString(value);


    if (!text) {
        return null;
    }


    const match =
        text.match(
            /^(\d{1,2}):(\d{2})$/
        );


    if (!match) {
        return null;
    }


    const hour =
        Number(match[1]);

    const minute =
        Number(match[2]);


    if (
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {

        return null;
    }


    return (
        String(hour).padStart(2, "0") +
        ":" +
        String(minute).padStart(2, "0")
    );
}


// ============================================================
// CLÉ ÉQUIPE
// ============================================================

function createTeamKey(teamName) {

    if (!teamName) {
        return null;
    }


    return teamName
        .normalize("NFD")
        .replace(
            /[\u0300-\u036f]/g,
            ""
        )
        .toLowerCase()
        .replace(
            /[^a-z0-9]+/g,
            "_"
        )
        .replace(
            /^_+|_+$/g,
            "");
}


// ============================================================
// CLÉ DE MARCHÉ
// ============================================================

function normalizeMarketKey(key) {

    return String(key)
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}


// ============================================================
// ID STABLE
// ============================================================

function generateStableId(
    home,
    away,
    dateTime
) {

    const source =
        `${home || "unknown"}|` +
        `${away || "unknown"}|` +
        `${dateTime || "unknown"}`;


    let hash = 0;


    for (
        let i = 0;
        i < source.length;
        i++
    ) {

        hash =
            (
                (
                    hash << 5
                ) -
                hash +
                source.charCodeAt(i)
            ) |
            0;
    }


    return `match_${Math.abs(hash)}`;
}


// ============================================================
// EXPORT PAR DÉFAUT
// ============================================================

export default {
    normalizeHistoricalData,
    normalizeMatchData,
    normalizeProbabilities,
    normalizeAllMarketProbabilities
};