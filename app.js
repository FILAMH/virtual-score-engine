/* ============================================================
   VIRTUAL SCORE ENGINE
   app.js
   ------------------------------------------------------------
   Application orchestrator.

   RESPONSIBILITIES:
   - Read data from the HTML interface.
   - Validate user input.
   - Parse historical matches.
   - Parse the current pre-match event.
   - Prepare the prediction request.
   - Call the prediction engine.
   - Display the Top 3 predictions.
   - Display diagnostics returned by the engine.

   IMPORTANT:
   This file contains NO prediction mathematics.
   Mathematical logic belongs to /core and /models.
   ============================================================ */

import {
    parseHistoricalMatches,
    parseCurrentMatch
} from "./core/parser.js";

import {
    normalizeHistoricalMatches,
    normalizeCurrentMatch
} from "./core/normalizer.js";

import {
    buildHistoricalFeatures,
    buildCurrentMatchFeatures
} from "./core/featureEngine.js";

import {
    generatePrediction
} from "./core/predictionEngine.js";

import {
    validateHistoricalData,
    validateCurrentMatch
} from "./utils/validation.js";

import {
    evaluatePrediction,
    evaluateBatch,
    checkSevenOfTen
} from "./core/evaluator.js";


/* ============================================================
   1. APPLICATION STATE
   ============================================================ */

const state = {
    historicalRaw: "",
    currentMatchRaw: "",

    historicalMatches: [],
    currentMatch: null,

    historicalFeatures: [],
    currentMatchFeatures: null,

    historyValid: false,
    matchValid: false,

    prediction: null,

    isAnalyzing: false,

    /*
     * Historique cumulé des évaluations (résultat réel vs
     * prédiction) sur la série de matchs en cours.
     */
    evaluations: []
};


/* ============================================================
   2. DOM REFERENCES
   ============================================================ */

const DOM = {
    historyInput: document.getElementById("history-input"),
    matchInput: document.getElementById("match-input"),

    validateHistoryBtn:
        document.getElementById("validate-history-btn"),

    validateMatchBtn:
        document.getElementById("validate-match-btn"),

    analyzeBtn:
        document.getElementById("analyze-btn"),

    historyBadge:
        document.getElementById("history-badge"),

    matchBadge:
        document.getElementById("match-badge"),

    historyValidation:
        document.getElementById("history-validation"),

    matchValidation:
        document.getElementById("match-validation"),

    analysisStatus:
        document.getElementById("analysis-status"),

    predictionPanel:
        document.getElementById("prediction-panel"),

    predictionRegime:
        document.getElementById("prediction-regime"),

    resultHomeTeam:
        document.getElementById("result-home-team"),

    resultAwayTeam:
        document.getElementById("result-away-team"),

    predictedDirection:
        document.getElementById("predicted-direction"),

    directionExplanation:
        document.getElementById("direction-explanation"),

    predictionScore1:
        document.getElementById("prediction-score-1"),

    predictionScore2:
        document.getElementById("prediction-score-2"),

    predictionScore3:
        document.getElementById("prediction-score-3"),

    predictionProbability1:
        document.getElementById("prediction-probability-1"),

    predictionProbability2:
        document.getElementById("prediction-probability-2"),

    predictionProbability3:
        document.getElementById("prediction-probability-3"),

    predictionConfidence:
        document.getElementById("prediction-confidence"),

    historicalSimilarity:
        document.getElementById("historical-similarity"),

    lambdaHome:
        document.getElementById("lambda-home"),

    lambdaAway:
        document.getElementById("lambda-away"),

    memoryWeight:
        document.getElementById("memory-weight"),

    upsetProbability:
        document.getElementById("upset-probability"),

    engineMessage:
        document.getElementById("engine-message"),

    globalError:
        document.getElementById("global-error"),

    systemStatus:
        document.getElementById("system-status-text"),

    actualHomeScore:
        document.getElementById("actual-home-score"),

    actualAwayScore:
        document.getElementById("actual-away-score"),

    evaluateBtn:
        document.getElementById("evaluate-btn"),

    evaluationResult:
        document.getElementById("evaluation-result"),

    performanceBadge:
        document.getElementById("performance-badge"),

    performanceTop3Rate:
        document.getElementById("performance-top3-rate"),

    performanceDirectionRate:
        document.getElementById("performance-direction-rate"),

    performanceTarget:
        document.getElementById("performance-target"),

    resetPerformanceBtn:
        document.getElementById("reset-performance-btn")
};


