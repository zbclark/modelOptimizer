/**
 * Module: validationRunner
 * Purpose: Internal validation pipeline (invoked by optimizer.js).
 * Notes: Reads optimizer outputs + DataGolf snapshots and writes season-scoped artifacts.
 */

const fs = require('fs');
const path = require('path');
const { loadCsv } = require('./csvLoader');
const { ensureDirectory, readJsonFile } = require('./fileUtils');
const { formatTimestamp } = require('./timeUtils');
const { WEIGHT_TEMPLATES } = require('./weightTemplates');
const { OUTPUT_ARTIFACTS } = require('./outputPaths');
const { evaluateTournamentPredictions } = require('./evaluationMetrics');
const { loadTournamentPredictions } = require('./validationPredictions');
const { extractHistoricalRowsFromSnapshotPayload } = require('./historicalRowsUtils');
const { METRIC_ORDER } = require('./validationConstants');
const { formatTournamentDisplayName } = require('./namingUtils');
const {
  buildCorrelationSummary,
  buildCourseTypeClassificationEntries
} = require('./validationSummaries');
const {
  listSeasonTournamentDirs,
  inferTournamentNameFromInputs
} = require('./tournamentPaths');
const { buildSeasonPostEventSummary } = require('./validationPostEvent');
const { buildCalibrationData } = require('./validationCalibration');
const { buildMetricAnalysis } = require('./validationMetricAnalysis');
const {
  getValidationOutputDir,
  shouldSkipMetricAnalysis,
  slugifyTournament,
  buildValidationRunContext,
  buildValidationInputSummary,
  buildValidationInputs,
  buildMetricAnalysisAggregateList,
  buildMetricAnalysisPayload,
  buildValidationAggregates,
  buildValidationCalibrationPayload,
  buildProcessingLogData,
  buildValidationSourceSummary,
  buildProcessingLogPayload,
  buildTemplateOutputContext,
  loadSeasonManifest,
  buildResultsFromHistoricalRows,
  buildResultsFromHistoricalSnapshotPayload,
  resolveHistoricalRoundsCachePath,
  loadTournamentResultsFromJson,
  loadTournamentResultsFromResultsCsv,
  loadTournamentResultsFromHistoricalCsv,
  loadTournamentResultsFromHistoricalApi,
  createOutputTracker,
  loadTournamentConfig,
  buildExistingResultsPayloadSummary,
  buildResultsFromPayloadRows,
  parseModelRankingData,
  buildResultsSheetContext,
  buildModelDeltaTrends,
  buildSeasonCalibrationData
} = require('./validationCore');
const validationOutputs = require('./validationOutputs');
const { OUTPUT_NAMES } = require('./validationOutputNames');
const ROOT_DIR = path.resolve(__dirname, '..');
const DATAGOLF_CACHE_ROOT_DIR = path.resolve(ROOT_DIR, 'data', 'cache');
const HISTORICAL_ROUNDS_CACHE_DIR = path.resolve(DATAGOLF_CACHE_ROOT_DIR, 'historical_rounds');
const DATAGOLF_CACHE_DIR = (() => {
  const raw = String(process.env.DATAGOLF_CACHE_DIR || '').trim();
  if (raw) return path.resolve(raw);
  return HISTORICAL_ROUNDS_CACHE_DIR;
})();
const DATAGOLF_HISTORICAL_TOUR = String(process.env.DATAGOLF_HISTORICAL_TOUR || 'pga')
  .trim()
  .toLowerCase();

