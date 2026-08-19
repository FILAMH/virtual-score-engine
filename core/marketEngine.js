/**
 * ============================================================
 * VIRTUAL SCORE ENGINE
 * core/marketEngine.js
 * ============================================================
 *
 * RÔLE :
 * Transformer les marchés déjà normalisés (normalizer.js) en
 * signaux probabilistes exploitables.
 *
 * Chaque cote normalisée a la forme :
 *   { odd, impliedProbability, logOdd }
 * et chaque clé de groupe est en minuscules
 * (normalizer.normalizeMarketKey).
 * ============================================================
 */

'use strict';

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 6) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function normalizeProbabilities(probabilities) {
    const values = Object.entries(probabilities);
    const sum = values.reduce(
        (acc, [, value]) => acc + Math.max(0, safeNumber(value)),
        0
    );

    if (sum <= Number.EPSILON) {
        return Object.fromEntries(values.map(([key]) => [key, 0]));
    }

    return Object.fromEntries(
        values.map(([key, value]) => [
            key,
            round(Math.max(0, safeNumber(value)) / sum)
        ])
    );
}

/**
 * Lit une entrée de marché normalisée { odd, impliedProbability }
 * en essayant plusieurs clés candidates (déjà en minuscules).
 */
function readEntry(group, keys) {
    if (!group || typeof group !== 'object') {
        return null;
    }

    for (const key of keys) {
        const entry = group[key];

        if (entry && Number.isFinite(entry.odd)) {
            return entry;
        }
    }

    return null;
}

function entryOdd(entry) {
    return entry ? entry.odd : null;
}

function entryProbability(entry) {
    return entry ? entry.impliedProbability : 0;
}


/* ============================================================
 * 1X2
 * ============================================================ */

function analyze1X2(match) {
    const group = match?.markets?.oneXTwo ?? {};

    const homeEntry = readEntry(group, ['v1', 'home', '1']);
    const drawEntry = readEntry(group, ['x', 'draw']);
    const awayEntry = readEntry(group, ['v2', 'away', '2']);

    const raw = {
        HOME: entryProbability(homeEntry),
        DRAW: entryProbability(drawEntry),
        AWAY: entryProbability(awayEntry)
    };

    const normalized = normalizeProbabilities(raw);

    return {
        odds: {
            home: entryOdd(homeEntry),
            draw: entryOdd(drawEntry),
            away: entryOdd(awayEntry)
        },

        rawProbability: {
            home: round(raw.HOME),
            draw: round(raw.DRAW),
            away: round(raw.AWAY)
        },

        probability: {
            home: normalized.HOME,
            draw: normalized.DRAW,
            away: normalized.AWAY
        },

        margin: round(raw.HOME + raw.DRAW + raw.AWAY - 1),

        favorite: normalized.HOME >= normalized.AWAY ? 'HOME' : 'AWAY',

        favoriteProbability: Math.max(normalized.HOME, normalized.AWAY),

        directionGap: round(Math.abs(normalized.HOME - normalized.AWAY))
    };
}


/* ============================================================
 * DOUBLE CHANCE
 * ============================================================ */

function analyzeDoubleChance(match) {
    const group = match?.markets?.doubleChance ?? {};

    const raw = {
        '1X': entryProbability(readEntry(group, ['1x'])),
        '12': entryProbability(readEntry(group, ['12'])),
        '2X': entryProbability(readEntry(group, ['2x']))
    };

    return {
        odds: {
            '1X': entryOdd(readEntry(group, ['1x'])),
            '12': entryOdd(readEntry(group, ['12'])),
            '2X': entryOdd(readEntry(group, ['2x']))
        },
        probability: normalizeProbabilities(raw)
    };
}


/* ============================================================
 * BTTS
 * ============================================================ */

function analyzeBTTS(match) {
    const group = match?.markets?.btts ?? {};

    const yesEntry = readEntry(group, ['oui', 'yes']);
    const noEntry = readEntry(group, ['non', 'no']);

    const raw = {
        YES: entryProbability(yesEntry),
        NO: entryProbability(noEntry)
    };

    const normalized = normalizeProbabilities(raw);

    return {
        odds: {
            yes: entryOdd(yesEntry),
            no: entryOdd(noEntry)
        },
        probability: {
            yes: normalized.YES,
            no: normalized.NO
        },
        yesProbability: normalized.YES,
        noProbability: normalized.NO,
        signal: normalized.YES >= normalized.NO ? 'BTTS_YES' : 'BTTS_NO'
    };
}


/* ============================================================
 * TOTAUX — utilitaire générique (match, équipe 1, équipe 2)
 * ============================================================
 *
 * Les clés du groupe normalisé ont la forme :
 *   "1.5_plus_de", "2.5_moins_de", etc.
 * (threshold_label, cf. parser.parseThresholdOddsLine, puis
 * lowercase par normalizer.normalizeMarketKey)
 *
 * On regroupe par seuil numérique et on classe over/under selon
 * le texte du label.
 */