/* ============================================================
   3. INITIALIZATION
   ============================================================ */

document.addEventListener("DOMContentLoaded", initializeApplication);


function initializeApplication() {

    bindEvents();

    updateSystemStatus("Ready");

    updateHistoryBadge();

    updateMatchBadge();

    updateAnalyzeButton();

    hidePrediction();

    loadEvaluations();

    updatePerformancePanel();

    console.info(
        "[Virtual Score Engine] Application initialized."
    );
}


/* ============================================================
   4. EVENT LISTENERS
   ============================================================ */

function bindEvents() {

    DOM.validateHistoryBtn.addEventListener(
        "click",
        handleHistoryValidation
    );

    DOM.validateMatchBtn.addEventListener(
        "click",
        handleMatchValidation
    );

    DOM.analyzeBtn.addEventListener(
        "click",
        handleAnalysis
    );

    DOM.evaluateBtn.addEventListener(
        "click",
        handleEvaluate
    );

    DOM.resetPerformanceBtn.addEventListener(
        "click",
        handleResetPerformance
    );


    /*
     * We also monitor text changes.
     * This does NOT run the prediction engine.
     * It only updates the interface state.
     */

    DOM.historyInput.addEventListener(
        "input",
        handleHistoryInputChange
    );

    DOM.matchInput.addEventListener(
        "input",
        handleMatchInputChange
    );
}


/* ============================================================
   5. HISTORY INPUT
   ============================================================ */

function handleHistoryInputChange() {

    state.historicalRaw =
        DOM.historyInput.value.trim();

    state.historyValid = false;
    state.historicalMatches = [];
    state.historicalFeatures = [];

    clearValidation(DOM.historyValidation);

    updateHistoryBadge();

    updateAnalyzeButton();

    hidePrediction();
}


function updateHistoryBadge() {

    const text =
        state.historicalRaw.trim();

    if (!text) {

        DOM.historyBadge.textContent =
            "0 matches";

        return;
    }

    /*
     * We do not pretend to know the exact number
     * before the parser has validated the content.
     */

    if (state.historicalMatches.length > 0) {

        DOM.historyBadge.textContent =
            `${state.historicalMatches.length} matches`;

        return;
    }

    DOM.historyBadge.textContent =
        "Data entered";
}


/* ============================================================
   6. HISTORY VALIDATION
   ============================================================ */

function handleHistoryValidation() {

    clearGlobalError();

    const raw =
        DOM.historyInput.value.trim();

    state.historicalRaw = raw;

    if (!raw) {

        state.historyValid = false;

        showValidation(
            DOM.historyValidation,
            "error",
            "No historical data was entered."
        );

        updateAnalyzeButton();

        return;
    }


    try {

        updateSystemStatus("Parsing history...");

        const parsed =
            parseHistoricalMatches(raw);


        if (!Array.isArray(parsed)) {
            throw new Error(
                "Historical parser returned an invalid structure."
            );
        }


        const validation =
            validateHistoricalData(parsed);


        if (!validation.valid) {

            state.historyValid = false;

            showValidation(
                DOM.historyValidation,
                "error",
                validation.message ||
                "Historical data validation failed."
            );

            updateSystemStatus("History error");

            updateAnalyzeButton();

            return;
        }


        /*
         * Normalize only after successful validation.
         */

        const normalized =
            normalizeHistoricalMatches(parsed);


        if (!Array.isArray(normalized) ||
            normalized.length === 0) {

            throw new Error(
                "No valid historical matches remained after normalization."
            );
        }


        /*
         * Build features used by the historical engine.
         */

        const features =
            buildHistoricalFeatures(normalized);


        state.historicalMatches =
            normalized;

        state.historicalFeatures =
            features;

        state.historyValid = true;


        showValidation(
            DOM.historyValidation,
            "success",
            buildHistorySuccessMessage(
                normalized.length
            )
        );


        updateHistoryBadge();

        updateSystemStatus("History ready");

        updateAnalyzeButton();

    } catch (error) {

        state.historyValid = false;

        state.historicalMatches = [];
        state.historicalFeatures = [];

        updateSystemStatus("History error");

        showValidation(
            DOM.historyValidation,
            "error",
            `Historical data could not be processed: ${safeErrorMessage(error)}`
        );

        updateAnalyzeButton();

        console.error(
            "[History Validation Error]",
            error
        );
    }
}