const ensureTournamentResults = async ({
  resultsJsonPath,
  resultsCsvPath,
  legacyResultsJsonPath,
  rankingsCsvPath,
  historyCsvPath,
  eventId,
  season,
  tournamentSlug,
  tournamentName,
  dataRootDir,
  logger = console
}) => {
  const resultsDir = resultsJsonPath ? path.dirname(resultsJsonPath) : null;
  const resolvedResultsCsvPath = resultsCsvPath || (resultsDir ? path.resolve(resultsDir, 'tournament_results.csv') : null);
  const modelData = parseModelRankingData(rankingsCsvPath);

  const buildPayloadAndWrite = ({ source, results, eventName, courseName, lastUpdated, apiSnapshots }) => {
    const sheetContext = buildResultsSheetContext({
      results,
      modelData,
      rankingsCsvPath,
      historyCsvPath,
      eventId,
      season,
      dataRootDir,
      resultsDir,
      tournamentName,
      tournamentSlug
    });

    const payload = {
      generatedAt: formatTimestamp(new Date()),
      tournament: tournamentName || null,
      eventId: eventId || null,
      season: season || null,
      source,
      eventName: eventName || null,
      courseName: courseName || null,
      lastUpdated: lastUpdated || null,
      metricStats: sheetContext.metricStats,
      zScores: sheetContext.zScores,
      results: sheetContext.rows,
      resultsSheetCsv: sheetContext.resultsSheetCsv,
      apiSnapshots: apiSnapshots || undefined
    };
    const pathWritten = validationOutputs.writeTournamentResultsSnapshot(resultsJsonPath, payload);
    if (resolvedResultsCsvPath) {
      validationOutputs.writeResultsSheetCsv(resolvedResultsCsvPath, sheetContext.resultsSheetCsv);
    }
    return { pathWritten, rows: sheetContext.rows };
  };

  if (resultsJsonPath && fs.existsSync(resultsJsonPath)) {
    const payload = readJsonFile(resultsJsonPath);
    const {
      payloadRows,
      needsMetricRebuild,
      needsEnrichment,
      shouldHydrateSheetCsv
    } = buildExistingResultsPayloadSummary({ payload, modelData });
    if (needsMetricRebuild) {
      logger.log(`ℹ️  Results metrics missing; attempting rebuild from historical rounds (event=${eventId || 'n/a'}, season=${season || 'n/a'}).`);
    }

    if (needsMetricRebuild && historyCsvPath && fs.existsSync(historyCsvPath)) {
      const rawRows = loadCsv(historyCsvPath, { skipFirstColumn: true });
      const build = buildResultsFromHistoricalRows(rawRows, eventId, season);
      if (build.results.length > 0) {
        const stats = fs.statSync(historyCsvPath);
        const lastUpdated = stats?.mtime ? formatTimestamp(stats.mtime) : null;
        const rebuilt = buildPayloadAndWrite({
          source: 'historical_csv',
          results: build.results,
          eventName: build.eventName,
          courseName: build.courseName,
          lastUpdated
        });
        logger.log('✓ Rebuilt results JSON to include full historical metrics.');
        return { source: 'historical_csv_rebuild', path: rebuilt.pathWritten || resultsJsonPath };
      }
    }

    if (needsMetricRebuild) {
      const fromApi = await loadTournamentResultsFromHistoricalApi(eventId, season);
      const buildFromApi = buildResultsFromHistoricalSnapshotPayload(fromApi.snapshot?.payload, eventId, season);
      if (buildFromApi?.results?.length) {
        const lastUpdated = fromApi.snapshot?.payload?.last_updated || null;
        const rebuilt = buildPayloadAndWrite({
          source: fromApi.source || 'historical_api',
          results: buildFromApi.results,
          eventName: buildFromApi.eventName,
          courseName: buildFromApi.courseName,
          lastUpdated,
          apiSnapshots: {
            dataGolfHistoricalRounds: {
              source: fromApi.snapshot?.source || null,
              path: fromApi.snapshot?.path || null,
              lastUpdated
            }
          }
        });
        logger.log('✓ Rebuilt results JSON from DataGolf historical rounds (metrics included).');
        return { source: fromApi.source || 'historical_api_rebuild', path: rebuilt.pathWritten || resultsJsonPath };
      }

      const cachePath = resolveHistoricalRoundsCachePath({
        cacheDir: DATAGOLF_CACHE_DIR,
        tour: DATAGOLF_HISTORICAL_TOUR,
        eventId: 'all',
        season,
        fileFormat: 'json'
      });
      if (cachePath && fs.existsSync(cachePath)) {
        const cachedPayload = readJsonFile(cachePath);
        const cachedRows = extractHistoricalRowsFromSnapshotPayload(cachedPayload);
        logger.log(`ℹ️  Cached historical rounds loaded (${cachedRows.length} rows) from ${path.basename(cachePath)}.`);
        const buildFromCache = buildResultsFromHistoricalSnapshotPayload(cachedPayload, eventId, season);
        if (buildFromCache?.results?.length) {
          logger.log(`✓ Cache rebuild matched ${buildFromCache.results.length} players for event ${eventId || 'n/a'}.`);
          const stats = fs.statSync(cachePath);
          const lastUpdated = stats?.mtime ? formatTimestamp(stats.mtime) : null;
          const rebuilt = buildPayloadAndWrite({
            source: 'historical_cache',
            results: buildFromCache.results,
            eventName: buildFromCache.eventName,
            courseName: buildFromCache.courseName,
            lastUpdated,
            apiSnapshots: {
              dataGolfHistoricalRounds: {
                source: 'cache',
                path: cachePath,
                lastUpdated
              }
            }
          });
          logger.log('✓ Rebuilt results JSON from cached historical rounds (metrics included).');
          return { source: 'historical_cache_rebuild', path: rebuilt.pathWritten || resultsJsonPath };
        }
      }
      logger.log('⚠️  Results rebuild attempted but no historical metrics were available.');
    }

    if (needsEnrichment) {
      const results = buildResultsFromPayloadRows({
        payloadRows,
        includeMetrics: true
      });

      const sheetContext = buildResultsSheetContext({
        results,
        modelData,
        rankingsCsvPath,
        historyCsvPath,
        eventId,
        season,
        dataRootDir,
        resultsDir,
        tournamentName,
        tournamentSlug
      });
      const updatedPayload = {
        generatedAt: formatTimestamp(new Date()),
        tournament: payload?.tournament || tournamentName || null,
        eventId: payload?.eventId || eventId || null,
        season: payload?.season || season || null,
        source: payload?.source || 'existing_json',
        eventName: payload?.eventName || null,
        courseName: payload?.courseName || null,
        lastUpdated: payload?.lastUpdated || null,
        metricStats: sheetContext.metricStats,
        zScores: sheetContext.zScores,
        results: sheetContext.rows,
        resultsSheetCsv: sheetContext.resultsSheetCsv,
        apiSnapshots: payload?.apiSnapshots || undefined
      };
      validationOutputs.writeTournamentResultsSnapshot(resultsJsonPath, updatedPayload);
      if (resolvedResultsCsvPath) {
        validationOutputs.writeResultsSheetCsv(resolvedResultsCsvPath, sheetContext.resultsSheetCsv);
      }
      logger.log('✓ Enriched existing results JSON with model rankings.');
      return { source: 'existing_json_enriched', path: resultsJsonPath };
    }

    if ((resolvedResultsCsvPath && !fs.existsSync(resolvedResultsCsvPath)) || shouldHydrateSheetCsv) {
      const results = buildResultsFromPayloadRows({
        payloadRows,
        includeMetrics: false
      });

      const sheetContext = buildResultsSheetContext({
        results,
        modelData,
        rankingsCsvPath,
        historyCsvPath,
        eventId,
        season,
        dataRootDir,
        resultsDir,
        tournamentName,
        tournamentSlug
      });

      if (resolvedResultsCsvPath && !fs.existsSync(resolvedResultsCsvPath)) {
        validationOutputs.writeResultsSheetCsv(resolvedResultsCsvPath, sheetContext.resultsSheetCsv);
      }

      if (shouldHydrateSheetCsv) {
        const updatedPayload = {
          ...payload,
          resultsSheetCsv: sheetContext.resultsSheetCsv
        };
        validationOutputs.writeTournamentResultsSnapshot(resultsJsonPath, updatedPayload);
      }
    }

    return { source: 'existing_json', path: resultsJsonPath };
  }

  if (legacyResultsJsonPath && fs.existsSync(legacyResultsJsonPath) && resultsJsonPath) {
    const legacyPayload = readJsonFile(legacyResultsJsonPath);
    if (legacyPayload?.results && Array.isArray(legacyPayload.results)) {
      const legacyRows = legacyPayload.results;
      const pathWritten = validationOutputs.writeTournamentResultsSnapshot(resultsJsonPath, legacyPayload);
      if (resolvedResultsCsvPath) {
        validationOutputs.writeTournamentResultsCsv(resolvedResultsCsvPath, legacyRows, {
          tournament: legacyPayload?.tournament || null,
          courseName: legacyPayload?.courseName || null,
          lastUpdated: legacyPayload?.lastUpdated || null,
          generatedAt: legacyPayload?.generatedAt || null,
          source: legacyPayload?.source || 'legacy_json'
        });
      }
      logger.log(`✓ Migrated legacy results JSON to ${path.basename(resultsJsonPath)}.`);
      return { source: 'legacy_json', path: pathWritten };
    }
  }


  if (historyCsvPath && fs.existsSync(historyCsvPath)) {
    const rawRows = loadCsv(historyCsvPath, { skipFirstColumn: true });
    const build = buildResultsFromHistoricalRows(rawRows, eventId, season);
    if (build.results.length > 0) {
      const stats = fs.statSync(historyCsvPath);
      const lastUpdated = stats?.mtime ? formatTimestamp(stats.mtime) : null;
      buildPayloadAndWrite({
        source: 'historical_csv',
        results: build.results,
        eventName: build.eventName,
        courseName: build.courseName,
        lastUpdated
      });
      logger.log(`✓ Tournament results sourced from Historical Data CSV (${build.results.length} players).`);
      return { source: 'historical_csv', path: resultsJsonPath };
    }
    logger.log('ℹ️  Historical Data CSV found, but no current-season results detected; falling back to API.');
  }

  const cachePath = resolveHistoricalRoundsCachePath({
    cacheDir: DATAGOLF_CACHE_DIR,
    tour: DATAGOLF_HISTORICAL_TOUR,
    eventId: 'all',
    season,
    fileFormat: 'json'
  });
  if (cachePath && fs.existsSync(cachePath)) {
    const cachedPayload = readJsonFile(cachePath);
    const buildFromCache = buildResultsFromHistoricalSnapshotPayload(cachedPayload, eventId, season);
    if (buildFromCache?.results?.length) {
      const stats = fs.statSync(cachePath);
      const lastUpdated = stats?.mtime ? formatTimestamp(stats.mtime) : null;
      buildPayloadAndWrite({
        source: 'historical_cache',
        results: buildFromCache.results,
        eventName: buildFromCache.eventName,
        courseName: buildFromCache.courseName,
        lastUpdated,
        apiSnapshots: {
          dataGolfHistoricalRounds: {
            source: 'cache',
            path: cachePath,
            lastUpdated
          }
        }
      });
      logger.log(`✓ Tournament results sourced from cached historical rounds (${buildFromCache.results.length} players).`);
      return { source: 'historical_cache', path: resultsJsonPath };
    }
  }

  const fromApi = await loadTournamentResultsFromHistoricalApi(eventId, season);
  if (fromApi.results.length > 0) {
    const build = buildResultsFromHistoricalSnapshotPayload(fromApi.snapshot?.payload, eventId, season);
    if (build?.results?.length) {
      buildPayloadAndWrite({
        source: fromApi.source,
        results: build.results,
        eventName: build.eventName,
        courseName: build.courseName,
        lastUpdated: fromApi.snapshot?.payload?.last_updated || null,
        apiSnapshots: {
          dataGolfHistoricalRounds: {
            source: fromApi.snapshot?.source || null,
            path: fromApi.snapshot?.path || null,
            lastUpdated: fromApi.snapshot?.payload?.last_updated || null
          }
        }
      });
      logger.log(`✓ Tournament results sourced from DataGolf historical rounds (${build.results.length} players).`);
      return { source: fromApi.source, path: resultsJsonPath };
    }
  }

  if (fromApi.snapshot?.payload) {
    logger.warn('⚠️  Historical rounds payload loaded but no results found; skipping live stats fallback.');
    return { source: fromApi.source || 'historical_api', path: resultsJsonPath || null };
  }

  logger.warn('⚠️  Tournament results unavailable (CSV + historical cache/API fallbacks failed).');
  return { source: 'missing', path: resultsJsonPath || null };
};

