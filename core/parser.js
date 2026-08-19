/* ============================================================
   VIRTUAL SCORE ENGINE
   core/parser.js
   ------------------------------------------------------------
   RESPONSIBILITY:
   Convert raw pasted match text into structured JavaScript
   objects.

   IMPORTANT:
   - This file DOES NOT predict.
   - This file DOES NOT calculate probabilities.
   - This file DOES NOT modify odds.
   - This file DOES NOT create missing values.
   - It only extracts and structures information.

   SUPPORTED INPUT:
   - Historical completed matches:
       Team 1 / Team 2
       score
       date
       time
       optional preserved odds

   - New pre-match events:
       full market block as supplied by the user.

   The parser is intentionally defensive.
   ============================================================ */


/* ============================================================
   1. CONSTANTS
   ============================================================ */

const SECTION_NAMES = [
    "MARCHÉ PRINCIPAL - 1X2",
    "TEMPS RÉGLEMENTAIRE",
    "DOUBLE CHANCE",
    "DEUX ÉQUIPES VONT MARQUER",
    "TOTAL 1",
    "TOTAL2",
    "TOTAL (MATCH ENTIER)",
    "TOTAL PAIR",
    "HANDICAP",
    "MT-FIN",
    "SCORE EXACT",
    "PROCHAIN BUT",
    "1 VA MARQUER",
    "2 VA MARQUER",
    "BUT DANS CHAQUE MI-TEMPS",
    "ÉQUIPE 1 VA GAGNER AU MOINS UNE MI-TEMPS",
    "ÉQUIPE 2 VA GAGNER AU MOINS UNE MI-TEMPS",
    "MOMENT DU PREMIER BUT",
    "NOMBRE EXACT",
    "ÉQUIPE 2 VA GAGNER LES DEUX MI-TEMPS",
    "SCORE DANS CHAQUE MI-TEMPS"
];


/* ============================================================
   2. PUBLIC API
   ============================================================ */

export function parseHistoricalMatches(rawText) {

    if (typeof rawText !== "string") {
        throw new TypeError(
            "Historical input must be a string."
        );
    }

    const cleaned =
        cleanRawText(rawText);

    if (!cleaned) {
        return [];
    }

    /*
     * First attempt:
     * detect whether the input contains multiple match blocks.
     */

    const blocks =
        splitHistoricalBlocks(cleaned);


    const matches = [];

    for (const block of blocks) {

        try {

            const match =
                parseHistoricalBlock(block);

            if (match) {
                matches.push(match);
            }

        } catch (error) {

            /*
             * One malformed historical block must not
             * destroy the entire historical dataset.
             *
             * We deliberately skip only the invalid block.
             */

            console.warn(
                "[Parser] Historical block skipped:",
                error.message
            );
        }
    }


    return matches;
}


/* ============================================================
   3. CURRENT MATCH PARSER
   ============================================================ */

export function parseCurrentMatch(rawText) {

    if (typeof rawText !== "string") {
        throw new TypeError(
            "Current match input must be a string."
        );
    }

    const cleaned =
        cleanRawText(rawText);

    if (!cleaned) {
        throw new Error(
            "Current match input is empty."
        );
    }


    const lines =
        cleaned.split("\n");


    const teams =
        extractTeamsAndEventInfo(lines);


    if (!teams.homeTeam ||
        !teams.awayTeam) {

        throw new Error(
            "Unable to identify both teams."
        );
    }


    const sections =
        extractSections(lines);


    const markets =
        parseAllMarkets(sections);


    /*
     * A pre-match event is allowed to have many markets.
     * We don't require every possible market to exist here.
     *
     * Validation and featureEngine will decide what is
     * sufficient for a particular model.
     */

    return {

        type: "PREMATCH",

        competition:
            teams.competition,

        homeTeam:
            teams.homeTeam,

        awayTeam:
            teams.awayTeam,

        date:
            teams.date,

        time:
            teams.time,

        startDateTime:
            teams.startDateTime,

        score:
            null,

        status:
            "NOT_STARTED",

        markets,

        rawText:
            rawText
    };
}