function analyzeTotalsGeneric(group) {
    const lines = {};

    for (const [key, entry] of Object.entries(group || {})) {
        if (!entry || !Number.isFinite(entry.odd)) {
            continue;
        }

        const match = key.match(/^([0-9.]+)_(.+)$/);

        if (!match) {
            continue;
        }

        const line = Number(match[1]);
        const label = match[2];

        const isOver =
            label.includes('plus') ||
            label.includes('over') ||
            label.includes('>');

        const isUnder =
            label.includes('moins') ||
            label.includes('under') ||
            label.includes('<');

        if (!isOver && !isUnder) {
            continue;
        }

        if (!lines[line]) {
            lines[line] = { over: null, under: null };
        }

        if (isOver) {
            lines[line].over = entry;
        } else {
            lines[line].under = entry;
        }
    }

    const result = {};

    for (const [line, sides] of Object.entries(lines)) {
        const raw = {
            over: entryProbability(sides.over),
            under: entryProbability(sides.under)
        };

        const probability = normalizeProbabilities(raw);

        result[line] = {
            odds: {
                over: entryOdd(sides.over),
                under: entryOdd(sides.under)
            },
            probability,
            overProbability: probability.over,
            underProbability: probability.under,
            margin: round(raw.over + raw.under - 1)
        };
    }

    /*
     * Raccourcis plats pour les seuils standards, utilisés par
     * regimeEngine.js et upsetEngine.js sans qu'ils aient besoin
     * de connaître la structure indexée par ligne.
     */
    for (const threshold of [0.5, 1.5, 2.5, 3.5, 4.5]) {
        const key = String(threshold).replace('.', '');
        const line = result[threshold];

        result[`over${key}Probability`] = line ? line.overProbability : 0;
        result[`under${key}Probability`] = line ? line.underProbability : 0;
    }

    return result;
}

function analyzeTotals(match) {
    return analyzeTotalsGeneric(match?.markets?.matchTotals);
}

function analyzeTeamTotals(match) {
    return {
        home: analyzeTotalsGeneric(match?.markets?.team1Totals),
        away: analyzeTotalsGeneric(match?.markets?.team2Totals)
    };
}


/* ============================================================
 * HANDICAP
 * ============================================================
 *
 * Clés normalisées : "home_-1", "away_1", etc.
 * (team_handicap, cf. parser.parseHandicap, lowercase ensuite)
 */

function analyzeHandicap(match) {
    const group = match?.markets?.handicap ?? {};

    /*
     * Le parser encode chaque ligne de handicap en miroir :
     * "home_1" (Domicile +1) et "away_-1" (Extérieur -1) sont
     * DEUX vues de LA MÊME ligne de marché, pas deux lignes
     * différentes. On les apparie par magnitude opposée
     * (home = h  <->  away = -h), sauf pour h = 0 où les deux
     * clés coïncident déjà ("home_0" / "away_0").
     */

    const homeEntries = {};
    const awayEntries = {};

    for (const [key, entry] of Object.entries(group)) {
        if (!entry || !Number.isFinite(entry.odd)) {
            continue;
        }

        const match2 = key.match(/^(home|away)_(-?[0-9.]+)$/);

        if (!match2) {
            continue;
        }

        const team = match2[1];
        const handicap = Number(match2[2]);

        if (team === 'home') {
            homeEntries[handicap] = entry;
        } else {
            awayEntries[handicap] = entry;
        }
    }

    const result = {};

    for (const [handicapKey, homeEntry] of Object.entries(homeEntries)) {
        const handicap = Number(handicapKey);

        const mirrorEntry =
            awayEntries[-handicap] ??
            awayEntries[handicap] ??
            null;

        const raw = {
            home: entryProbability(homeEntry),
            away: entryProbability(mirrorEntry)
        };

        const probability = normalizeProbabilities(raw);

        result[handicapKey] = {
            odds: {
                home: entryOdd(homeEntry),
                away: entryOdd(mirrorEntry)
            },
            probability: {
                home: probability.home,
                away: probability.away
            },
            gap: round(probability.home - probability.away)
        };
    }

    return result;
}


/* ============================================================
 * "VA MARQUER" — team1ToScore / team2ToScore combinés
 * ============================================================ */