const runSeasonValidation = async ({ season, dataRootDir, logger = console, writeTemplates = false, dryRun = false, dryRunDir = null } = {}) => {
  if (!season || !dataRootDir) {
    throw new Error('validation module: season and dataRootDir are required');
  }

  const tournamentDirs = listSeasonTournamentDirs(dataRootDir, season);
  const manifestEventMap = loadSeasonManifest(dataRootDir, season);
  const results = [];

  for (const tournamentDir of tournamentDirs) {
    const tournamentSlug = path.basename(tournamentDir);
    const inputsDir = path.resolve(tournamentDir, 'inputs');
    const fallbackName = formatTournamentDisplayName(tournamentSlug);
    const tournamentName = inferTournamentNameFromInputs(inputsDir, season, fallbackName) || fallbackName;
    try {
      const validationResult = await runValidation({
        season,
        dataRootDir,
        tournamentName,
        tournamentSlug,
        tournamentDir,
        eventId: manifestEventMap.get(tournamentSlug) || null,
        logger,
        writeTemplates,
        dryRun,
        dryRunDir,
        scopeSeason: true
      });
      results.push({ tournament: tournamentSlug, status: 'ok', outputDir: validationResult.outputDir });
    } catch (error) {
      logger.warn(`⚠️  Validation failed for ${tournamentSlug}: ${error.message}`);
      results.push({ tournament: tournamentSlug, status: 'error', error: error.message });
    }
  }

  const runContext = buildValidationRunContext({
    season,
    dataRootDir,
    scopeSeason: true
  });
  const { outputDir, validationSubdirs } = runContext;
  if (validationSubdirs.seasonSummaries) ensureDirectory(validationSubdirs.seasonSummaries);

  const postEventSummary = buildSeasonPostEventSummary({ season, dataRootDir, logger });
  const postEventSummaryOutputs = validationOutputs.writeSeasonPostEventSummary({
    outputDir,
    summary: postEventSummary,
    validationSubdirs
  });

  return {
    season,
    outputDir,
    results,
    postEventSummary: postEventSummaryOutputs
  };
};