/* ============================================================
   4. HISTORICAL BLOCK PARSER
   ============================================================ */

function parseHistoricalBlock(block) {

    const lines =
        block.split("\n");


    const teams =
        extractTeamsAndEventInfo(lines);


    if (!teams.homeTeam ||
        !teams.awayTeam) {

        return null;
    }


    const score =
        extractFinalScore(lines);


    /*
     * Historical records must have a final score.
     */

    if (!score) {

        throw new Error(
            `No final score found for ${teams.homeTeam} vs ${teams.awayTeam}.`
        );
    }


    const sections =
        extractSections(lines);


    const markets =
        parseAllMarkets(sections);


    return {

        type: "HISTORICAL",

        competition:
            teams.competition,

        homeTeam:
            teams.homeTeam,

        awayTeam:
            teams.awayTeam,

        date:
            teams.date,

        time:
            teams.time,

        startDateTime:
            teams.startDateTime,

        score: {

            home:
                score.home,

            away:
                score.away
        },

        status:
            "FINISHED",

        markets,

        /*
         * If historical odds were preserved at the time
         * of the event, they remain available here.
         *
         * If they were not preserved, markets simply
         * remains empty.
         */

        hasHistoricalOdds:
            Object.keys(markets).length > 0
    };
}


/* ============================================================
   5. RAW TEXT CLEANING
   ============================================================ */

function cleanRawText(text) {

    return text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\u00A0/g, " ")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}


/* ============================================================
   6. HISTORICAL BLOCK DETECTION
   ============================================================ */

function splitHistoricalBlocks(text) {

    /*
     * Supported common separators:
     *
     * =====
     * -----
     * blank-line blocks
     *
     * The parser first tries explicit separators.
     */

    const explicitBlocks =
        text
            .split(
                /\n\s*(?:={5,}|-{5,})\s*\n/g
            )
            .map(block => block.trim())
            .filter(Boolean);


    if (explicitBlocks.length > 1) {
        return explicitBlocks;
    }


    /*
     * Second method:
     * Detect lines containing:
     *
     * Team A 2 : 1 Team B
     *
     * or
     *
     * Team A 2-1 Team B
     *
     * and use them as match boundaries.
     */

    const lines =
        text.split("\n");

    const blocks = [];

    let current = [];


    for (const line of lines) {

        if (looksLikeMatchLine(line) &&
            current.length > 0) {

            blocks.push(
                current.join("\n").trim()
            );

            current = [];
        }

        current.push(line);
    }


    if (current.length > 0) {

        blocks.push(
            current.join("\n").trim()
        );
    }


    return blocks.filter(Boolean);
}


/* ============================================================
   7. EVENT / TEAM EXTRACTION
   ============================================================ */