function analyzeTeamScoring(match) {
    const homeGroup = match?.markets?.team1ToScore ?? {};
    const awayGroup = match?.markets?.team2ToScore ?? {};

    const homeYes = entryProbability(readEntry(homeGroup, ['oui', 'yes']));
    const awayYes = entryProbability(readEntry(awayGroup, ['oui', 'yes']));

    const total = homeYes + awayYes;

    return {
        odds: {
            home: entryOdd(readEntry(homeGroup, ['oui', 'yes'])),
            away: entryOdd(readEntry(awayGroup, ['oui', 'yes']))
        },
        rawProbability: {
            home: round(homeYes),
            away: round(awayYes)
        },
        relativeProbability: {
            home: total > 0 ? round(homeYes / total) : 0,
            away: total > 0 ? round(awayYes / total) : 0
        }
    };
}


/* ============================================================
 * "2 VA MARQUER"
 * ============================================================
 *
 * NOTE : ce marché ("chaque équipe marque 2 buts ou plus",
 * section 7 du cahier des charges) n'a pas de section dédiée
 * dans parser.js (SECTION_NAMES ne le liste pas). Cette fonction
 * reste donc défensive et retournera des zéros tant que le
 * parser n'aura pas été étendu pour capturer ce marché — c'est
 * un ajout de fonctionnalité, pas un bug de cette couche.
 */

function analyzeTwoPlusGoals(match) {
    const group = match?.markets?.twoPlusGoals ?? {};

    /*
     * Marché réel observé : "Chaque équipe va marquer (2) Ou Plus"
     * est un Oui/Non GLOBAL (une seule paire de cotes), pas deux
     * cotes séparées par équipe. On le traite donc comme BTTS.
     */
    const yesEntry = readEntry(group, ['oui', 'yes']);
    const noEntry = readEntry(group, ['non', 'no']);

    const raw = {
        YES: entryProbability(yesEntry),
        NO: entryProbability(noEntry)
    };

    const normalized = normalizeProbabilities(raw);

    return {
        odds: {
            yes: entryOdd(yesEntry),
            no: entryOdd(noEntry)
        },
        probability: {
            yes: normalized.YES,
            no: normalized.NO
        },
        yesProbability: normalized.YES,
        noProbability: normalized.NO
    };
}


/* ============================================================
 * NOMBRE EXACT
 * ============================================================ */

function analyzeExactTotal(match) {
    const group = match?.markets?.exactTotalGoals ?? {};

    const probabilities = {};

    for (const [goals, entry] of Object.entries(group)) {
        const p = entryProbability(entry);
        if (p > 0) {
            probabilities[goals] = p;
        }
    }

    const normalized = normalizeProbabilities(probabilities);

    let mostLikelyGoals = null;
    let highestProbability = -1;

    for (const [goals, probability] of Object.entries(normalized)) {
        if (probability > highestProbability) {
            highestProbability = probability;
            mostLikelyGoals = Number(goals);
        }
    }

    return {
        probability: normalized,
        mostLikelyGoals,
        mostLikelyProbability:
            highestProbability >= 0 ? round(highestProbability) : 0
    };
}


/* ============================================================
 * MT-FIN
 * ============================================================ */

function analyzeHalfTimeFullTime(match) {
    const group = match?.markets?.halfTimeFullTime ?? {};

    const probabilities = {};

    for (const [key, entry] of Object.entries(group)) {
        const p = entryProbability(entry);
        if (p > 0) {
            probabilities[key] = p;
        }
    }

    const normalized = normalizeProbabilities(probabilities);

    let strongest = null;
    let strongestProbability = -1;

    for (const [key, probability] of Object.entries(normalized)) {
        if (probability > strongestProbability) {
            strongestProbability = probability;
            strongest = key;
        }
    }

    return {
        probability: normalized,
        strongestOutcome: strongest,
        strongestProbability:
            strongestProbability >= 0 ? round(strongestProbability) : 0
    };
}


/* ============================================================
 * PREMIER BUT
 * ============================================================ */

function analyzeFirstGoal(match) {
    const group = match?.markets?.firstGoalTime ?? {};

    const result = {};

    for (const [key, entry] of Object.entries(group)) {
        const p = entryProbability(entry);
        if (p > 0) {
            result[key] = p;
        }
    }

    return { probability: normalizeProbabilities(result) };
}


/* ============================================================
 * SCORE EXACT
 * ============================================================ */

function analyzeExactScores(match) {
    const group = match?.markets?.exactScore ?? {};

    const raw = {};

    for (const [score, entry] of Object.entries(group)) {
        const p = entryProbability(entry);
        if (p > 0) {
            raw[score] = p;
        }
    }

    const normalized = normalizeProbabilities(raw);

    const ranked = Object.entries(normalized)
        .sort((a, b) => b[1] - a[1])
        .map(([score, probability]) => ({ score, probability: round(probability) }));

    return { probability: normalized, ranking: ranked };
}


/* ============================================================
 * CONFLITS DE MARCHÉ (inchangé)
 * ============================================================ */