/* ============================================================
   7. CURRENT MATCH INPUT
   ============================================================ */

function handleMatchInputChange() {

    state.currentMatchRaw =
        DOM.matchInput.value.trim();

    state.matchValid = false;
    state.currentMatch = null;
    state.currentMatchFeatures = null;

    clearValidation(DOM.matchValidation);

    updateMatchBadge();

    updateAnalyzeButton();

    hidePrediction();
}


function updateMatchBadge() {

    if (!state.currentMatchRaw) {

        DOM.matchBadge.textContent =
            "No event";

        return;
    }

    if (state.currentMatch) {

        DOM.matchBadge.textContent =
            "Event ready";

        return;
    }

    DOM.matchBadge.textContent =
        "Data entered";
}


/* ============================================================
   8. CURRENT MATCH VALIDATION
   ============================================================ */

function handleMatchValidation() {

    clearGlobalError();

    const raw =
        DOM.matchInput.value.trim();

    state.currentMatchRaw = raw;

    if (!raw) {

        state.matchValid = false;

        showValidation(
            DOM.matchValidation,
            "error",
            "No current event was entered."
        );

        updateAnalyzeButton();

        return;
    }


    try {

        updateSystemStatus("Parsing event...");

        const parsed =
            parseCurrentMatch(raw);


        if (!parsed ||
            typeof parsed !== "object") {

            throw new Error(
                "Current event parser returned an invalid structure."
            );
        }


        const validation =
            validateCurrentMatch(parsed);


        if (!validation.valid) {

            state.matchValid = false;

            showValidation(
                DOM.matchValidation,
                "error",
                validation.message ||
                "Current event validation failed."
            );

            updateSystemStatus("Event error");

            updateAnalyzeButton();

            return;
        }


        /*
         * Normalize the current event.
         */

        const normalized =
            normalizeCurrentMatch(parsed);


        if (!normalized) {

            throw new Error(
                "Current event normalization failed."
            );
        }


        /*
         * Build the market feature vector.
         */

        const features =
            buildCurrentMatchFeatures(normalized);


        state.currentMatch =
            normalized;

        state.currentMatchFeatures =
            features;

        state.matchValid = true;


        showValidation(
            DOM.matchValidation,
            "success",
            buildMatchSuccessMessage(normalized)
        );


        updateMatchBadge();

        updateSystemStatus("Event ready");

        updateAnalyzeButton();

    } catch (error) {

        state.matchValid = false;

        state.currentMatch = null;
        state.currentMatchFeatures = null;

        updateSystemStatus("Event error");

        showValidation(
            DOM.matchValidation,
            "error",
            `Event could not be processed: ${safeErrorMessage(error)}`
        );

        updateAnalyzeButton();

        console.error(
            "[Current Match Validation Error]",
            error
        );
    }
}


/* ============================================================
   9. ANALYSIS BUTTON STATE
   ============================================================ */

function updateAnalyzeButton() {

    const ready =
        state.historyValid &&
        state.matchValid &&
        !state.isAnalyzing;

    DOM.analyzeBtn.disabled =
        !ready;
}


/* ============================================================
   10. MAIN ANALYSIS
   ============================================================ */