function extractTeamsAndEventInfo(lines) {

    let competition = null;
    let homeTeam = null;
    let awayTeam = null;
    let date = null;
    let time = null;


    /*
     * Competition is normally the first meaningful line.
     */

    for (let i = 0; i < lines.length; i++) {

        const line =
            lines[i].trim();

        if (!line) {
            continue;
        }


        if (
            !looksLikeMatchLine(line) &&
            !looksLikeDateLine(line) &&
            !looksLikeScoreLine(line)
        ) {

            /*
             * Typical competition:
             * FIFA FC 26. Spain Championship
             */

            if (!competition) {
                competition = line;
            }
        }


        if (!homeTeam &&
            looksLikeMatchLine(line)) {

            const parsed =
                parseMatchLine(line);

            if (parsed) {

                homeTeam =
                    parsed.homeTeam;

                awayTeam =
                    parsed.awayTeam;

                /*
                 * If a score exists on the same line,
                 * it is handled separately by
                 * extractFinalScore().
                 */
            }
        }


        if (!date &&
            looksLikeDateLine(line)) {

            const dateTime =
                parseDateTime(line);

            if (dateTime) {

                date =
                    dateTime.date;

                time =
                    dateTime.time;
            }
        }
    }


    /*
     * If date/time wasn't found independently,
     * search the whole text again.
     */

    if (!date || !time) {

        const fullText =
            lines.join("\n");

        const dateMatch =
            fullText.match(
                /\b(\d{1,2}\.\d{1,2}\.\d{4})\s*\((\d{1,2}:\d{2})\)/
            );

        if (dateMatch) {

            date =
                dateMatch[1];

            time =
                dateMatch[2];
        }
    }


    return {

        competition,

        homeTeam:
            cleanTeamName(homeTeam),

        awayTeam:
            cleanTeamName(awayTeam),

        date,

        time,

        startDateTime:
            combineDateTime(date, time)
    };
}


/* ============================================================
   8. MATCH LINE DETECTION
   ============================================================ */

function looksLikeMatchLine(line) {

    if (typeof line !== "string") {
        return false;
    }


    /*
     * Typical format:
     *
     * Levante UD 0 : 0 Club Atlético de Madrid
     *
     * or:
     *
     * Levante UD - Club Atlético de Madrid
     */

    return (
        /.+\s+\d+\s*:\s*\d+\s+.+/.test(line) ||
        /.+\s+\d+\s*-\s*\d+\s+.+/.test(line) ||
        /.+\s+vs\.?\s+.+/i.test(line) ||
        /.+\s+v\s+.+/i.test(line)
    );
}


/* ============================================================
   9. MATCH LINE PARSER
   ============================================================ */

function parseMatchLine(line) {

    let match;


    /*
     * Score separator ":"
     */

    match =
        line.match(
            /^(.+?)\s+(\d+)\s*:\s*(\d+)\s+(.+?)$/
        );


    if (match) {

        return {

            homeTeam:
                cleanTeamName(match[1]),

            homeScore:
                Number(match[2]),

            awayScore:
                Number(match[3]),

            awayTeam:
                cleanTeamName(match[4])
        };
    }


    /*
     * Score separator "-"
     *
     * We intentionally require spaces around the
     * separator to avoid confusing team names such as
     * "Club-Name".
     */

    match =
        line.match(
            /^(.+?)\s+(\d+)\s*-\s*(\d+)\s+(.+?)$/
        );


    if (match) {

        return {

            homeTeam:
                cleanTeamName(match[1]),

            homeScore:
                Number(match[2]),

            awayScore:
                Number(match[3]),

            awayTeam:
                cleanTeamName(match[4])
        };
    }


    /*
     * "Team A vs Team B"
     */

    match =
        line.match(
            /^(.+?)\s+vs\.?\s+(.+?)$/i
        );


    if (match) {

        return {

            homeTeam:
                cleanTeamName(match[1]),

            homeScore:
                null,

            awayScore:
                null,

            awayTeam:
                cleanTeamName(match[2])
        };
    }


    /*
     * "Team A v Team B"
     */

    match =
        line.match(
            /^(.+?)\s+v\s+(.+?)$/i
        );


    if (match) {

        return {

            homeTeam:
                cleanTeamName(match[1]),

            homeScore:
                null,

            awayScore:
                null,

            awayTeam:
                cleanTeamName(match[2])
        };
    }


    return null;
}


/* ============================================================
   10. FINAL SCORE EXTRACTION
   ============================================================ */