function calculateMarketConflicts(analysis) {
    const conflicts = {};

    const p1 = analysis.oneXTwo?.probability?.home ?? 0;
    const px = analysis.oneXTwo?.probability?.draw ?? 0;
    const p2 = analysis.oneXTwo?.probability?.away ?? 0;

    const bttsYes = analysis.btts?.probability?.yes ?? 0;
    const bttsNo = analysis.btts?.probability?.no ?? 0;

    /*
     * twoPlusGoals est désormais un Oui/Non global (pas par
     * équipe) — on ne peut plus en tirer un signal directionnel
     * home/away distinct, donc ces deux conflits perdent leur
     * sens tel quels et sont neutralisés plutôt que de comparer
     * des grandeurs qui n'existent plus.
     */
    conflicts.awayScoringVsWin = 0;

    conflicts.homeScoringVsWin = 0;

    /*
     * BTTS conflict.
     */
    conflicts.bttsConflict =
        round(
            Math.abs(
                bttsYes -
                (1 - bttsNo)
            )
        );

    /*
     * Draw pressure.
     */
    conflicts.drawPressure =
        round(px);

    /*
     * Directional conflict :
     * écart entre la force du favori 1X2 et le signal global
     * "chaque équipe marque 2+" (Oui = match ouvert/déséquilibré
     * possible, Non = match plus fermé). twoPlusHome/twoPlusAway
     * n'existent plus (marché global, pas par équipe) — on utilise
     * désormais yesProbability comme proxy d'ouverture du match.
     */
    const twoPlusOpenness =
        analysis.twoPlusGoals?.yesProbability ?? 0;

    conflicts.directionalConflict =
        round(
            Math.abs(
                p1 -
                p2
            ) *
            (
                1 -
                twoPlusOpenness
            )
        );

    return conflicts;
}


/* ============================================================
 * INDICE GLOBAL DE DOMINATION (inchangé)
 * ============================================================ */

function calculateDirectionSignal(analysis) {
    const pHome = analysis.oneXTwo?.probability?.home ?? 0;
    const pAway = analysis.oneXTwo?.probability?.away ?? 0;

    const handicap = analysis.handicap ?? {};

    let handicapSignal = 0;
    let handicapCount = 0;

    for (const values of Object.values(handicap)) {
        const home = values?.probability?.home;
        const away = values?.probability?.away;

        if (Number.isFinite(home) && Number.isFinite(away)) {
            handicapSignal += away - home;
            handicapCount++;
        }
    }

    if (handicapCount > 0) {
        handicapSignal /= handicapCount;
    }

    const baseSignal = pAway - pHome;

    const combined = 0.65 * baseSignal + 0.35 * handicapSignal;

    return {
        home: round(clamp(0.5 - combined / 2)),
        away: round(clamp(0.5 + combined / 2)),
        raw: round(combined)
    };
}


/* ============================================================
 * ANALYSE COMPLÈTE DU MARCHÉ
 * ============================================================ */

function analyzeMarket(match) {
    const oneXTwo = analyze1X2(match);
    const doubleChance = analyzeDoubleChance(match);
    const btts = analyzeBTTS(match);
    const totals = analyzeTotals(match);
    const handicap = analyzeHandicap(match);
    const teamScoring = analyzeTeamScoring(match);
    const twoPlusGoals = analyzeTwoPlusGoals(match);
    const exactTotal = analyzeExactTotal(match);
    const halfTimeFullTime = analyzeHalfTimeFullTime(match);
    const firstGoal = analyzeFirstGoal(match);
    const teamTotals = analyzeTeamTotals(match);
    const exactScores = analyzeExactScores(match);

    const analysis = {
        oneXTwo,
        doubleChance,
        btts,
        totals,
        handicap,
        teamScoring,
        twoPlusGoals,
        exactTotal,
        halfTimeFullTime,
        firstGoal,
        teamTotals,
        exactScores
    };

    const conflicts = calculateMarketConflicts(analysis);
    const direction = calculateDirectionSignal(analysis);

    return {
        ...analysis,
        conflicts,
        direction,
        metadata: {
            analyzedAt: new Date().toISOString(),
            source: 'PRE_MATCH_MARKET'
        }
    };
}

export {
    safeNumber,
    clamp,
    round,
    normalizeProbabilities,
    analyze1X2,
    analyzeDoubleChance,
    analyzeBTTS,
    analyzeTotals,
    analyzeHandicap,
    analyzeTeamScoring,
    analyzeTwoPlusGoals,
    analyzeExactTotal,
    analyzeHalfTimeFullTime,
    analyzeFirstGoal,
    analyzeTeamTotals,
    analyzeExactScores,
    calculateMarketConflicts,
    calculateDirectionSignal,
    analyzeMarket
};