const runValidation = async ({
  season,
  dataRootDir,
  tournamentName,
  tournamentSlug,
  tournamentDir,
  eventId,
  logger = console,
  writeTemplates = false,
  dryRun = false,
  dryRunDir = null,
  scopeSeason = false
} = {}) => {
  // PHASE 2 (planned, no wiring yet):
  // Consolidate output and artifact path creation in this function using
  // `utilities/outputPaths.js` + `utilities/outputArtifacts.js`.
  // Planned scope includes:
  // - outputDir + validation subdirs
  // - rankings/results path resolution helpers
  // - write targets for calibration/classification/metric analysis/correlation summaries/
  //   weight guide/templates/model-delta/processing-log.
  // Migration requirement: preserve current legacy read fallbacks while standardizing writes.
  if (!season || !dataRootDir) {
    throw new Error('validation module: season and dataRootDir are required');
  }

  const runContext = buildValidationRunContext({
    season,
    dataRootDir,
    tournamentName,
    tournamentSlug,
    tournamentDir,
    eventId,
    scopeSeason
  });
  const {
    resolvedSlug,
    outputDir,
    validationSubdirs,
    resolvedTournamentDir,
    outputBaseName,
    outputArtifacts,
    inputsDir,
    preEventDir,
    postEventDir,
    rankingsJsonPath,
    rankingsCsvPath,
    resultsJsonPath,
    resultsCsvPath,
    legacyResultsJsonPath,
    legacyResultsCsvPath,
    historyCsvPath,
    configCsvPath,
    courseContextPath
  } = runContext;
  if (outputDir) ensureDirectory(outputDir);
  if (validationSubdirs.metricAnalysis) ensureDirectory(validationSubdirs.metricAnalysis);
  if (validationSubdirs.templateCorrelations) ensureDirectory(validationSubdirs.templateCorrelations);
  if (validationSubdirs.top20Blend) ensureDirectory(validationSubdirs.top20Blend);
  if (validationSubdirs.seasonSummaries) ensureDirectory(validationSubdirs.seasonSummaries);
  const inputSummary = buildValidationInputSummary({
    season,
    eventId,
    tournamentName,
    resolvedSlug,
    outputDir,
    inputsDir,
    preEventDir,
    postEventDir,
    rankingsJsonPath,
    rankingsCsvPath,
    resultsJsonPath,
    resultsCsvPath,
    historyCsvPath,
    configCsvPath,
    courseContextPath
  });
  let skipMetricAnalysis = false;
  const { outputs, trackOutput, recordOutput } = createOutputTracker();

  logger.log(`ℹ️  Validation pipeline initialized (season=${season}, outputDir=${outputDir})`);

  const config = loadTournamentConfig({
    configCsvPath,
    courseContextPath,
    eventId
  });
  const resultsSourceInfo = await ensureTournamentResults({
    resultsJsonPath,
    resultsCsvPath,
    legacyResultsJsonPath,
    legacyResultsCsvPath,
    rankingsCsvPath,
    historyCsvPath,
    eventId: config.eventId || eventId,
    season,
    tournamentSlug: resolvedSlug,
    tournamentName: tournamentName || resolvedSlug,
    dataRootDir,
    logger
  });
  const validationInputs = buildValidationInputs({
    outputDir,
    resolvedSlug,
    rankingsJsonPath,
    rankingsCsvPath,
    resultsJsonPath,
    resultsCsvPath,
    legacyResultsJsonPath,
    legacyResultsCsvPath,
    historyCsvPath,
    eventId: config.eventId || eventId,
    season
  });
  const {
    predictionsResult,
    resultsResult,
    skipMetricAnalysis: computedSkipMetricAnalysis,
    seedSkip
  } = validationInputs;
  skipMetricAnalysis = computedSkipMetricAnalysis;
  if (seedSkip) {
    logger.log(`ℹ️  Skipping metric analysis for seed run ${resolvedSlug} (seed-specific analysis is redundant).`);
  }
  if (skipMetricAnalysis) {
    logger.log(`ℹ️  Skipping metric analysis for ${resolvedSlug} (already exists).`);
  }
  inputSummary.sources = {
    ...inputSummary.sources,
    ...buildValidationSourceSummary({
      config,
      resultsSourceInfo,
      predictionsResult
    })
  };

  const calibrationPayload = buildValidationCalibrationPayload({
    predictionsResult,
    resultsResult,
    tournamentName,
    resolvedSlug,
    season,
    dataRootDir,
    logger
  });
  const {
    evaluation,
    tournamentCalibration,
    seasonCalibration,
    calibrationReportData
  } = calibrationPayload;
  const calibrationJsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_CALIBRATION_REPORT_JSON
  });
  const calibrationCsvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_CALIBRATION_REPORT_CSV
  });
  trackOutput('calibrationReport.json', calibrationJsonPath);
  trackOutput('calibrationReport.csv', calibrationCsvPath);
  const calibrationOutputs = validationOutputs.writeCalibrationReport(outputDir, calibrationReportData, OUTPUT_NAMES.calibrationReport);
  recordOutput('calibrationReport.json', calibrationOutputs?.jsonPath);
  recordOutput('calibrationReport.csv', calibrationOutputs?.csvPath);

  let metricAnalysis = null;
  let metricAnalysisOutputs = null;
  const courseType = config.courseType || null;
  if (!skipMetricAnalysis && resolvedSlug) {
    const metricAnalysisResult = await buildMetricAnalysisPayload({
      dataRootDir,
      season,
      resolvedSlug,
      tournamentName,
      eventId,
      config,
      resultsJsonPath,
      resultsResult,
      rankingsCsvPath,
      rankingsJsonPath,
      historyCsvPath,
      outputDir,
      logger
    });
    if (metricAnalysisResult.approachSnapshotPayload) {
      validationOutputs.writeApproachSnapshotIfUpdated({
        payload: metricAnalysisResult.approachSnapshotPayload,
        logger
      });
    }
    metricAnalysis = metricAnalysisResult.metricAnalysis;
    if (metricAnalysisResult.approachEventOnlyInfo) {
      inputSummary.approachEventOnly = metricAnalysisResult.approachEventOnlyInfo;
    }
    const metricJsonPath = outputArtifacts.buildPath({
      artifactType: OUTPUT_ARTIFACTS.VALIDATION_METRIC_ANALYSIS_JSON
    });
    const metricCsvPath = outputArtifacts.buildPath({
      artifactType: OUTPUT_ARTIFACTS.VALIDATION_METRIC_ANALYSIS_CSV
    });
    trackOutput('metricAnalysis.json', metricJsonPath);
    trackOutput('metricAnalysis.csv', metricCsvPath);
    if (metricAnalysis) {
      metricAnalysisOutputs = validationOutputs.writeMetricAnalysis(outputDir, metricAnalysis, {
        season,
        tournamentName: tournamentName || resolvedSlug,
        courseType,
        templateName: config.templateKey || null,
        configCsvPath,
        resultsJsonPath,
        rankingsCsvPath,
        rankingsJsonPath
      });
      recordOutput('metricAnalysis.json', metricAnalysisOutputs?.jsonPath);
      recordOutput('metricAnalysis.csv', metricAnalysisOutputs?.csvPath);
    }
  }

  const { allMetricAnalyses } = buildMetricAnalysisAggregateList({
    outputDir,
    metricAnalysis,
    resolvedSlug,
    scopeSeason
  });

  const templatesByType = {
    POWER: WEIGHT_TEMPLATES?.POWER || null,
    TECHNICAL: WEIGHT_TEMPLATES?.TECHNICAL || null,
    BALANCED: WEIGHT_TEMPLATES?.BALANCED || null
  };
  const aggregates = buildValidationAggregates({
    allMetricAnalyses,
    season,
    outputDir,
    validationSubdirs,
    outputBaseName,
    resolvedSlug,
    tournamentName,
    templatesByType
  });
  const {
    top20BlendByTournament,
    top20BlendPath,
    classificationPayload,
    byType,
    summariesByType,
    typeCounts
  } = aggregates;
  inputSummary.top20BlendPath = top20BlendPath;
  const classificationJsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_COURSE_TYPE_CLASSIFICATION_JSON
  });
  const classificationCsvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_COURSE_TYPE_CLASSIFICATION_CSV
  });
  trackOutput('courseTypeClassification.json', classificationJsonPath);
  trackOutput('courseTypeClassification.csv', classificationCsvPath);
  const classificationOutputs = validationOutputs.writeCourseTypeClassification(outputDir, classificationPayload);
  recordOutput('courseTypeClassification.json', classificationOutputs?.jsonPath);
  recordOutput('courseTypeClassification.csv', classificationOutputs?.csvPath);

  validationOutputs.updateCourseContextCourseTypes({
    courseContextPath,
    classificationPayload,
    logger,
    dryRun
  });
  const templateOutputContext = buildTemplateOutputContext({
    dataRootDir,
    season,
    tournamentName,
    summariesByType,
    templatesByType,
    top20BlendByTournament,
    byType
  });

  const correlationResult = validationOutputs.writeCorrelationSummaryOutputs({
    outputDir,
    validationSubdirs,
    outputArtifacts,
    summariesByType,
    byType,
    season,
    trackOutput,
    recordOutput
  });
  const correlationSummaries = correlationResult?.correlationSummaries || null;

  const weightOutputsResult = validationOutputs.writeWeightOutputSummaries({
    outputDir,
    outputArtifacts,
    summariesByType,
    templatesByType,
    typeCounts,
    configInfo: templateOutputContext.configInfo,
    typeTournaments: templateOutputContext.typeTournaments,
    top20BlendByTournament,
    trackOutput,
    recordOutput
  });
  const weightCalibrationOutputs = weightOutputsResult?.weightCalibrationOutputs || null;
  const weightTemplatesOutputs = weightOutputsResult?.weightTemplatesOutputs || null;

  validationOutputs.updateBaselineTemplateOutputs({
    blendedTemplatesByType: templateOutputContext.blendedByType,
    writeTemplates,
    dryRun,
    dryRunDir,
    postEventDir,
    updateComment: templateOutputContext.templateUpdateComment,
    logger
  });

  const modelDeltaTrends = buildModelDeltaTrends({ resultsJsonPath, season, dataRootDir });
  const modelDeltaJsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_MODEL_DELTA_TRENDS_JSON
  });
  const modelDeltaCsvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_MODEL_DELTA_TRENDS_CSV
  });
  trackOutput('modelDeltaTrends.json', modelDeltaJsonPath);
  trackOutput('modelDeltaTrends.csv', modelDeltaCsvPath);
  const modelDeltaTrendOutputs = validationOutputs.writeModelDeltaTrends(outputDir, modelDeltaTrends);
  recordOutput('modelDeltaTrends.json', modelDeltaTrendOutputs?.jsonPath);
  recordOutput('modelDeltaTrends.csv', modelDeltaTrendOutputs?.csvPath);

  const processingLogPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_PROCESSING_LOG_JSON
  });
  trackOutput('processingLog.json', processingLogPath);
  const processingLogPayload = buildProcessingLogPayload({
    resolvedSlug,
    tournamentName,
    eventId,
    season,
    skipMetricAnalysis,
    predictionsResult,
    resultsResult,
    resultsSourceInfo,
    config,
    rankingsJsonPath,
    rankingsCsvPath,
    resultsJsonPath,
    resultsCsvPath,
    configCsvPath,
    outputs,
    metricAnalysis,
    modelDeltaTrends
  });
  const processingLog = validationOutputs.writeProcessingLog(outputDir, processingLogPayload);
  recordOutput('processingLog.json', processingLog?.jsonPath || processingLogPath);

  return {
    outputDir,
    inputSummary,
    outputs: OUTPUT_NAMES,
    skipMetricAnalysis,
    tournamentSlug: resolvedSlug || null,
    tournamentDir: resolvedTournamentDir || null,
    inputsDir,
    preEventDir,
    postEventDir,
    config,
    templateConfig: WEIGHT_TEMPLATES || {},
    predictions: predictionsResult,
    results: resultsResult,
    evaluation,
    calibration: calibrationReportData,
    tournamentCalibration,
    seasonCalibration,
    calibrationOutputs,
    courseTypeClassification: classificationPayload,
    courseTypeClassificationOutputs: classificationOutputs,
    metricAnalysis,
    metricAnalysisOutputs,
    correlationSummaries,
    weightCalibrationOutputs,
    weightTemplatesOutputs,
    modelDeltaTrends,
    modelDeltaTrendOutputs,
    processingLog
  };
};