function extractFinalScore(lines) {

    /*
     * First look for a score contained in the match header.
     */

    for (const line of lines) {

        const parsed =
            parseMatchLine(line);

        if (
            parsed &&
            Number.isInteger(parsed.homeScore) &&
            Number.isInteger(parsed.awayScore)
        ) {

            return {

                home:
                    parsed.homeScore,

                away:
                    parsed.awayScore
            };
        }
    }


    /*
     * Fallback:
     *
     * Search for an isolated score line such as:
     *
     * 0 : 4
     */

    for (const line of lines) {

        const match =
            line.match(
                /^\s*(\d+)\s*:\s*(\d+)\s*$/
            );

        if (match) {

            return {

                home:
                    Number(match[1]),

                away:
                    Number(match[2])
            };
        }
    }


    return null;
}


/* ============================================================
   11. DATE / TIME
   ============================================================ */

function looksLikeDateLine(line) {

    return (
        /\b\d{1,2}\.\d{1,2}\.\d{4}\b/.test(line)
    );
}


function parseDateTime(line) {

    const match =
        line.match(
            /\b(\d{1,2}\.\d{1,2}\.\d{4})\s*(?:\((\d{1,2}:\d{2})\))?/
        );


    if (!match) {
        return null;
    }


    return {

        date:
            match[1],

        time:
            match[2] || null
    };
}


function combineDateTime(
    date,
    time
) {

    if (!date) {
        return null;
    }


    if (!time) {
        return date;
    }


    const parts =
        date.split(".").map(Number);


    if (parts.length !== 3) {
        return null;
    }


    const [
        day,
        month,
        year
    ] = parts;


    const [
        hours,
        minutes
    ] =
        time.split(":").map(Number);


    const dateObject =
        new Date(
            year,
            month - 1,
            day,
            hours,
            minutes,
            0,
            0
        );


    if (
        Number.isNaN(
            dateObject.getTime()
        )
    ) {

        return null;
    }


    return dateObject.toISOString();
}


/* ============================================================
   12. SECTION EXTRACTION
   ============================================================ */

function extractSections(lines) {

    const sections = {};

    let currentSection = null;
    let buffer = [];


    const flush =
        () => {

            if (!currentSection) {
                return;
            }

            sections[currentSection] =
                buffer.join("\n").trim();

            buffer = [];
        };


    for (const originalLine of lines) {

        const line =
            originalLine.trim();

        const normalized =
            normalizeSectionName(line);


        if (isSectionHeader(normalized)) {

            flush();

            currentSection =
                normalized;

            continue;
        }


        if (currentSection) {
            buffer.push(originalLine);
        }
    }


    flush();


    return sections;
}


/* ============================================================
   13. SECTION NAME NORMALIZATION
   ============================================================ */

function normalizeSectionName(name) {

    return String(name)
        .normalize("NFD")
        .replace(
            /[\u0300-\u036f]/g,
            ""
        )
        .replace(/\s+/g, " ")
        .trim()
        /*
         * Certains en-têtes réels se terminent par ":"
         * ("Double chance :", "Deux équipes vont marquer :").
         * On le retire pour que la comparaison fonctionne.
         */
        .replace(/:\s*$/, "")
        .trim()
        .toUpperCase();
}


function isSectionHeader(line) {

    if (!line) {
        return false;
    }


    const normalized =
        normalizeSectionName(line);


    /*
     * Exact known sections.
     */

    for (const section of SECTION_NAMES) {

        const normalizedSection =
            normalizeSectionName(section);

        if (
            normalized ===
            normalizedSection
        ) {
            return true;
        }
    }


 /*
     * Dynamic subsection headers.
     *
     * Ces motifs couvrent les variantes réellement observées
     * dans les données de la plateforme, qui ajoutent souvent
     * un nom d'équipe ou un complément après le libellé de base
     * (ex. "TOTAL ÉQUIPE 1 (Levante UD)", "MT-FIN (Mi-temps /
     * Fin de match)"), ou un ordre de mots différent
     * (ex. "ÉQUIPE 1 VA MARQUER" au lieu de "1 VA MARQUER").
     */

    if (
        /^TOTAL\s*(EQUIPE\s*)?1\b/.test(normalized) ||
        /^TOTAL\s*(EQUIPE\s*)?2\b/.test(normalized) ||
        /^TOTAL2\b/.test(normalized) ||
        /^TOTAL\s*\(MATCH ENTIER\)/.test(normalized) ||
        /^MT-FIN\b/.test(normalized) ||
        /^EQUIPE\s*1\s+VA\s+MARQUER\b/.test(normalized) ||
        /^EQUIPE\s*2\s+VA\s+MARQUER\b/.test(normalized) ||
        /^CHAQUE\s+EQUIPE\s+VA\s+MARQUER\b/.test(normalized)
    ) {
        return true;
    }


    return false;
}


