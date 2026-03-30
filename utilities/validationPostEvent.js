const fs = require('fs');
const path = require('path');

const { readJsonFile } = require('./fileUtils');
const { formatTimestamp } = require('./timeUtils');
const { formatTournamentDisplayName } = require('./namingUtils');
const { listSeasonTournamentDirs, inferTournamentNameFromInputs } = require('./tournamentPaths');

const POST_EVENT_RESULTS_PRIMARY_SUFFIX = '_post_event_results.json';
const POST_EVENT_RESULTS_FALLBACK_SUFFIX = '_results.json';

const listPostEventResultsFiles = ({ season, dataRootDir, logger = console }) => {
  const tournamentDirs = listSeasonTournamentDirs(dataRootDir, season);
  const files = [];

  const collectFromDir = ({ dirPath, isSeedRun, tournamentSlug, tournamentName }) => {
    if (!dirPath || !fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name);
    const primary = entries.filter(name => name.endsWith(POST_EVENT_RESULTS_PRIMARY_SUFFIX));
    const fallback = primary.length === 0
      ? entries.filter(name => name.endsWith(POST_EVENT_RESULTS_FALLBACK_SUFFIX)
          && !name.startsWith('tournament_results')
          && !name.endsWith('_pre_event_results.json'))
      : [];
    const selected = primary.length > 0 ? primary : fallback;
    if (selected.length === 0) return;

    selected.forEach(name => {
      files.push({
        filePath: path.resolve(dirPath, name),
        fileName: name,
        isSeedRun,
        tournamentSlug,
        tournamentName
      });
    });
  };

  tournamentDirs.forEach(tournamentDir => {
    const tournamentSlug = path.basename(tournamentDir);
    const inputsDir = path.resolve(tournamentDir, 'inputs');
    const fallbackName = formatTournamentDisplayName(tournamentSlug);
    const tournamentName = inferTournamentNameFromInputs(inputsDir, season, fallbackName) || fallbackName;
    const postEventDir = path.resolve(tournamentDir, 'post_event');

    collectFromDir({ dirPath: postEventDir, isSeedRun: false, tournamentSlug, tournamentName });
    collectFromDir({
      dirPath: path.resolve(postEventDir, 'seed_runs'),
      isSeedRun: true,
      tournamentSlug,
      tournamentName
    });
  });

  if (files.length === 0) {
    logger.log(`ℹ️  No post-event results found for season ${season}.`);
  }

  return files;
};

const extractEvaluationSummary = evaluation => {
  if (!evaluation || typeof evaluation !== 'object') return null;
  return {
    correlation: typeof evaluation.correlation === 'number' ? evaluation.correlation : null,
    rmse: typeof evaluation.rmse === 'number' ? evaluation.rmse : null,
    mae: typeof evaluation.mae === 'number' ? evaluation.mae : null,
    top10: typeof evaluation.top10 === 'number' ? evaluation.top10 : null,
    top20: typeof evaluation.top20 === 'number' ? evaluation.top20 : null,
    top20WeightedScore: typeof evaluation.top20WeightedScore === 'number' ? evaluation.top20WeightedScore : null,
    matchedPlayers: typeof evaluation.matchedPlayers === 'number' ? evaluation.matchedPlayers : null,
    adjustedSubsetCorrelation: typeof evaluation?.adjusted?.subset?.correlation === 'number'
      ? evaluation.adjusted.subset.correlation
      : null
  };
};

const extractMetricCorrelation = (averageMap, key) => {
  if (!averageMap || typeof averageMap !== 'object') return null;
  const entry = averageMap[key];
  if (!entry || typeof entry !== 'object') return null;
  return typeof entry.correlation === 'number' ? entry.correlation : null;
};