async function handleAnalysis() {

    if (state.isAnalyzing) {
        return;
    }


    clearGlobalError();


    /*
     * Safety check.
     *
     * The button should already be disabled when the data
     * is invalid, but we verify again before calling the
     * prediction engine.
     */

    if (!state.historyValid) {

        showGlobalError(
            "Historical data must be validated before analysis."
        );

        return;
    }


    if (!state.matchValid) {

        showGlobalError(
            "The new event must be validated before analysis."
        );

        return;
    }


    if (!state.historicalMatches.length) {

        showGlobalError(
            "No valid historical matches are available."
        );

        return;
    }


    if (!state.currentMatch) {

        showGlobalError(
            "No valid current event is available."
        );

        return;
    }


    state.isAnalyzing = true;

    updateAnalyzeButton();

    hidePrediction();


    try {

        setAnalysisStatus(
            "Analyzing historical memory and market structure..."
        );

        updateSystemStatus("Analyzing");


        /*
         * --------------------------------------------------------
         * PREDICTION REQUEST
         * --------------------------------------------------------
         *
         * We pass both raw normalized information and features.
         *
         * The prediction engine is responsible for:
         *
         * historical similarity
         * market interpretation
         * direction
         * regime
         * upset detection
         * lambda estimation
         * probability distributions
         * memory fusion
         * score ranking
         *
         * app.js does NOT modify those mathematical results.
         */

        const request = {

            currentMatch:
                state.currentMatch,

            currentFeatures:
                state.currentMatchFeatures,

            historicalMatches:
                state.historicalMatches,

            historicalFeatures:
                state.historicalFeatures

        };


        const result =
            await generatePrediction(request);


        /*
         * Validate the engine output before displaying it.
         */

        validatePredictionOutput(result);


        state.prediction =
            result;


        displayPrediction(result);


        setAnalysisStatus(
            "Analysis completed successfully."
        );

        updateSystemStatus("Analysis complete");


    } catch (error) {

        state.prediction = null;

        updateSystemStatus("Analysis error");

        setAnalysisStatus(
            "Analysis failed."
        );

        showGlobalError(
            `Prediction failed: ${safeErrorMessage(error)}`
        );

        console.error(
            "[Prediction Engine Error]",
            error
        );

    } finally {

        state.isAnalyzing = false;

        updateAnalyzeButton();
    }
}


/* ============================================================
   11. PREDICTION OUTPUT VALIDATION
   ============================================================ */

function validatePredictionOutput(result) {

    if (!result ||
        typeof result !== "object") {

        throw new Error(
            "Prediction engine returned no valid result."
        );
    }


    if (!Array.isArray(result.top3)) {

        throw new Error(
            "Prediction engine did not return a Top 3 list."
        );
    }


    /*
     * Top 3 is a mandatory requirement of the system.
     */

    if (result.top3.length !== 3) {

        throw new Error(
            `Prediction engine returned ${result.top3.length} scores. Exactly 3 scores are required.`
        );
    }


    for (let i = 0; i < 3; i++) {

        const prediction =
            result.top3[i];

        if (!prediction ||
            typeof prediction !== "object") {

            throw new Error(
                `Invalid Top ${i + 1} prediction.`
            );
        }


        if (
            !Number.isInteger(prediction.homeGoals) ||
            !Number.isInteger(prediction.awayGoals) ||
            prediction.homeGoals < 0 ||
            prediction.awayGoals < 0
        ) {

            throw new Error(
                `Invalid score returned for Top ${i + 1}.`
            );
        }
    }
}


/* ============================================================
   12. DISPLAY PREDICTION
   ============================================================ */