/* ============================================================
   14. MARKET PARSER
   ============================================================ */

function parseAllMarkets(sections) {

    const markets = {};


    for (
        const [
            sectionName,
            content
        ]
        of Object.entries(sections)
    ) {

        const key =
            marketKey(sectionName);


        if (!key) {
            continue;
        }


        try {

            markets[key] =
                parseMarketSection(
                    key,
                    content
                );

        } catch (error) {

            console.warn(
                `[Parser] Market "${key}" could not be parsed:`,
                error.message
            );
        }
    }


    return markets;
}


/* ============================================================
   15. MARKET SECTION DISPATCHER
   ============================================================ */

function parseMarketSection(
    key,
    content
) {

    switch (key) {

        case "1X2":
            return parseOneXTwo(content);

        case "DOUBLE_CHANCE":
            return parseGenericOdds(content);

        case "BTTS":
            return parseGenericOdds(content);

        case "TEAM_GOALS":
            return parseTeamGoals(content);

        case "TEAM1_TOTAL":
        case "TEAM2_TOTAL":
        case "TOTAL":
            return parseTotalGoals(content);

        case "TWO_PLUS_GOALS":
            return parseGenericOdds(content);

        case "TOTAL_EVEN":
            return parseGenericOdds(content);

        case "HANDICAP":
            return parseHandicap(content);

        case "HALF_FULL":
            return parseHalfFull(content);

        case "EXACT_SCORE":
            return parseExactScore(content);

        case "NEXT_GOAL":
            return parseNextGoal(content);

        case "TEAM_TO_SCORE":
            return parseGenericOdds(content);

        case "HALF_GOAL":
            return parseGenericOdds(content);

        case "HALF_WIN_TEAM1":
            return parseGenericOdds(content);

        case "HALF_WIN_TEAM2":
            return parseGenericOdds(content);

        case "FIRST_GOAL_TIME":
            return parseGenericOdds(content);

        case "EXACT_TOTAL":
            return parseExactTotal(content);

        case "TEAM2_BOTH_HALVES":
            return parseGenericOdds(content);

        case "HALF_SCORE":
            return parseGenericOdds(content);

        default:
            return parseGenericOdds(content);
    }
}


/* ============================================================
   16. MARKET KEY
   ============================================================ */