const buildPostEventRunSummary = ({ payload, meta, season }) => {
  if (!payload || typeof payload !== 'object') return null;
  const step1 = payload.step1_bestTemplate || null;
  const step3 = payload.step3_optimized || null;
  const step4KFold = payload.step4a_eventKFold || null;
  const seasonKey = season ? String(season) : null;

  const step1Eval = extractEvaluationSummary(step1?.evaluationCurrentYear || step1?.evaluation || null);
  const step3Eval = extractEvaluationSummary(step3?.evaluationCurrentYear || step3?.evaluation || null);
  const kFoldEntry = seasonKey && step4KFold && step4KFold[seasonKey]
    ? step4KFold[seasonKey]
    : null;
  const kFoldEval = extractEvaluationSummary(kFoldEntry?.evaluation || null);

  const top20Logistic = payload.currentGeneratedTop20Logistic || null;
  const top20Cv = payload.currentGeneratedTop20CvSummary || null;
  const historicalAverage = payload.historicalMetricCorrelations?.average || null;

  const combinedObjective = typeof step3?.combinedObjectiveScore === 'number'
    ? step3.combinedObjectiveScore
    : (typeof step3?.combinedScore === 'number' ? step3.combinedScore : null);
  const top20Composite = typeof step3?.top20CompositeScore === 'number'
    ? step3.top20CompositeScore
    : (typeof step3?.top20Score === 'number' ? step3.top20Score : null);

  return {
    season,
    eventId: payload.eventId ? String(payload.eventId) : null,
    tournament: payload.tournament || meta?.tournamentName || null,
    tournamentSlug: meta?.tournamentSlug || null,
    filePath: meta?.filePath || null,
    isSeedRun: !!meta?.isSeedRun,
    optSeed: payload.optSeed || meta?.optSeed || null,
    dryRun: !!payload.dryRun,
    timestamp: payload.timestamp || null,
    runFingerprint: payload.runFingerprint || null,
    validationCourseType: payload?.validationIntegration?.validationCourseType || null,
    validationTemplateName: payload?.validationIntegration?.validationTemplateName || null,
    step1: step1Eval,
    step3: step3Eval,
    step3AlignmentScore: typeof step3?.alignmentScore === 'number' ? step3.alignmentScore : null,
    step3Top20CompositeScore: top20Composite,
    step3CombinedObjectiveScore: combinedObjective,
    kFold: kFoldEval,
    kFoldFoldCount: typeof kFoldEntry?.foldCount === 'number' ? kFoldEntry.foldCount : null,
    top20Logistic: {
      accuracy: typeof top20Logistic?.accuracy === 'number' ? top20Logistic.accuracy : null,
      logLoss: typeof top20Logistic?.logLoss === 'number' ? top20Logistic.logLoss : null,
      bias: typeof top20Logistic?.bias === 'number' ? top20Logistic.bias : null,
      samples: typeof top20Logistic?.samples === 'number' ? top20Logistic.samples : null
    },
    top20Cv: {
      avgAccuracy: typeof top20Cv?.avgAccuracy === 'number' ? top20Cv.avgAccuracy : null,
      avgLogLoss: typeof top20Cv?.avgLogLoss === 'number' ? top20Cv.avgLogLoss : null,
      eventCount: typeof top20Cv?.eventCount === 'number' ? top20Cv.eventCount : null,
      foldsUsed: typeof top20Cv?.foldsUsed === 'number' ? top20Cv.foldsUsed : null
    },
    historicalAvgCorrelations: {
      scoringAverage: extractMetricCorrelation(historicalAverage, 'scoringAverage'),
      strokesGainedTotal: extractMetricCorrelation(historicalAverage, 'strokesGainedTotal'),
      strokesGainedT2G: extractMetricCorrelation(historicalAverage, 'strokesGainedT2G'),
      strokesGainedApp: extractMetricCorrelation(historicalAverage, 'strokesGainedApp'),
      strokesGainedPutt: extractMetricCorrelation(historicalAverage, 'strokesGainedPutt'),
      birdiesOrBetter: extractMetricCorrelation(historicalAverage, 'birdiesOrBetter')
    }
  };
};