function displayPrediction(result) {

    const match =
        result.match || state.currentMatch;

    const top3 =
        result.top3;


    /*
     * Match identity
     */

    DOM.resultHomeTeam.textContent =
        getTeamName(
            match,
            "home"
        );

    DOM.resultAwayTeam.textContent =
        getTeamName(
            match,
            "away"
        );


    /*
     * Direction
     */

    DOM.predictedDirection.textContent =
        formatDirection(
            result.direction
        );

    DOM.directionExplanation.textContent =
        result.directionExplanation ||
        "Direction generated by the model ensemble.";


    /*
     * Regime
     */

    DOM.predictionRegime.textContent =
        formatRegime(
            result.regime
        );


    /*
     * Top 3
     */

    displayScorePrediction(
        1,
        top3[0]
    );

    displayScorePrediction(
        2,
        top3[1]
    );

    displayScorePrediction(
        3,
        top3[2]
    );


    /*
     * Diagnostics
     */

    DOM.predictionConfidence.textContent =
        formatPercent(
            result.confidence
        );

    DOM.historicalSimilarity.textContent =
        formatPercent(
            result.historicalSimilarity
        );

    DOM.lambdaHome.textContent =
        formatNumber(
            result.lambdaHome
        );

    DOM.lambdaAway.textContent =
        formatNumber(
            result.lambdaAway
        );

    DOM.memoryWeight.textContent =
        formatPercent(
            result.memoryWeight
        );

    DOM.upsetProbability.textContent =
        formatPercent(
            result.upsetProbability
        );


    /*
     * Engine message
     */

    DOM.engineMessage.textContent =
        result.message ||
        "Prediction generated from the available market and historical information.";


    /*
     * Show the result only after all mandatory Top 3
     * predictions have been successfully validated.
     */

    DOM.predictionPanel.classList.remove(
        "hidden"
    );


    /*
     * Scroll gently to the result.
     */

    DOM.predictionPanel.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


/* ============================================================
   13. DISPLAY INDIVIDUAL SCORE
   ============================================================ */

function displayScorePrediction(
    rank,
    prediction
) {

    const scoreElement =
        document.getElementById(
            `prediction-score-${rank}`
        );

    const probabilityElement =
        document.getElementById(
            `prediction-probability-${rank}`
        );


    const score =
        `${prediction.homeGoals}-${prediction.awayGoals}`;


    scoreElement.textContent =
        score;


    probabilityElement.textContent =
        formatPercent(
            prediction.probability
        );
}


/* ============================================================
   14. FORMATTERS
   ============================================================ */

function formatDirection(direction) {

    if (!direction) {
        return "—";
    }

    const map = {
        HOME: "HOME",
        AWAY: "AWAY",
        DRAW: "DRAW",
        HOME_DOMINANT: "HOME DOMINANT",
        AWAY_DOMINANT: "AWAY DOMINANT",
        AWAY_BLOWOUT: "AWAY BLOWOUT",
        HOME_BLOWOUT: "HOME BLOWOUT",
        BALANCED: "BALANCED"
    };

    return map[direction] ||
        String(direction).toUpperCase();
}


function formatRegime(regime) {

    if (!regime) {
        return "—";
    }

    return String(regime)
        .replace(/_/g, " ")
        .toUpperCase();
}


function formatPercent(value) {

    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(Number(value))
    ) {
        return "—";
    }

    let number =
        Number(value);

    /*
     * The internal engine should normally use [0,1].
     * This formatter also safely accepts an already-percent
     * value such as 72.4.
     */

    if (number >= 0 && number <= 1) {
        number *= 100;
    }

    return `${number.toFixed(1)}%`;
}


function formatNumber(value) {

    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(Number(value))
    ) {
        return "—";
    }

    return Number(value).toFixed(3);
}


function getTeamName(
    match,
    side
) {

    if (!match) {
        return "—";
    }

    if (side === "home") {

        return (
            match.homeTeam ||
            match.team1 ||
            match.home ||
            "Home"
        );
    }

    return (
        match.awayTeam ||
        match.team2 ||
        match.away ||
        "Away"
    );
}


/* ============================================================
   15. HISTORY SUCCESS MESSAGE
   ============================================================ */

function buildHistorySuccessMessage(
    count
) {

    return [
        "✓ Historical data validated.",
        `${count} valid completed match${count > 1 ? "es" : ""} loaded.`,
        "Historical memory is ready for analysis."
    ].join(" ");
}


/* ============================================================
   16. CURRENT MATCH SUCCESS MESSAGE
   ============================================================ */

function buildMatchSuccessMessage(
    match
) {

    const home =
        getTeamName(match, "home");

    const away =
        getTeamName(match, "away");


    return [
        "✓ Event validated.",
        `${home} vs ${away}.`,
        "Pre-match market data is ready for analysis."
    ].join(" ");
}


/* ============================================================
   17. VALIDATION UI
   ============================================================ */

function showValidation(
    element,
    type,
    message
) {

    element.classList.remove(
        "hidden",
        "success",
        "warning",
        "error"
    );

    element.classList.add(type);

    element.textContent =
        message;
}