function marketKey(sectionName) {
    
    const name =
        normalizeSectionName(sectionName);
    
    
    if (
        name ===
        "MARCHE PRINCIPAL - 1X2"
    ) {
        return "1X2";
    }
    
    
    if (name === "DOUBLE CHANCE") {
        return "DOUBLE_CHANCE";
    }
    
    
    if (
        name ===
        "DEUX EQUIPES VONT MARQUER"
    ) {
        return "BTTS";
    }
    
    
    if (
        /^CHAQUE\s+EQUIPE\s+VA\s+MARQUER\b/.test(name)
    ) {
        return "TWO_PLUS_GOALS";
    }
    
    
    /*
     * Les libellés réels ajoutent souvent le nom de l'équipe
     * entre parenthèses : "TOTAL ÉQUIPE 1 (Levante UD)".
     * On teste donc un préfixe plutôt qu'une égalité stricte.
     */
    
    if (
        /^TOTAL\s*(EQUIPE\s*)?1\b/.test(name)
    ) {
        return "TEAM1_TOTAL";
    }
    
    
    if (
        /^TOTAL\s*(EQUIPE\s*)?2\b/.test(name) ||
        name === "TOTAL2"
    ) {
        return "TEAM2_TOTAL";
    }
    
    
    if (
        name ===
        "TOTAL (MATCH ENTIER)"
    ) {
        return "TOTAL";
    }
    
    
    if (
        name ===
        "TOTAL PAIR"
    ) {
        return "TOTAL_EVEN";
    }
    
    
    if (name === "HANDICAP") {
        return "HANDICAP";
    }
    
    
    /*
     * "MT-FIN (Mi-temps / Fin de match)" — préfixe également.
     */
    
    if (/^MT-FIN\b/.test(name)) {
        return "HALF_FULL";
    }
    
    
    if (name === "SCORE EXACT") {
        return "EXACT_SCORE";
    }
    
    
    if (name === "PROCHAIN BUT") {
        return "NEXT_GOAL";
    }
    
    
    /*
     * "1 VA MARQUER" (format court) ou
     * "ÉQUIPE 1 VA MARQUER" (format réel observé).
     */
    
    if (
        name === "1 VA MARQUER" ||
        /^EQUIPE\s*1\s+VA\s+MARQUER\b/.test(name)
    ) {
        return "TEAM1_SCORE";
    }
    
    
    if (
        name === "2 VA MARQUER" ||
        /^EQUIPE\s*2\s+VA\s+MARQUER\b/.test(name)
    ) {
        return "TEAM2_SCORE";
    }


    if (
        name ===
        "BUT DANS CHAQUE MI-TEMPS"
    ) {
        return "HALF_GOAL";
    }


    if (
        name.includes(
            "EQUIPE 1 VA GAGNER AU MOINS UNE MI-TEMPS"
        )
    ) {
        return "HALF_WIN_TEAM1";
    }


    if (
        name.includes(
            "EQUIPE 2 VA GAGNER AU MOINS UNE MI-TEMPS"
        )
    ) {
        return "HALF_WIN_TEAM2";
    }


    if (
        name ===
        "MOMENT DU PREMIER BUT"
    ) {
        return "FIRST_GOAL_TIME";
    }


    if (
        name ===
        "NOMBRE EXACT"
    ) {
        return "EXACT_TOTAL";
    }


    if (
        name.includes(
            "EQUIPE 2 VA GAGNER LES DEUX MI-TEMPS"
        )
    ) {
        return "TEAM2_BOTH_HALVES";
    }


    if (
        name ===
        "SCORE DANS CHAQUE MI-TEMPS"
    ) {
        return "HALF_SCORE";
    }


    return null;
}


/* ============================================================
   17. 1X2
   ============================================================ */

function parseOneXTwo(content) {

    const result = {};

    const lines =
        content.split("\n");


    for (const line of lines) {

        /*
         * Les données réelles ajoutent souvent le nom de
         * l'équipe entre parenthèses juste après le label :
         *   "V1 (Séville) : 4.2"
         *   "V2 (Athletic Bilbao) : 1.575"
         * Le groupe optionnel (?:\([^)]*\))? absorbe ce texte
         * avant le ":" sans le capturer.
         */
        const match =
            line.match(
                /^\s*(V1|V2|X)\s*(?:\([^)]*\))?\s*:\s*([0-9]+(?:[.,][0-9]+)?)/
            );


        if (!match) {
            continue;
        }


        const value =
            parseDecimal(match[2]);


        if (value === null) {
            continue;
        }


        const key =
            match[1];


        result[key] =
            value;
    }


    return result;
}


/* ============================================================
   18. GENERIC ODDS
   ============================================================ */