const validationCore = {
  OUTPUT_NAMES,
  METRIC_ORDER,
  getValidationOutputDir,
  shouldSkipMetricAnalysis,
  slugifyTournament,
  buildMetricAnalysis,
  buildMetricAnalysisPayload,
  buildMetricAnalysisAggregateList,
  buildCorrelationSummary,
  buildCourseTypeClassificationEntries,
  buildValidationAggregates,
  buildValidationCalibrationPayload,
  buildValidationRunContext,
  buildValidationInputSummary,
  createOutputTracker,
  buildValidationInputs,
  buildProcessingLogData,
  buildValidationSourceSummary,
  buildProcessingLogPayload,
  buildTemplateOutputContext,
  buildResultsSheetContext,
  buildExistingResultsPayloadSummary,
  buildResultsFromPayloadRows,
  buildModelDeltaTrends,
  buildCalibrationData,
  buildSeasonCalibrationData,
  buildSeasonPostEventSummary,
  evaluateTournamentPredictions,
  loadTournamentPredictions,
  loadTournamentResultsFromJson,
  loadTournamentResultsFromResultsCsv,
  loadTournamentResultsFromHistoricalCsv,
  loadTournamentResultsFromHistoricalApi,
  loadTournamentConfig
};

module.exports = {
  validationCore,
  validationOutputs,
  OUTPUT_NAMES,
  METRIC_ORDER,
  getValidationOutputDir,
  shouldSkipMetricAnalysis,
  slugifyTournament,
  buildMetricAnalysis,
  buildMetricAnalysisAggregateList,
  buildCorrelationSummary,
  buildCourseTypeClassificationEntries,
  buildModelDeltaTrends,
  buildValidationCalibrationPayload,
  buildValidationRunContext,
  buildValidationInputSummary,
  createOutputTracker,
  buildValidationInputs,
  buildProcessingLogData,
  buildValidationSourceSummary,
  buildProcessingLogPayload,
  buildTemplateOutputContext,
  buildResultsSheetContext,
  buildExistingResultsPayloadSummary,
  buildResultsFromPayloadRows,
  buildCalibrationData,
  buildSeasonCalibrationData,
  buildSeasonPostEventSummary,
  evaluateTournamentPredictions,
  loadTournamentPredictions,
  loadTournamentResultsFromJson,
  loadTournamentResultsFromResultsCsv,
  loadTournamentResultsFromHistoricalCsv,
  loadTournamentResultsFromHistoricalApi,
  loadTournamentConfig,
  ensureTournamentResults,
  runValidation,
  runSeasonValidation
};