function clearValidation(element) {

    element.classList.add("hidden");

    element.classList.remove(
        "success",
        "warning",
        "error"
    );

    element.textContent = "";
}


/* ============================================================
   18. GLOBAL ERROR
   ============================================================ */

function showGlobalError(message) {

    DOM.globalError.classList.remove(
        "hidden"
    );

    DOM.globalError.textContent =
        message;

    DOM.globalError.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}


function clearGlobalError() {

    DOM.globalError.classList.add(
        "hidden"
    );

    DOM.globalError.textContent = "";
}



/* ============================================================
   19. ANALYSIS STATUS
   ============================================================ */

function setAnalysisStatus(message) {

    DOM.analysisStatus.textContent =
        message;
}


/* ============================================================
   20. SYSTEM STATUS
   ============================================================ */

function updateSystemStatus(message) {

    DOM.systemStatus.textContent =
        message;
}


/* ============================================================
   21. HIDE PREDICTION
   ============================================================ */

function hidePrediction() {

    DOM.predictionPanel.classList.add(
        "hidden"
    );

    /*
     * Reset visible prediction values.
     * This prevents old predictions from remaining
     * visible after the user changes the input.
     */

    DOM.predictionScore1.textContent = "—";
    DOM.predictionScore2.textContent = "—";
    DOM.predictionScore3.textContent = "—";

    DOM.predictionProbability1.textContent = "—";
    DOM.predictionProbability2.textContent = "—";
    DOM.predictionProbability3.textContent = "—";

    DOM.predictionConfidence.textContent = "—";
    DOM.historicalSimilarity.textContent = "—";
    DOM.lambdaHome.textContent = "—";
    DOM.lambdaAway.textContent = "—";
    DOM.memoryWeight.textContent = "—";
    DOM.upsetProbability.textContent = "—";

    DOM.predictedDirection.textContent = "—";
    DOM.directionExplanation.textContent = "—";
    DOM.predictionRegime.textContent = "—";
    DOM.engineMessage.textContent = "—";
}


/* ============================================================
   22. SAFE ERROR MESSAGE
   ============================================================ */

function safeErrorMessage(error) {

    if (!error) {
        return "Unknown error.";
    }

    if (
        typeof error.message === "string" &&
        error.message.trim()
    ) {
        return error.message;
    }

    return String(error);
}


/* ============================================================
   22b. EVALUATION (RÉSULTAT RÉEL)
   ============================================================
   Permet de saisir le score réel d'un match déjà prédit, de
   calculer les métriques de performance (Top 3 atteint,
   direction correcte) via core/evaluator.js, et d'accumuler
   ces résultats sur une série pour suivre l'objectif du
   cahier des charges (6 à 8 réussites sur 10 matchs).
   ============================================================ */

const EVALUATIONS_STORAGE_KEY = "vse_evaluations";


function handleEvaluate() {

    clearGlobalError();

    if (!state.prediction) {

        showValidation(
            DOM.evaluationResult,
            "error",
            "Aucune prédiction à évaluer. Lancez d'abord une analyse."
        );

        return;
    }

    const homeRaw =
        DOM.actualHomeScore.value.trim();

    const awayRaw =
        DOM.actualAwayScore.value.trim();

    const home =
        Number(homeRaw);

    const away =
        Number(awayRaw);

    if (
        homeRaw === "" ||
        awayRaw === "" ||
        !Number.isInteger(home) ||
        !Number.isInteger(away) ||
        home < 0 ||
        away < 0
    ) {

        showValidation(
            DOM.evaluationResult,
            "error",
            "Saisissez un score réel valide (entiers ≥ 0) pour les deux équipes."
        );

        return;
    }

    try {

        const record =
            evaluatePrediction({
                prediction: state.prediction,
                actualScore: `${home}-${away}`,
                matchId:
                    state.prediction.match
                        ? `${state.prediction.match.homeTeam}_vs_${state.prediction.match.awayTeam}_${Date.now()}`
                        : `match_${Date.now()}`
            });

        state.evaluations.push(record);

        saveEvaluations();

        showValidation(
            DOM.evaluationResult,
            record.result.exactScoreHit ? "success" : "warning",
            buildEvaluationMessage(record)
        );

        updatePerformancePanel();

    } catch (error) {

        showValidation(
            DOM.evaluationResult,
            "error",
            `Évaluation impossible : ${safeErrorMessage(error)}`
        );

        console.error(
            "[Evaluation Error]",
            error
        );
    }
}