function parseGenericOdds(content) {

    const result = {};


    const lines =
        content.split("\n");


    for (const line of lines) {

        const separatorIndex =
            line.indexOf(":");


        if (separatorIndex === -1) {
            continue;
        }


        const label =
            line
                .slice(0, separatorIndex)
                .trim();


        const rawValue =
            line
                .slice(separatorIndex + 1)
                .trim();


        const value =
            parseDecimal(
                rawValue
            );


        if (
            !label ||
            value === null
        ) {
            continue;
        }


        result[
            normalizeMarketLabel(label)
        ] = value;
    }


    return result;
}


/* ============================================================
   19. TEAM GOALS
   ============================================================ */

function parseTeamGoals(content) {

    const result = {};

    const lines =
        content.split("\n");

    let currentTeam = null;


    for (const line of lines) {

        const normalized =
            normalizeSectionName(line);


        if (
            normalized.includes(
                "TOTAL1"
            )
        ) {

            currentTeam = "HOME";

            continue;
        }


        if (
            normalized.includes(
                "TOTAL2"
            )
        ) {

            currentTeam = "AWAY";

            continue;
        }


        const parsed =
            parseThresholdOddsLine(line);


        if (
            parsed &&
            currentTeam
        ) {

            if (!result[currentTeam]) {
                result[currentTeam] = {};
            }

            result[currentTeam][
                parsed.label
            ] = parsed.odds;
        }
    }


    return result;
}



/* ============================================================
   20. TOTAL GOALS
   ============================================================ */

function parseTotalGoals(content) {

    const result = {};

    const lines =
        content.split("\n");


    for (const line of lines) {

        const parsed =
            parseThresholdOddsLine(line);


        if (!parsed) {
            continue;
        }


        result[
            parsed.label
        ] = parsed.odds;
    }


    return result;
}


/* ============================================================
   21. THRESHOLD ODDS
   ============================================================ */

function parseThresholdOddsLine(line) {

    /*
     * Examples:
     *
     * (1.5) Plus de : 1.13
     * (2.5) Moins de : 2.37
     */

    const match =
        line.match(
            /^\s*\(([^)]+)\)\s*(.+?)\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i
        );


    if (!match) {
        return null;
    }


    const threshold =
        match[1].trim();


    const label =
        normalizeMarketLabel(
            match[2]
        );


    const odds =
        parseDecimal(
            match[3]
        );


    if (odds === null) {
        return null;
    }


    return {

        label:
            `${threshold}_${label}`,

        threshold,

        marketLabel:
            label,

        odds
    };
}


/* ============================================================
   22. HANDICAP
   ============================================================ */

function parseHandicap(content) {

    const result = {};

    const lines =
        content.split("\n");


    for (const line of lines) {

        const match =
            line.match(
                /^\s*([12])\s*\(([-+]?[0-9]+(?:[.,][0-9]+)?)\)\s*:\s*([0-9]+(?:[.,][0-9]+)?)/
            );


        if (!match) {
            continue;
        }


        const team =
            match[1] === "1"
                ? "HOME"
                : "AWAY";


        const handicap =
            parseDecimal(
                match[2]
            );


        const odds =
            parseDecimal(
                match[3]
            );


        if (
            handicap === null ||
            odds === null
        ) {
            continue;
        }


        const key =
            `${team}_${formatNumberKey(handicap)}`;


        result[key] = {

            team,

            handicap,

            odds
        };
    }


    return result;
}


/* ============================================================
   23. HALF / FULL
   ============================================================ */

function parseHalfFull(content) {

    const result = {};

    const lines =
        content.split("\n");


    for (const line of lines) {

        const match =
            line.match(
                /^\s*(V1|X|V2)\s*\/\s*(V1|X|V2)\s*:\s*([0-9]+(?:[.,][0-9]+)?)/
            );


        if (!match) {
            continue;
        }


        const odds =
            parseDecimal(
                match[3]
            );


        if (odds === null) {
            continue;
        }


        const key =
            `${match[1]}_${match[2]}`;


        result[key] =
            odds;
    }


    return result;
}