const computeNumericStats = values => {
  const filtered = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (filtered.length === 0) return null;
  const sorted = filtered.slice().sort((a, b) => a - b);
  const mean = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  return {
    count: filtered.length,
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
};

const buildSeasonPostEventSummary = ({ season, dataRootDir, logger = console }) => {
  const files = listPostEventResultsFiles({ season, dataRootDir, logger });
  const runs = [];
  const skipped = [];

  files.forEach(file => {
    const payload = readJsonFile(file.filePath);
    if (!payload) {
      skipped.push({ filePath: file.filePath, reason: 'invalid_json' });
      return;
    }
    const summary = buildPostEventRunSummary({
      payload,
      meta: {
        filePath: file.filePath,
        tournamentSlug: file.tournamentSlug,
        tournamentName: file.tournamentName,
        isSeedRun: file.isSeedRun
      },
      season
    });
    if (!summary) {
      skipped.push({ filePath: file.filePath, reason: 'missing_payload' });
      return;
    }
    runs.push(summary);
  });

  const runsByTournament = new Map();
  runs.forEach(run => {
    const key = String(run.tournamentSlug || run.tournament || '').trim().toLowerCase();
    if (!key) return;
    if (!runsByTournament.has(key)) runsByTournament.set(key, []);
    runsByTournament.get(key).push(run);
  });

  const pickBestRun = entries => {
    if (!entries || entries.length === 0) return null;
    const score = entry => {
      const combined = entry.step3CombinedObjectiveScore;
      if (typeof combined === 'number') return combined;
      const top20Composite = entry.step3Top20CompositeScore;
      if (typeof top20Composite === 'number') return top20Composite;
      const top20Weighted = entry.step3?.top20WeightedScore;
      if (typeof top20Weighted === 'number') return top20Weighted;
      const correlation = entry.step3?.correlation;
      return typeof correlation === 'number' ? correlation : 0;
    };
    return entries.slice().sort((a, b) => score(b) - score(a))[0];
  };

  const tournamentSummaries = Array.from(runsByTournament.entries()).map(([key, entries]) => {
    const best = pickBestRun(entries);
    const seedRuns = entries.filter(entry => entry.isSeedRun).length;
    return {
      tournamentKey: key,
      tournament: best?.tournament || entries[0]?.tournament || null,
      tournamentSlug: best?.tournamentSlug || entries[0]?.tournamentSlug || null,
      eventId: best?.eventId || entries[0]?.eventId || null,
      runCount: entries.length,
      seedRunCount: seedRuns,
      bestRun: best
    };
  });

  const numericSeries = {
    step3Correlation: tournamentSummaries.map(entry => entry.bestRun?.step3?.correlation),
    step3Top20WeightedScore: tournamentSummaries.map(entry => entry.bestRun?.step3?.top20WeightedScore),
    step3Top20: tournamentSummaries.map(entry => entry.bestRun?.step3?.top20),
    step3Rmse: tournamentSummaries.map(entry => entry.bestRun?.step3?.rmse),
    step3Mae: tournamentSummaries.map(entry => entry.bestRun?.step3?.mae),
    step1Correlation: tournamentSummaries.map(entry => entry.bestRun?.step1?.correlation),
    kFoldCorrelation: tournamentSummaries.map(entry => entry.bestRun?.kFold?.correlation),
    top20LogisticAccuracy: tournamentSummaries.map(entry => entry.bestRun?.top20Logistic?.accuracy),
    top20CvAccuracy: tournamentSummaries.map(entry => entry.bestRun?.top20Cv?.avgAccuracy)
  };

  const aggregates = Object.entries(numericSeries).reduce((acc, [key, values]) => {
    acc[key] = computeNumericStats(values);
    return acc;
  }, {});

  return {
    generatedAt: formatTimestamp(new Date()),
    season,
    runCount: runs.length,
    tournamentCount: tournamentSummaries.length,
    seedRunCount: runs.filter(run => run.isSeedRun).length,
    runs,
    tournaments: tournamentSummaries,
    aggregates,
    skipped
  };
};

module.exports = {
  POST_EVENT_RESULTS_PRIMARY_SUFFIX,
  POST_EVENT_RESULTS_FALLBACK_SUFFIX,
  listPostEventResultsFiles,
  extractEvaluationSummary,
  extractMetricCorrelation,
  buildPostEventRunSummary,
  computeNumericStats,
  buildSeasonPostEventSummary
};