function buildEvaluationMessage(record) {

    const parts = [];

    if (record.result.exactScoreHit) {

        parts.push(
            `✓ Score réel trouvé dans le Top ${record.result.exactScoreRank}.`
        );

    } else {

        parts.push(
            "✗ Score réel absent du Top 3."
        );
    }

    parts.push(
        record.result.directionHit
            ? "Direction correcte."
            : "Direction incorrecte."
    );

    return parts.join(" ");
}


function handleResetPerformance() {

    state.evaluations = [];

    saveEvaluations();

    clearValidation(DOM.evaluationResult);

    updatePerformancePanel();
}


function loadEvaluations() {

    try {

        const raw =
            window.localStorage.getItem(
                EVALUATIONS_STORAGE_KEY
            );

        if (!raw) {
            state.evaluations = [];
            return;
        }

        const parsed =
            JSON.parse(raw);

        state.evaluations =
            Array.isArray(parsed)
                ? parsed
                : [];

    } catch (error) {

        console.warn(
            "[Evaluation Storage] Could not load stored evaluations:",
            error
        );

        state.evaluations = [];
    }
}


function saveEvaluations() {

    try {

        window.localStorage.setItem(
            EVALUATIONS_STORAGE_KEY,
            JSON.stringify(state.evaluations)
        );

    } catch (error) {

        console.warn(
            "[Evaluation Storage] Could not save evaluations:",
            error
        );
    }
}


function updatePerformancePanel() {

    const metrics =
        evaluateBatch(state.evaluations);

    const target =
        checkSevenOfTen(state.evaluations);

    DOM.performanceBadge.textContent =
        `${metrics.totalMatches} match${metrics.totalMatches > 1 ? "s" : ""} évalué${metrics.totalMatches > 1 ? "s" : ""}`;

    DOM.performanceTop3Rate.textContent =
        metrics.totalMatches > 0
            ? formatPercent(metrics.exactScore.top3Rate)
            : "—";

    DOM.performanceDirectionRate.textContent =
        metrics.totalMatches > 0
            ? formatPercent(metrics.direction.rate)
            : "—";

    DOM.performanceTarget.textContent =
        metrics.totalMatches >= 10
            ? `${target.exactTop3Hits} / ${metrics.totalMatches} ${target.sevenOfTen ? "✓" : ""}`
            : `${metrics.exactScore.totalHits} / ${metrics.totalMatches} (min. 10 matchs requis)`;
}


/* ============================================================
   23. PUBLIC DEBUG INTERFACE
   ============================================================
   Development helper only.
   It allows inspection from the browser console without
   exposing mathematical internals.
   ============================================================ */

window.VirtualScoreEngine = {

    getState() {
        return {
            ...state,
            historicalMatches:
                [...state.historicalMatches],
            historicalFeatures:
                [...state.historicalFeatures]
        };
    },

    clear() {

        DOM.historyInput.value = "";
        DOM.matchInput.value = "";

        state.historicalRaw = "";
        state.currentMatchRaw = "";

        state.historicalMatches = [];
        state.currentMatch = null;

        state.historicalFeatures = [];
        state.currentMatchFeatures = null;

        state.historyValid = false;
        state.matchValid = false;

        state.prediction = null;

        state.isAnalyzing = false;

        clearValidation(
            DOM.historyValidation
        );

        clearValidation(
            DOM.matchValidation
        );

        clearGlobalError();

        hidePrediction();

        updateHistoryBadge();
        updateMatchBadge();
        updateAnalyzeButton();

        setAnalysisStatus(
            "Waiting for valid historical data and a valid new event."
        );

        updateSystemStatus("Ready");
    }

};


/* ============================================================
   END OF app.js
   ============================================================ */