/* ============================================================
   24. EXACT SCORE
   ============================================================ */

function parseExactScore(content) {

    const result = {};

    const lines =
        content.split("\n");


    for (const line of lines) {

        /*
         * Handles:
         *
         * 1-0 : 17
         * 0-1 : 8.01
         */

        const regex =
            /(\d+)\s*-\s*(\d+)\s*:\s*([0-9]+(?:[.,][0-9]+)?)/g;


        let match;


        while (
            (match = regex.exec(line)) !== null
        ) {

            const home =
                Number(match[1]);

            const away =
                Number(match[2]);

            const odds =
                parseDecimal(match[3]);


            if (odds === null) {
                continue;
            }


            result[
                `${home}-${away}`
            ] = odds;
        }
    }


    return result;
}




/* ============================================================
   25. NEXT GOAL
   ============================================================ */

function parseNextGoal(content) {

    const result = {};

    const lines =
        content.split("\n");


    for (const line of lines) {

        const separatorIndex =
            line.indexOf(":");


        if (separatorIndex === -1) {
            continue;
        }


        const label =
            line
                .slice(0, separatorIndex)
                .trim();


        const value =
            parseDecimal(
                line
                    .slice(separatorIndex + 1)
                    .trim()
            );


        if (
            label &&
            value !== null
        ) {

            result[
                normalizeMarketLabel(label)
            ] = value;
        }
    }


    return result;
}


/* ============================================================
   26. EXACT TOTAL GOALS
   ============================================================ */

function parseExactTotal(content) {

    const result = {};

    const lines =
        content.split("\n");


    for (const line of lines) {

        const match =
            line.match(
                /^\s*\((\d+)\)\s*:\s*([0-9]+(?:[.,][0-9]+)?)/ 
            );


        if (!match) {
            continue;
        }


        const goals =
            Number(match[1]);


        const odds =
            parseDecimal(
                match[2]
            );


        if (odds === null) {
            continue;
        }


        result[
            String(goals)
        ] = odds;
    }


    return result;
}


/* ============================================================
   27. LABEL NORMALIZATION
   ============================================================ */

function normalizeMarketLabel(label) {

    return String(label)
        .normalize("NFD")
        .replace(
            /[\u0300-\u036f]/g,
            ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim()
        .toUpperCase()
        .replace(
            /\s+/g,
            "_"
        );
}


/* ============================================================
   28. DECIMAL PARSER
   ============================================================ */

function parseDecimal(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }


    const cleaned =
        String(value)
            .replace(",", ".")
            .replace(
                /[^0-9.+-]/g,
                ""
            );


    if (!cleaned) {
        return null;
    }


    const number =
        Number(cleaned);


    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {
        return null;
    }


    return number;
}


/* ============================================================
   29. TEAM NAME CLEANING
   ============================================================ */

function cleanTeamName(name) {

    if (!name) {
        return null;
    }


    return String(name)
        .replace(/\s+/g, " ")
        .trim();
}


/* ============================================================
   30. NUMBER KEY
   ============================================================ */

function formatNumberKey(value) {

    const number =
        Number(value);


    if (!Number.isFinite(number)) {
        return String(value);
    }


    return number
        .toString()
        .replace(
            ".0",
            ""
        );
}


/* ============================================================
   31. MATCH LINE HEURISTIC
   ============================================================ */

function looksLikeScoreLine(line) {

    return (
        /^\s*\d+\s*:\s*\d+\s*$/.test(line)
    );
}


/* ============================================================
   32. PUBLIC PARSER UTILITIES
   ============================================================ */

export const parserUtils = {

    parseDecimal,

    normalizeMarketLabel,

    normalizeSectionName,

    cleanTeamName,

    parseDateTime,

    combineDateTime
};


/* ============================================================
   END OF parser.js
   ============================================================ */