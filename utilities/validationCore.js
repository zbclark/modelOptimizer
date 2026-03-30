/**
 * Module: validationCore
 * Purpose: Compute-only validation helpers exposed for orchestration.
 * Notes: This module intentionally excludes formatting/writing functions.
 */

const fs = require('fs');
const path = require('path');
const { OUTPUT_NAMES } = require('./validationOutputNames');
const { METRIC_ORDER } = require('./validationConstants');
const {
  resolveValidationRoot,
  resolveValidationSubdir,
  buildOutputBaseName,
  OUTPUT_ARTIFACTS
} = require('./outputPaths');
const { OutputArtifactManager } = require('./outputArtifactManager');
const {
  loadSeasonManifestEntries,
  resolveManifestEntryForEvent,
  slugifyTournament,
  resolveNextManifestEntry,
  resolveApproachSnapshotPairForEvent
} = require('./manifestUtils');
const {
  buildSlugCandidates,
  inferTournamentNameFromInputs,
  resolveExistingPath,
  resolveResultsPath,
  resolveInputCsvPath,
  resolveRankingPath,
  resolveTournamentDir,
  listSeasonTournamentDirs
} = require('./tournamentPaths');
const { formatTimestamp } = require('./timeUtils');
const { formatTournamentDisplayName } = require('./namingUtils');
const { readJsonFile } = require('./fileUtils');
const { getSharedConfig } = require('./configParser');
const { WEIGHT_TEMPLATES } = require('./weightTemplates');
const {
  determineDetectedCourseType
} = require('./courseTypeUtils');
const {
  buildCorrelationSummary,
  buildCourseTypeClassificationEntries
} = require('./validationSummaries');
const { buildMetricAnalysis } = require('./validationMetricAnalysis');
const {
  buildBlendedTemplateMapsByType,
  flattenTemplateMetricWeights
} = require('./validationTemplateCore');
const {
  getConfigTemplateName,
  getConfigMetricWeights,
  buildConfigWeightsFromTemplate
} = require('./validationMetricOutputs');
const {
  evaluateTournamentPredictions
} = require('./evaluationMetrics');
const { loadTournamentPredictions } = require('./validationPredictions');
const {
  buildPlattSamples,
  fitPlattScaling,
  buildCalibrationData,
  mergeCalibrationData
} = require('./validationCalibration');
const {
  loadTournamentResultsFromJson,
  loadTournamentResultsFromResultsCsv,
  loadTournamentResultsFromHistoricalCsv,
  loadTournamentResultsFromHistoricalApi,
  buildResultsFromHistoricalRows,
  buildResultsFromHistoricalSnapshotPayload,
  resolveHistoricalRoundsCachePath,
  applyFinishFallback
} = require('./validationResultsCore');
const {
  RESULTS_METRIC_TYPES,
  RESULTS_REQUIRED_FIELDS,
  RESULT_METRIC_FIELDS
} = require('./validationResultsConstants');
const {
  normalizeFinishPosition,
  parseNumericValue
} = require('./parsingUtils');
const { loadCsv } = require('./csvLoader');
const resultsCsvUtils = require('./tournamentResultsCsv');
const {
  parseCsvRows,
  normalizeHeader,
  findHeaderRowIndex,
  buildHeaderIndexMap
} = require('./csvUtils');
const {
  APPROACH_SNAPSHOT_DIR,
  APPROACH_SNAPSHOT_YTD_LATEST_PATH,
  loadApproachRowsFromPath,
  resolveApproachCsvForEntry,
  computeEventOnlyApproachRows
} = require('./approachSnapshots');
const { loadApproachCsv, extractApproachRowsFromJson } = require('./approachDelta');
const { getDataGolfApproachSkill } = require('./dataGolfClient');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATAGOLF_API_KEY = String(process.env.DATAGOLF_API_KEY || '').trim();
const DATAGOLF_APPROACH_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.DATAGOLF_APPROACH_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 24 : Math.max(1, raw);
})();
const METRIC_ANALYSIS_VERSION = 3;

const getValidationOutputDir = (dataRootDir, season) => {
  return resolveValidationRoot({
    dataRoot: dataRootDir,
    season,
    workspaceRoot: ROOT_DIR
  });
};

const getMetricAnalysisDir = outputDir => {
  if (!outputDir) return null;
  return resolveValidationSubdir({ validationRoot: outputDir, kind: 'METRIC_ANALYSIS' });
};

const isMetricAnalysisPopulated = analysis => {
  if (!analysis || !Array.isArray(analysis.metrics)) return false;
  if (analysis.metrics.length === 0) return false;
  if (!analysis.courseType || String(analysis.courseType || '').trim() === '') return false;
  return analysis.metrics.some(entry => {
    const fieldCount = entry?.fieldCount ?? entry?.field_count ?? entry?.fieldCount;
    const top10Count = entry?.top10Count ?? entry?.top10_count;
    if (typeof fieldCount === 'number') return fieldCount > 0;
    if (typeof top10Count === 'number') return top10Count > 0;
    return false;
  });
};

const shouldSkipMetricAnalysis = (outputDir, tournamentSlug, resultsJsonPath) => {
  if (!outputDir || !tournamentSlug) return false;
  const metricDir = getMetricAnalysisDir(outputDir);
  const fileName = `${tournamentSlug}_metric_analysis.json`;
  const filePath = metricDir ? path.resolve(metricDir, fileName) : path.resolve(outputDir, fileName);
  if (!fs.existsSync(filePath)) return false;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isMetricAnalysisPopulated(payload)) return false;
    if (payload?.version !== METRIC_ANALYSIS_VERSION) return false;

    if (resultsJsonPath && fs.existsSync(resultsJsonPath)) {
      const stats = fs.statSync(resultsJsonPath);
      const resultsTime = stats?.mtime ? stats.mtime.getTime() : stats?.mtimeMs || 0;
      const analysisTime = payload?.generatedAt ? Date.parse(payload.generatedAt) : NaN;
      if (!Number.isNaN(analysisTime) && resultsTime > analysisTime) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
};

const captureOutputState = (label, filePath) => {
  if (!filePath || typeof filePath !== 'string') return null;
  return {
    label,
    path: filePath,
    existedBefore: fs.existsSync(filePath)
  };
};

const recordOutputWrite = (outputs, entry, written = true) => {
  if (!entry) return;
  outputs.push({
    ...entry,
    written
  });
};

const createOutputTracker = () => {
  const outputStates = new Map();
  const outputs = [];

  const trackOutput = (label, filePath) => {
    const entry = captureOutputState(label, filePath);
    if (entry?.path) outputStates.set(entry.path, entry);
    return entry;
  };

  const recordOutput = (label, filePath) => {
    if (!filePath) return;
    const entry = outputStates.get(filePath) || captureOutputState(label, filePath) || { label, path: filePath };
    recordOutputWrite(outputs, entry, true);
  };

  return {
    outputStates,
    outputs,
    trackOutput,
    recordOutput
  };
};

const buildValidationRunContext = ({
  season,
  dataRootDir,
  tournamentName,
  tournamentSlug,
  tournamentDir,
  eventId,
  scopeSeason
} = {}) => {
  const manifestEntries = loadSeasonManifestEntries(dataRootDir, season);
  const hasTournamentContext = !!(
    tournamentName ||
    tournamentSlug ||
    tournamentDir ||
    eventId
  );
  const manifestMatch = hasTournamentContext
    ? resolveManifestEntryForEvent(manifestEntries, {
        eventId,
        tournamentSlug,
        tournamentName
      })
    : null;
  const manifestSlug = manifestMatch?.tournamentSlug
    ? slugifyTournament(manifestMatch.tournamentSlug)
    : null;
  const resolvedSlug = hasTournamentContext
    ? (tournamentSlug || manifestSlug || slugifyTournament(tournamentName))
    : null;
  const outputDir = getValidationOutputDir(dataRootDir, season);
  const validationSubdirs = {
    metricAnalysis: resolveValidationSubdir({ validationRoot: outputDir, kind: 'METRIC_ANALYSIS' }),
    templateCorrelations: resolveValidationSubdir({ validationRoot: outputDir, kind: 'TEMPLATE_CORRELATION_SUMMARIES' }),
    top20Blend: resolveValidationSubdir({ validationRoot: outputDir, kind: 'TOP20_BLEND' }),
    seasonSummaries: scopeSeason
      ? resolveValidationSubdir({ validationRoot: outputDir, kind: 'SEASON_SUMMARIES' })
      : null
  };
  const resolvedTournamentDir = hasTournamentContext
    ? (tournamentDir || resolveTournamentDir(dataRootDir, season, tournamentName, resolvedSlug))
    : null;
  const slugCandidates = hasTournamentContext
    ? buildSlugCandidates({
        tournamentSlug: resolvedSlug,
        tournamentName,
        tournamentDir: resolvedTournamentDir
      })
    : [];
  const primarySlug = hasTournamentContext
    ? (slugCandidates[0] || resolvedSlug || slugifyTournament(tournamentName) || 'tournament')
    : null;
  const outputBaseName = hasTournamentContext
    ? buildOutputBaseName({
        tournamentSlug: resolvedSlug,
        tournamentName,
        eventId
      })
    : null;
  const outputArtifacts = hasTournamentContext
    ? new OutputArtifactManager({
        outputBaseName,
        tournamentSlug: resolvedSlug,
        tournamentName,
        validationRoot: outputDir,
        validationSubdirs
      })
    : null;
  const inputsDir = resolvedTournamentDir ? path.resolve(resolvedTournamentDir, 'inputs') : null;
  const preEventDir = resolvedTournamentDir ? path.resolve(resolvedTournamentDir, 'pre_event') : null;
  const postEventDir = resolvedTournamentDir ? path.resolve(resolvedTournamentDir, 'post_event') : null;
  const rankingsJsonPath = preEventDir
    ? resolveRankingPath(preEventDir, slugCandidates, '_pre_event_rankings.json')
      || path.resolve(preEventDir, `${primarySlug}_pre_event_rankings.json`)
    : null;
  const rankingsCsvPath = preEventDir
    ? resolveRankingPath(preEventDir, slugCandidates, '_pre_event_rankings.csv')
      || path.resolve(preEventDir, `${primarySlug}_pre_event_rankings.csv`)
    : null;
  const resultsBaseName = primarySlug;
  const resultsJsonPath = postEventDir
    ? resolveResultsPath(postEventDir, slugCandidates, resultsBaseName, ['_results.json', '_post_event_results.json'])
    : null;
  const resultsCsvPath = postEventDir
    ? resolveResultsPath(postEventDir, slugCandidates, resultsBaseName, ['_results.csv', '_post_event_results.csv'])
    : null;
  const legacyResultsJsonPath = postEventDir ? path.resolve(postEventDir, 'tournament_results.json') : null;
  const legacyResultsCsvPath = postEventDir ? path.resolve(postEventDir, 'tournament_results.csv') : null;
  const historyCsvPath = resolveInputCsvPath({
    inputsDir,
    season,
    suffix: 'Historical Data'
  });
  const configCsvPath = resolveInputCsvPath({
    inputsDir,
    season,
    suffix: 'Configuration Sheet'
  });
  const courseContextPath = path.resolve(__dirname, '..', 'utilities', 'course_context.json');

  return {
    manifestEntries,
    manifestMatch,
    manifestSlug,
    resolvedSlug,
    outputDir,
    validationSubdirs,
    resolvedTournamentDir,
    slugCandidates,
    primarySlug,
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
  };
};

const buildValidationInputSummary = ({
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
} = {}) => ({
  season,
  eventId: eventId || null,
  tournamentName: tournamentName || null,
  tournamentSlug: resolvedSlug || null,
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
  courseContextPath,
  top20BlendPath: null,
  approachEventOnly: null,
  sources: {}
});

const loadTournamentConfig = ({ configCsvPath, courseContextPath, eventId }) => {
  if (courseContextPath && fs.existsSync(courseContextPath)) {
    const courseContext = readJsonFile(courseContextPath);
    const eventKey = String(eventId || '').trim();
    const entry = courseContext && eventKey
      ? (courseContext.byEventId?.[eventKey] || courseContext[eventKey])
      : null;
    if (entry) {
      return {
        source: 'course_context',
        eventId: eventId || null,
        courseType: entry.courseType || entry.templateKey || null,
        templateKey: entry.templateKey || null,
        courseName: entry.courseName || entry.course || null,
        courseNum: entry.courseNum || null
      };
    }
  }

  if (configCsvPath && fs.existsSync(configCsvPath)) {
    const sharedConfig = getSharedConfig(configCsvPath);
    return {
      source: 'config_csv',
      eventId: sharedConfig?.currentEventId || eventId || null,
      courseType: sharedConfig?.courseType || null,
      courseName: sharedConfig?.courseNameRaw || null,
      courseNum: sharedConfig?.courseNum || null
    };
  }

  return {
    source: 'none',
    eventId: eventId || null,
    courseType: null,
    courseName: null,
    courseNum: null
  };
};

const buildExistingResultsPayloadSummary = ({ payload, modelData } = {}) => {
  const payloadRows = Array.isArray(payload?.results) ? payload.results : [];
  const hasModelData = modelData?.playersById?.size > 0;
  const needsMetricRebuild = payloadRows.length > 0 && payloadRows.some(row => {
    if (!row || typeof row !== 'object') return true;
    return RESULTS_REQUIRED_FIELDS.some(field => row[field] === undefined || row[field] === null || row[field] === '');
  });
  const needsEnrichment = hasModelData && payloadRows.some(row => {
    const dgId = String(row?.['DG ID'] || '').trim();
    if (!dgId) return false;
    const modelRank = row?.['Model Rank'];
    return (modelRank === '' || modelRank === null || modelRank === undefined)
      && modelData.playersById.has(dgId);
  });
  const shouldHydrateSheetCsv = !payload?.resultsSheetCsv;

  return {
    payloadRows,
    needsMetricRebuild,
    needsEnrichment,
    shouldHydrateSheetCsv
  };
};

const buildResultsFromPayloadRows = ({ payloadRows, includeMetrics = false } = {}) => {
  const rows = Array.isArray(payloadRows) ? payloadRows : [];
  return rows
    .map(row => {
      const dgId = String(row?.['DG ID'] || '').trim();
      if (!dgId) return null;
      const playerName = String(row?.['Player Name'] || row?.['Player'] || '').trim();
      const finishPosition = normalizeFinishPosition(row?.['Finish Position']);
      if (!includeMetrics) {
        return {
          dgId,
          playerName: playerName || 'Unknown',
          finishPosition
        };
      }
      const score = parseNumericValue(row?.Score ?? row?.score);
      const metrics = {};
      RESULT_METRIC_FIELDS.forEach(field => {
        metrics[field.key] = parseNumericValue(row?.[field.label]);
      });
      return {
        dgId,
        playerName: playerName || 'Unknown',
        finishPosition,
        score,
        metrics
      };
    })
    .filter(Boolean);
};

const normalizeDeltaKey = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const listApproachDeltaFiles = (dirs = []) => {
  const files = [];
  (dirs || []).forEach(dir => {
    if (!dir || !fs.existsSync(dir)) return;
    fs.readdirSync(dir)
      .filter(name => name.toLowerCase().endsWith('.json') && name.toLowerCase().includes('approach_deltas_'))
      .forEach(name => {
        const fullPath = path.resolve(dir, name);
        let mtime = 0;
        try {
          mtime = fs.statSync(fullPath).mtimeMs || 0;
        } catch {
          mtime = 0;
        }
        files.push({ name, path: fullPath, mtime });
      });
  });
  return files;
};

const stripDateSuffix = value => String(value || '')
  .replace(/([_-])\d{4}([_-])\d{2}([_-]\d{2}|-\d{2})$/i, '')
  .replace(/([_-])\d{4}([_-])\d{2}$/i, '')
  .replace(/[_-]+$/g, '');

const findApproachDeltaFile = (dirs, tournamentName, fallbackName) => {
  const slug = normalizeDeltaKey(slugifyTournament(tournamentName || fallbackName || ''));
  const candidates = listApproachDeltaFiles(dirs);
  if (!candidates.length) return null;

  if (slug) {
    const slugVariants = [slug, slug.replace(/-/g, '_')];
    const matches = candidates.filter(entry => {
      const base = normalizeDeltaKey(stripDateSuffix(entry.name));
      return slugVariants.some(variant => base.includes(variant));
    });
    if (matches.length === 1) return matches[0].path;
    if (matches.length > 1) {
      matches.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      return matches[0].path;
    }
  }

  candidates.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return candidates[0]?.path || null;
};

const loadApproachDeltaRows = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return { meta: null, rows: [] };
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(payload)) return { meta: null, rows: payload };
    if (Array.isArray(payload?.rows)) return { meta: payload?.meta || null, rows: payload.rows };
    return { meta: payload?.meta || null, rows: [] };
  } catch {
    return { meta: null, rows: [] };
  }
};

const parseModelRankingData = rankingsCsvPath => {
  if (!rankingsCsvPath || !fs.existsSync(rankingsCsvPath)) {
    return { playersById: new Map(), metricStats: {} };
  }

  const rows = parseCsvRows(rankingsCsvPath);
  const headerIndex = findHeaderRowIndex(rows, ['dg id', 'player name', 'rank']);
  if (headerIndex === -1) return { playersById: new Map(), metricStats: {} };
  const headers = rows[headerIndex];
  const headerMap = buildHeaderIndexMap(headers);

  const dgIdIdx = headerMap.get('dg id');
  const nameIdx = headerMap.get('player name');
  const rankIdx = headerMap.get('rank') ?? headerMap.get('model rank');
  const warIdx = headerMap.get('war');

  const metricIndices = new Map();
  RESULT_METRIC_FIELDS.forEach(field => {
    if (!field.label || field.hasModel === false) return;
    const idx = headerMap.get(normalizeHeader(field.label));
    if (idx !== undefined) metricIndices.set(field.label, idx);
  });

  const trendIndices = new Map();
  headers.forEach((header, idx) => {
    const headerText = String(header || '').trim();
    if (!headerText || !headerText.toLowerCase().includes('trend')) return;
    const baseMetric = headerText.replace(/\s*trend\s*$/i, '').trim();
    if (!RESULTS_METRIC_TYPES.HAS_MODEL.has(baseMetric)) return;
    trendIndices.set(baseMetric, idx);
  });

  const playersById = new Map();
  const metricBuckets = {};

  rows.slice(headerIndex + 1).forEach(row => {
    const dgId = dgIdIdx !== undefined ? String(row[dgIdIdx] || '').trim() : '';
    if (!dgId) return;
    const name = nameIdx !== undefined ? String(row[nameIdx] || '').trim() : '';
    const rankValue = rankIdx !== undefined ? parseInt(String(row[rankIdx] || '').trim(), 10) : NaN;
    const warValue = warIdx !== undefined ? parseNumericValue(row[warIdx]) : null;

    const metrics = {};
    metricIndices.forEach((idx, label) => {
      const value = parseNumericValue(row[idx]);
      if (typeof value === 'number' && !Number.isNaN(value)) {
        metrics[label] = value;
        if (!metricBuckets[label]) metricBuckets[label] = [];
        metricBuckets[label].push(value);
      }
    });

    const trends = {};
    trendIndices.forEach((idx, label) => {
      const value = parseNumericValue(row[idx]);
      if (typeof value === 'number' && !Number.isNaN(value)) {
        trends[label] = value;
      }
    });

    playersById.set(dgId, {
      dgId,
      name,
      rank: Number.isNaN(rankValue) ? null : rankValue,
      war: typeof warValue === 'number' ? warValue : null,
      metrics,
      trends
    });
  });

  const metricStats = {};
  Object.entries(metricBuckets).forEach(([label, values]) => {
    const count = values.length;
    if (!count) return;
    const mean = values.reduce((sum, value) => sum + value, 0) / count;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / count;
    metricStats[label] = {
      mean,
      stdDev: Math.sqrt(variance)
    };
  });

  return { playersById, metricStats };
};

const getCategoryForMetric = metricName => {
  if (!metricName) return '';
  const metricLower = String(metricName || '').toLowerCase();
  if (metricLower.includes('ott') || metricLower.includes('driving')) {
    return 'Driving';
  }
  if (metricLower.includes('approach') || metricLower.includes('iron')) {
    return 'Approach';
  }
  if (metricLower.includes('around') || metricLower.includes('arg') || metricLower.includes('short game')) {
    return 'Short Game';
  }
  if (metricLower.includes('putting') || metricLower.includes('putt')) {
    return 'Putting';
  }
  if (metricLower.includes('total') || metricLower.includes('t2g')) {
    return 'Overall';
  }
  if (metricLower.includes('gir') || metricLower.includes('greens')) {
    return 'Approach';
  }
  if (metricLower.includes('proximity') || metricLower.includes('prox')) {
    return 'Approach';
  }
  return '';
};

const buildPerformanceNotes = ({
  modelRank,
  finishPosition,
  finishText,
  modelData,
  metricStats,
  actualMetrics
}) => {
  const notes = [];
  const safeFinish = typeof finishPosition === 'number' ? finishPosition : null;
  const safeModelRank = typeof modelRank === 'number' ? modelRank : null;

  if (safeFinish !== null && safeModelRank !== null) {
    if (safeModelRank <= 10 && safeFinish <= 10) {
      notes.push(`🎯 Model prediction on target: #${safeModelRank} → ${finishText || safeFinish}`);
    } else if (safeFinish <= 10 && safeModelRank > 50) {
      notes.push(`⚠️ Major model miss: #${safeModelRank} → ${finishText || safeFinish}`);
    } else if (safeModelRank <= 10 && safeFinish > 50) {
      notes.push('⚠️ Model overestimated performance');
    } else if (Math.abs(safeModelRank - safeFinish) > 30) {
      const direction = safeModelRank > safeFinish ? 'better' : 'worse';
      notes.push(`${direction === 'better' ? '↑' : '↓'} Finished ${direction} than predicted`);
    }
  }

  const trends = modelData?.trends || {};
  const trendAnalysis = [];
  Object.entries(trends).forEach(([metricName, trendValue]) => {
    if (!RESULTS_METRIC_TYPES.HAS_MODEL.has(metricName)) return;
    const currentValue = actualMetrics?.[metricName];
    if (typeof currentValue !== 'number' || Number.isNaN(currentValue)) return;

    const stats = metricStats?.[metricName] || null;
    let isTrendSignificant = false;
    let trendZScore = null;
    if (stats?.stdDev && stats.stdDev > 0) {
      const trendStdDev = stats.stdDev * 0.2;
      trendZScore = trendValue / trendStdDev;
      isTrendSignificant = Math.abs(trendZScore) > 1.96;
    } else {
      isTrendSignificant = Math.abs(trendValue) > 0.05;
    }

    if (!isTrendSignificant) return;

    const isHigherBetter = !RESULTS_METRIC_TYPES.LOWER_BETTER.has(metricName);
    let isGoodPerformance = false;
    if (metricName.includes('SG')) {
      isGoodPerformance = isHigherBetter ? currentValue > 0 : currentValue < 0;
    } else if (stats?.mean !== undefined && stats.mean !== null) {
      isGoodPerformance = isHigherBetter ? currentValue > stats.mean : currentValue < stats.mean;
    } else {
      isGoodPerformance = isHigherBetter ? currentValue > 0 : currentValue < 0;
    }

    const isPositiveTrend = trendValue > 0;
    const isCorrelationConfirmed = (isPositiveTrend && isGoodPerformance) || (!isPositiveTrend && !isGoodPerformance);
    const significanceScore = Math.abs(trendValue) * (isCorrelationConfirmed ? 2 : 1);

    trendAnalysis.push({
      metric: metricName,
      trendValue,
      correlation: isCorrelationConfirmed ? 'confirmed' : 'contradicted',
      direction: isPositiveTrend ? 'improving' : 'declining',
      significance: significanceScore
    });
  });

  trendAnalysis.sort((a, b) => b.significance - a.significance);
  if (trendAnalysis.length > 0) {
    const primary = trendAnalysis[0];
    const category = getCategoryForMetric(primary.metric);
    if (category) {
      const arrow = primary.direction === 'improving' ? '↑' : '↓';
      notes.push(`${arrow} ${category}`);
    }

    trendAnalysis.slice(0, 3).forEach(trend => {
      const emoji = trend.direction === 'improving' ? '📈' : '📉';
      const trendDisplay = Math.abs(trend.trendValue).toFixed(3);
      notes.push(`${emoji} ${trend.metric}: ${trend.correlation === 'confirmed' ? 'trend continuing' : 'trend reversing'} (${trendDisplay})`);
    });
  }

  if (typeof modelData?.war === 'number') {
    const war = modelData.war;
    if (war >= 1.0) {
      notes.push(`⭐ Elite performer (WAR: ${war.toFixed(1)})`);
    } else if (war >= 0.5) {
      notes.push('↑ Above average performer');
    } else if (war <= -0.5) {
      notes.push('↓ Below average performer');
    }
  }

  if (safeFinish !== null && safeModelRank !== null) {
    const performedWell = safeFinish <= 20;
    const predictedWell = safeModelRank <= 20;
    if (performedWell && predictedWell) {
      notes.push('✅ Success aligned with model');
    } else if (performedWell && !predictedWell) {
      notes.push('⚠️ Success despite model prediction');
    } else if (!performedWell && predictedWell) {
      notes.push('❌ Underperformed model prediction');
    }
  }

  if (!notes.length) {
    return '';
  }
  return notes.join(' | ');
};

const buildTournamentResultsRows = ({
  results,
  modelData,
  metricStats
}) => {
  const rows = [];
  const normalizedStats = metricStats || {};

  (results || []).forEach(entry => {
    const dgId = String(entry?.dgId || '').trim();
    if (!dgId) return;
    const playerName = entry?.playerName || entry?.name || 'Unknown';
    const modelEntry = modelData?.playersById?.get(dgId) || null;
    const modelRank = modelEntry?.rank ?? null;
    const finishPosition = entry?.finishPosition ?? null;
    const finishText = entry?.finishText || (finishPosition !== null ? String(finishPosition) : '');
    const actualMetrics = {};

    const row = {
      'Performance Analysis': '',
      'DG ID': dgId,
      'Player Name': playerName,
      'Model Rank': modelRank ?? '',
      'Finish Position': finishText || (finishPosition !== null ? String(finishPosition) : ''),
      'Score': entry?.score ?? ''
    };

    RESULT_METRIC_FIELDS.forEach(field => {
      const value = entry?.metrics?.[field.key];
      if (field.hasModel === false) {
        row[field.label] = typeof value === 'number' ? value : '';
        return;
      }
      const modelValue = modelEntry?.metrics?.[field.label];
      row[field.label] = typeof value === 'number' ? value : '';
      row[`${field.label} - Model`] = typeof modelValue === 'number' ? modelValue : '';
      if (typeof value === 'number' && !Number.isNaN(value)) {
        actualMetrics[field.label] = value;
      }
    });

    row['Performance Analysis'] = buildPerformanceNotes({
      modelRank,
      finishPosition,
      finishText,
      modelData: modelEntry,
      metricStats: normalizedStats,
      actualMetrics
    });

    rows.push(row);
  });

  rows.sort((a, b) => {
    const posA = normalizeFinishPosition(a['Finish Position']) ?? 999;
    const posB = normalizeFinishPosition(b['Finish Position']) ?? 999;
    return posA - posB;
  });

  return rows;
};

const buildZScoresForRows = (rows, metricStats) => {
  return rows.map(row => {
    const zScores = {};
    Object.entries(metricStats || {}).forEach(([metric, stats]) => {
      const value = row[metric];
      if (typeof value !== 'number' || Number.isNaN(value)) return;
      if (!stats || !stats.stdDev || stats.stdDev === 0) return;
      zScores[metric] = (value - stats.mean) / stats.stdDev;
    });
    return {
      dgId: row['DG ID'],
      zScores
    };
  });
};

const computeMetricStatsFromResults = results => {
  const buckets = {};
  (results || []).forEach(entry => {
    RESULT_METRIC_FIELDS.forEach(field => {
      if (!field.label || field.hasModel === false) return;
      const value = entry?.[field.label];
      if (typeof value !== 'number' || Number.isNaN(value)) return;
      if (!buckets[field.label]) buckets[field.label] = [];
      buckets[field.label].push(value);
    });
  });

  const stats = {};
  Object.entries(buckets).forEach(([label, values]) => {
    const count = values.length;
    if (!count) return;
    const mean = values.reduce((sum, value) => sum + value, 0) / count;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / count;
    stats[label] = { mean, stdDev: Math.sqrt(variance) };
  });

  return stats;
};

const buildResultsSheetContext = ({
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
} = {}) => {
  const safeResults = Array.isArray(results) ? results : [];
  const safeModelData = modelData || { playersById: new Map(), metricStats: {} };
  const rows = buildTournamentResultsRows({
    results: safeResults,
    modelData: safeModelData,
    metricStats: safeModelData.metricStats
  });
  const metricStats = computeMetricStatsFromResults(rows);
  const zScores = buildZScoresForRows(rows, metricStats);
  const resultMetricSpecs = resultsCsvUtils.buildResultsMetricSpecs();
  const rankingsById = resultsCsvUtils.parseRankingCsvModelValues(rankingsCsvPath, resultMetricSpecs);
  const resultsById = new Map(
    safeResults
      .filter(entry => entry && entry.dgId)
      .map(entry => [String(entry.dgId).trim(), entry.finishPosition])
  );
  const historyRows = historyCsvPath && fs.existsSync(historyCsvPath)
    ? loadCsv(historyCsvPath, { skipFirstColumn: true })
    : [];
  const actualMetricsById = resultsCsvUtils.buildActualMetricsFromHistory(historyRows, eventId, season);
  const actualTrendsById = resultsCsvUtils.buildActualTrendsFromHistory(historyRows, eventId, season);

  const approachDeltaDirs = [
    dataRootDir ? path.resolve(dataRootDir, 'approach_deltas') : null,
    path.resolve(ROOT_DIR, 'data', 'approach_deltas'),
    resultsDir
  ].filter(Boolean);
  const approachDeltaPath = findApproachDeltaFile(approachDeltaDirs, tournamentName, tournamentSlug);
  const approachDeltaRows = approachDeltaPath
    ? (loadApproachDeltaRows(approachDeltaPath)?.rows || [])
    : [];
  const approachDeltaById = resultsCsvUtils.buildApproachDeltaMap(approachDeltaRows);
  const resultsSheetCsv = resultsCsvUtils.buildPostEventResultsCsv({
    rankingsById,
    resultsById,
    actualMetricsById,
    actualTrendsById,
    approachDeltaById
  });

  return {
    rows,
    metricStats,
    zScores,
    resultsSheetCsv,
    approachDeltaPath
  };
};

const buildValidationInputs = ({
  outputDir,
  resolvedSlug,
  rankingsJsonPath,
  rankingsCsvPath,
  resultsJsonPath,
  resultsCsvPath,
  legacyResultsJsonPath,
  legacyResultsCsvPath,
  historyCsvPath,
  eventId,
  season
} = {}) => {
  const predictionsResult = loadTournamentPredictions({
    rankingsJsonPath,
    rankingsCsvPath,
    resultsJsonPath,
    resultsCsvPath
  });

  const resultsResult = (() => {
    const fromJson = loadTournamentResultsFromJson(resultsJsonPath);
    if (fromJson.results.length > 0) return fromJson;
    const fromLegacyJson = loadTournamentResultsFromJson(legacyResultsJsonPath);
    if (fromLegacyJson.results.length > 0) return fromLegacyJson;
    const fromCsv = loadTournamentResultsFromResultsCsv(resultsCsvPath);
    if (fromCsv.results.length > 0) return fromCsv;
    const fromLegacyCsv = loadTournamentResultsFromResultsCsv(legacyResultsCsvPath);
    if (fromLegacyCsv.results.length > 0) return fromLegacyCsv;
    return loadTournamentResultsFromHistoricalCsv(historyCsvPath, eventId, season);
  })();

  let skipMetricAnalysis = resolvedSlug
    ? shouldSkipMetricAnalysis(outputDir, resolvedSlug, resultsJsonPath)
    : false;
  const seedSkip = !skipMetricAnalysis && resolvedSlug && resolvedSlug.includes('seed-');
  if (seedSkip) {
    skipMetricAnalysis = true;
  }

  return {
    predictionsResult,
    resultsResult,
    skipMetricAnalysis,
    seedSkip
  };
};

const buildMetricAnalysisAggregateList = ({
  outputDir,
  metricAnalysis,
  resolvedSlug,
  scopeSeason
} = {}) => {
  const metricAnalysisDir = getMetricAnalysisDir(outputDir);
  const existingMetricAnalyses = metricAnalysisDir && fs.existsSync(metricAnalysisDir)
    ? fs.readdirSync(metricAnalysisDir)
        .filter(name => name.endsWith('_metric_analysis.json'))
        .map(name => readJsonFile(path.resolve(metricAnalysisDir, name)))
        .filter(Boolean)
    : [];

  const normalizeTournamentKey = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');

  const allMetricAnalyses = (() => {
    const normalizedCurrentSlug = normalizeTournamentKey(resolvedSlug || metricAnalysis?.tournament || '');
    const merged = [];
    const seen = new Set();

    existingMetricAnalyses.forEach(entry => {
      const tournamentKey = normalizeTournamentKey(entry?.tournament || '');
      if (!tournamentKey) return;
      if (normalizedCurrentSlug && metricAnalysis && tournamentKey === normalizedCurrentSlug) {
        return;
      }
      if (seen.has(tournamentKey)) return;
      seen.add(tournamentKey);
      merged.push(entry);
    });

    if (metricAnalysis?.tournament) {
      const metricKey = normalizeTournamentKey(metricAnalysis.tournament);
      if (metricKey && !seen.has(metricKey)) {
        seen.add(metricKey);
        merged.push(metricAnalysis);
      }
    }

    if (scopeSeason) {
      return merged;
    }

    // Single-tournament runs still aggregate season validation context so
    // correlation summaries/classification/template guides are computed from
    // all available tournaments before any downstream template updates.
    return merged;
  })();

  return { allMetricAnalyses };
};

const buildProcessingLogData = ({
  predictionsResult,
  resultsResult,
  metricAnalysis,
  modelDeltaTrends
} = {}) => ({
  predictionsCount: predictionsResult?.predictions?.length ?? 0,
  resultsCount: resultsResult?.results?.length ?? 0,
  metricAnalysis: metricAnalysis
    ? {
        metrics: metricAnalysis.metrics.length,
        top10Finishers: metricAnalysis.top10Finishers,
        totalFinishers: metricAnalysis.totalFinishers
      }
    : null,
  modelDeltaTrends: modelDeltaTrends
    ? {
        metrics: modelDeltaTrends.metrics.length,
        totalSamples: modelDeltaTrends.meta?.totalSamples ?? null,
        tournamentCount: modelDeltaTrends.meta?.tournamentCount ?? null,
        source: modelDeltaTrends.meta?.source ?? null
      }
    : null
});

const buildValidationSourceSummary = ({
  config,
  resultsSourceInfo,
  predictionsResult
} = {}) => ({
  config: config?.source || null,
  resultsGeneratedFrom: resultsSourceInfo?.source || null,
  rankings: predictionsResult?.source || null
});

const buildProcessingLogPayload = ({
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
} = {}) => ({
  tournament: resolvedSlug || tournamentName || null,
  eventId: config?.eventId || eventId || null,
  season,
  skipMetricAnalysis,
  dataProcessed: buildProcessingLogData({
    predictionsResult,
    resultsResult,
    metricAnalysis,
    modelDeltaTrends
  }),
  inputs: {
    rankingsJsonPath,
    rankingsCsvPath,
    resultsJsonPath,
    resultsCsvPath,
    configCsvPath
  },
  sources: {
    rankings: predictionsResult?.source || null,
    results: resultsResult?.source || null,
    resultsGeneratedFrom: resultsSourceInfo?.source || null,
    config: config?.source || null
  },
  outputs
});

const buildTemplateOutputContext = ({
  dataRootDir,
  season,
  tournamentName,
  summariesByType,
  templatesByType,
  top20BlendByTournament,
  byType
} = {}) => {
  const configInfo = collectTournamentConfigInfo({ dataRootDir, season });
  const typeTournaments = {
    POWER: byType?.POWER?.map(entry => entry.tournament).filter(Boolean) || [],
    TECHNICAL: byType?.TECHNICAL?.map(entry => entry.tournament).filter(Boolean) || [],
    BALANCED: byType?.BALANCED?.map(entry => entry.tournament).filter(Boolean) || []
  };
  const blendedByType = buildBlendedTemplateMapsByType({
    summariesByType,
    templatesByType,
    top20BlendByTournament
  });
  const templateUpdateComment =
    tournamentName ? `Updated after ${tournamentName}` :
    season ? `Updated after season ${season}` :
    null;

  return {
    configInfo,
    typeTournaments,
    blendedByType,
    templateUpdateComment
  };
};

const collectTournamentConfigInfo = ({ dataRootDir, season }) => {
  const configInfo = new Map();
  const eventMap = loadSeasonManifest(dataRootDir, season);
  const courseContextPath = path.resolve(__dirname, '..', 'utilities', 'course_context.json');
  const courseContext = courseContextPath && fs.existsSync(courseContextPath)
    ? readJsonFile(courseContextPath)
    : null;
  const tournamentDirs = listSeasonTournamentDirs(dataRootDir, season);
  tournamentDirs.forEach(tournamentDir => {
    const slug = path.basename(tournamentDir);
    const inputsDir = path.resolve(tournamentDir, 'inputs');
    const fallbackName = formatTournamentDisplayName(slug);
    const displayName = inferTournamentNameFromInputs(inputsDir, season, fallbackName) || fallbackName;
    if (fs.existsSync(inputsDir)) {
      const files = fs.readdirSync(inputsDir).filter(file => file.toLowerCase().includes('configuration sheet'));
      if (files.length > 0) {
        const seasonTag = season ? `(${season})` : null;
        const preferred = seasonTag
          ? files.find(file => file.includes(seasonTag))
          : null;
        const configFile = preferred || files[0];
        if (configFile) {
          const configCsvPath = path.resolve(inputsDir, configFile);
          configInfo.set(slug, {
            slug,
            displayName: displayName && season ? `${displayName} (${season})` : displayName,
            configCsvPath,
            templateName: getConfigTemplateName(configCsvPath) || null,
            configWeights: getConfigMetricWeights(configCsvPath)
          });
          return;
        }
      }
    }

    const eventId = eventMap.get(slug) || null;
    const contextEntry = eventId && courseContext?.byEventId
      ? courseContext.byEventId[String(eventId).trim()]
      : null;
    const templateKey = contextEntry?.templateKey || null;
    const template = templateKey ? WEIGHT_TEMPLATES?.[templateKey] : null;
    const fallbackWeights = buildConfigWeightsFromTemplate(template);
    if (templateKey && template) {
      configInfo.set(slug, {
        slug,
        displayName: displayName && season ? `${displayName} (${season})` : displayName,
        configCsvPath: null,
        templateName: templateKey,
        configWeights: fallbackWeights
      });
    }
  });

  return configInfo;
};

const extractModelDeltasFromResults = resultsPayload => {
  if (!Array.isArray(resultsPayload) || resultsPayload.length === 0) return {};
  const sample = resultsPayload.find(entry => entry && typeof entry === 'object');
  if (!sample) return {};

  const keys = Object.keys(sample);
  const pairs = [];
  keys.forEach(key => {
    const label = String(key || '').trim();
    if (!label.toLowerCase().endsWith(' - model')) return;
    const baseKey = label.substring(0, label.length - ' - model'.length).trim();
    if (keys.includes(baseKey)) {
      pairs.push({ base: baseKey, model: label });
    }
  });

  if (pairs.length === 0) return {};

  const deltas = {};
  resultsPayload.forEach(row => {
    const finishRaw = row?.['Finish Position'] ?? row?.finishPosition ?? row?.finish ?? row?.position;
    const finishPos = normalizeFinishPosition(finishRaw);
    if (typeof finishPos !== 'number' || Number.isNaN(finishPos)) return;

    pairs.forEach(pair => {
      const modelValue = parseNumericValue(row[pair.model]);
      const actualValue = parseNumericValue(row[pair.base]);
      if (modelValue === null && actualValue === null) return;
      const safeModel = modelValue === null ? 0 : modelValue;
      const safeActual = actualValue === null ? 0 : actualValue;
      if (!deltas[pair.base]) deltas[pair.base] = [];
      deltas[pair.base].push(safeModel - safeActual);
    });
  });

  return deltas;
};

const buildModelDeltaTrends = ({ resultsJsonPath, season, dataRootDir }) => {
  const buckets = {};
  let tournamentCount = 0;
  let source = null;

  const mergeDeltas = deltas => {
    Object.entries(deltas || {}).forEach(([metric, values]) => {
      if (!buckets[metric]) buckets[metric] = [];
      buckets[metric].push(...values);
    });
  };

  const appendFromPayload = payload => {
    const rows = Array.isArray(payload) ? payload : payload?.results || payload?.resultsCurrent;
    if (!Array.isArray(rows) || rows.length === 0) return;
    mergeDeltas(extractModelDeltasFromResults(rows));
  };

  if (season && dataRootDir) {
    source = 'season_aggregate';
    const tournamentDirs = listSeasonTournamentDirs(dataRootDir, season);
    tournamentDirs.forEach(tournamentDir => {
      const tournamentSlug = path.basename(tournamentDir);
      const inputsDir = path.resolve(tournamentDir, 'inputs');
      const fallbackName = formatTournamentDisplayName(tournamentSlug);
      const tournamentName = inferTournamentNameFromInputs(inputsDir, season, fallbackName) || fallbackName;
      const slugCandidates = buildSlugCandidates({
        tournamentSlug,
        tournamentName,
        tournamentDir
      });
      const primarySlug = slugCandidates[0] || tournamentSlug || slugifyTournament(tournamentName) || 'tournament';
      const postEventDir = path.resolve(tournamentDir, 'post_event');
      const resolvedResultsJsonPath = resolveExistingPath(postEventDir, slugCandidates, '_results.json')
        || path.resolve(postEventDir, `${primarySlug}_results.json`);
      const legacyResultsJsonPath = path.resolve(postEventDir, 'tournament_results.json');
      const payload = readJsonFile(resolvedResultsJsonPath) || readJsonFile(legacyResultsJsonPath);
      if (!payload) return;
      tournamentCount += 1;
      appendFromPayload(payload);
    });
  } else if (resultsJsonPath) {
    source = 'single_tournament';
    const payload = readJsonFile(resultsJsonPath);
    if (payload) appendFromPayload(payload);
  }

  const metrics = [];

  Object.entries(buckets).forEach(([metric, values]) => {
    const filtered = values.filter(value => typeof value === 'number' && !Number.isNaN(value));
    const count = filtered.length;
    if (!count) return;
    const mean = filtered.reduce((sum, value) => sum + value, 0) / count;
    const meanAbs = filtered.reduce((sum, value) => sum + Math.abs(value), 0) / count;
    const variance = filtered.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / count;
    const stdDev = Math.sqrt(variance);
    const overCount = filtered.filter(value => value > 0).length;
    const underCount = filtered.filter(value => value < 0).length;
    const biasZ = stdDev > 0 ? Math.abs(mean) / stdDev : (Math.abs(mean) > 0 ? 1 : 0);

    let status = 'WATCH';
    if (count >= 20 && biasZ <= 0.2) status = 'STABLE';
    if (count >= 20 && biasZ >= 0.75) status = 'CHRONIC';

    metrics.push({
      metric,
      count,
      meanDelta: mean,
      meanAbsDelta: meanAbs,
      stdDev,
      biasZ,
      overPct: count > 0 ? (overCount / count) * 100 : 0,
      underPct: count > 0 ? (underCount / count) * 100 : 0,
      status
    });
  });

  metrics.sort((a, b) => (b.biasZ || 0) - (a.biasZ || 0));
  const totalSamples = Object.values(buckets).reduce((sum, values) => sum + (values?.length || 0), 0);
  return {
    generatedAt: formatTimestamp(new Date()),
    metrics,
    meta: {
      source,
      tournamentCount: source === 'season_aggregate' ? tournamentCount : null,
      totalSamples
    }
  };
};

const buildSeasonCalibrationData = ({ season, dataRootDir, logger = console }) => {
  const tournamentDirs = listSeasonTournamentDirs(dataRootDir, season);
  const aggregate = {
    tournaments: [],
    calibrationBuckets: null,
    plattCalibration: null,
    plattSamples: { top10: [], top20: [] },
    totalTop5: 0,
    predictedTop5InTop20: 0,
    totalTop10: 0,
    predictedTop10InTop30: 0,
    generatedAt: formatTimestamp(new Date())
  };

  tournamentDirs.forEach(tournamentDir => {
    const tournamentSlug = path.basename(tournamentDir);
    const inputsDir = path.resolve(tournamentDir, 'inputs');
    const preEventDir = path.resolve(tournamentDir, 'pre_event');
    const postEventDir = path.resolve(tournamentDir, 'post_event');

    const fallbackName = formatTournamentDisplayName(tournamentSlug);
    const tournamentName = inferTournamentNameFromInputs(inputsDir, season, fallbackName) || fallbackName;
    const slugCandidates = buildSlugCandidates({
      tournamentSlug,
      tournamentName,
      tournamentDir
    });
    const primarySlug = slugCandidates[0] || tournamentSlug || slugifyTournament(tournamentName) || 'tournament';

    const findSuffixedPreEventRanking = suffix => {
      if (!preEventDir || !fs.existsSync(preEventDir)) return null;
      const entries = fs.readdirSync(preEventDir, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name);
      const candidates = entries.filter(name => name.endsWith(suffix));
      if (!candidates.length) return null;
      const normalizedCandidates = candidates.map(name => ({
        name,
        lower: name.toLowerCase()
      }));
      const slugMatch = normalizedCandidates.find(entry =>
        slugCandidates.some(slug => {
          const slugNorm = String(slug || '').toLowerCase();
          if (!slugNorm) return false;
          return entry.lower.startsWith(`${slugNorm}_`)
            || entry.lower.startsWith(`${slugNorm}-`)
            || entry.lower.includes(`${slugNorm}_`)
            || entry.lower.includes(`${slugNorm}-`);
        })
      );
      const selected = slugMatch?.name || candidates[0];
      return selected ? path.resolve(preEventDir, selected) : null;
    };

    const resolveRankingsPath = suffix => {
      if (!preEventDir) return null;
      const resolved = resolveExistingPath(preEventDir, slugCandidates, suffix)
        || path.resolve(preEventDir, `${primarySlug}${suffix}`);
      if (resolved && fs.existsSync(resolved)) return resolved;
      return findSuffixedPreEventRanking(suffix) || resolved;
    };

    const rankingsJsonPath = resolveRankingsPath('_pre_event_rankings.json');
    const rankingsCsvPath = resolveRankingsPath('_pre_event_rankings.csv');
    const resultsJsonPath = postEventDir
      ? resolveResultsPath(postEventDir, slugCandidates, primarySlug, ['_results.json', '_post_event_results.json'])
      : null;
    const resultsCsvPath = postEventDir
      ? resolveResultsPath(postEventDir, slugCandidates, primarySlug, ['_results.csv', '_post_event_results.csv'])
      : null;
    const legacyResultsJsonPath = postEventDir ? path.resolve(postEventDir, 'tournament_results.json') : null;
    const legacyResultsCsvPath = postEventDir ? path.resolve(postEventDir, 'tournament_results.csv') : null;

    const predictionsResult = loadTournamentPredictions({
      rankingsJsonPath,
      rankingsCsvPath,
      resultsJsonPath,
      resultsCsvPath
    });

    const resultsResult = (() => {
      const fromJson = loadTournamentResultsFromJson(resultsJsonPath);
      if (fromJson.results.length > 0) return fromJson;
      const fromLegacyJson = loadTournamentResultsFromJson(legacyResultsJsonPath);
      if (fromLegacyJson.results.length > 0) return fromLegacyJson;
      const fromCsv = loadTournamentResultsFromResultsCsv(resultsCsvPath);
      if (fromCsv.results.length > 0) return fromCsv;
      const fromLegacyCsv = loadTournamentResultsFromResultsCsv(legacyResultsCsvPath);
      if (fromLegacyCsv.results.length > 0) return fromLegacyCsv;
      return { source: 'missing', results: [] };
    })();

    if (predictionsResult.predictions.length === 0 || resultsResult.results.length === 0) {
      logger.log(`ℹ️  Calibration skip (${tournamentSlug}): missing predictions or results.`);
      return;
    }

    aggregate.plattSamples.top10.push(
      ...buildPlattSamples(predictionsResult.predictions, resultsResult.results, 10)
    );
    aggregate.plattSamples.top20.push(
      ...buildPlattSamples(predictionsResult.predictions, resultsResult.results, 20)
    );

    let displayName = tournamentName;
    if (resultsJsonPath && fs.existsSync(resultsJsonPath)) {
      const payload = readJsonFile(resultsJsonPath);
      displayName = payload?.tournament || payload?.eventName || displayName;
    }

    const calibration = buildCalibrationData({
      tournamentName: displayName,
      predictions: predictionsResult.predictions,
      results: resultsResult.results
    });

    mergeCalibrationData(aggregate, calibration);
  });

  aggregate.plattCalibration = {
    top10: fitPlattScaling(aggregate.plattSamples.top10),
    top20: fitPlattScaling(aggregate.plattSamples.top20)
  };
  aggregate.plattSamples = {
    top10Count: aggregate.plattSamples.top10.length,
    top20Count: aggregate.plattSamples.top20.length
  };
  return aggregate;
};

const loadSeasonManifest = (dataRootDir, season) => {
  const map = new Map();
  const entries = loadSeasonManifestEntries(dataRootDir, season);
  entries.forEach(entry => {
    const slug = String(entry?.tournamentSlug || '').trim();
    const eventId = entry?.eventId !== undefined && entry?.eventId !== null
      ? String(entry.eventId).trim()
      : null;
    if (!slug || !eventId) return;
    map.set(slug, eventId);
  });
  return map;
};

const buildValidationAggregates = ({
  allMetricAnalyses,
  season,
  outputDir,
  validationSubdirs,
  outputBaseName,
  resolvedSlug,
  tournamentName,
  templatesByType
} = {}) => {
  const top20BlendByTournament = new Map();
  const normalizeTournamentKey = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');

  const resolveTop20BlendPath = ({
    validationRoot,
    validationSubdirs = {},
    outputBaseName,
    tournamentSlug,
    tournamentName
  }) => {
    if (!validationRoot) return null;

    const outputArtifacts = new OutputArtifactManager({
      outputBaseName,
      tournamentSlug,
      tournamentName,
      validationRoot,
      validationSubdirs
    });

    const preferred = outputArtifacts.buildPath({
      artifactType: OUTPUT_ARTIFACTS.TOP20_TEMPLATE_BLEND_JSON
    });
    if (preferred && fs.existsSync(preferred)) return preferred;

    const legacy = outputArtifacts
      .withDefaults({ validationSubdirs: {} })
      .buildPath({ artifactType: OUTPUT_ARTIFACTS.TOP20_TEMPLATE_BLEND_JSON });
    if (legacy && fs.existsSync(legacy)) return legacy;

    const fallback = path.resolve(validationRoot, 'top20_template_blend.json');
    return fs.existsSync(fallback) ? fallback : null;
  };

  const loadTop20BlendOutput = filePath => {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!payload || typeof payload !== 'object') return null;
      const signalMap = payload.signalMap && typeof payload.signalMap === 'object'
        ? payload.signalMap
        : null;
      const blendedGroups = payload.blendedGroups && typeof payload.blendedGroups === 'object'
        ? payload.blendedGroups
        : null;
      const blendedMetrics = payload.blendedMetrics && typeof payload.blendedMetrics === 'object'
        ? payload.blendedMetrics
        : null;
      return {
        sourcePath: filePath,
        meta: payload.meta || null,
        signalMap,
        blendedGroups,
        blendedMetrics
      };
    } catch {
      return null;
    }
  };

  const normalizeBlendMetricLabel = label => String(label || '')
    .replace(/^(Scoring|Course Management):\s*/i, '')
    .trim();

  const computeTemplateAlignmentFromBlend = (blendOutput, templatesByType = {}) => {
    if (!blendOutput || !blendOutput.signalMap) return null;
    const signalEntries = Object.entries(blendOutput.signalMap)
      .map(([label, value]) => [normalizeBlendMetricLabel(label), value])
      .filter(([label]) => !!label);
    if (!signalEntries.length) return null;

    const scores = {};
    ['POWER', 'TECHNICAL', 'BALANCED'].forEach(type => {
      const template = templatesByType[type];
      if (!template) return;
      const flatMetrics = flattenTemplateMetricWeights(template);
      const weightMap = new Map();
      let total = 0;
      flatMetrics.forEach(entry => {
        const label = normalizeBlendMetricLabel(entry.metric);
        if (!label) return;
        const weight = Math.abs(entry.weight || 0);
        if (!weight) return;
        weightMap.set(label, weight);
        total += weight;
      });
      if (!total) return;
      let dot = 0;
      signalEntries.forEach(([label, value]) => {
        const weight = weightMap.get(label) || 0;
        if (!weight) return;
        dot += value * (weight / total);
      });
      scores[type] = dot;
    });

    const ordered = Object.entries(scores).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    const recommendedType = ordered[0]?.[0] || null;
    return { scores, recommendedType };
  };

  const top20BlendPath = resolveTop20BlendPath({
    validationRoot: outputDir,
    validationSubdirs,
    outputBaseName,
    tournamentSlug: resolvedSlug,
    tournamentName
  });

  allMetricAnalyses.forEach(entry => {
    const tournamentSlug = entry?.tournament || null;
    if (!tournamentSlug) return;
    const blendPath = resolveTop20BlendPath({
      validationRoot: outputDir,
      validationSubdirs,
      outputBaseName,
      tournamentSlug,
      tournamentName
    });
    const blendOutput = loadTop20BlendOutput(blendPath);
    if (!blendOutput) return;
    const alignment = computeTemplateAlignmentFromBlend(blendOutput, templatesByType);
    if (!alignment) return;
    top20BlendByTournament.set(tournamentSlug, {
      ...alignment,
      sourcePath: blendOutput.sourcePath,
      meta: blendOutput.meta || null,
      signalMap: blendOutput.signalMap || null,
      blendedGroups: blendOutput.blendedGroups || null,
      blendedMetrics: blendOutput.blendedMetrics || null
    });
  });

  const classificationPayload = {
    generatedAt: formatTimestamp(new Date()),
    entries: buildCourseTypeClassificationEntries({
      metricAnalyses: allMetricAnalyses,
      season,
      top20BlendByTournament
    })
  };

  const classifiedTypeByTournament = new Map();
  (classificationPayload.entries || [])
    .filter(entry => entry?.tournament && entry?.courseType)
    .forEach(entry => {
      const type = String(entry.courseType).trim().toUpperCase();
      const tournamentKey = normalizeTournamentKey(entry.tournament);
      if (tournamentKey) classifiedTypeByTournament.set(tournamentKey, type);
      const eventIdKey = entry?.eventId !== undefined && entry?.eventId !== null
        ? String(entry.eventId).trim()
        : '';
      if (eventIdKey) classifiedTypeByTournament.set(eventIdKey, type);
    });

  const resolveTypeForAnalysis = analysis => {
    if (!analysis) return null;
    const eventIdKey = analysis?.eventId !== undefined && analysis?.eventId !== null
      ? String(analysis.eventId).trim()
      : '';
    if (eventIdKey && classifiedTypeByTournament.has(eventIdKey)) {
      return classifiedTypeByTournament.get(eventIdKey);
    }
    const tournamentKey = normalizeTournamentKey(analysis.tournament || '');
    if (tournamentKey && classifiedTypeByTournament.has(tournamentKey)) {
      return classifiedTypeByTournament.get(tournamentKey);
    }
    return analysis.courseType || null;
  };

  const byType = {
    POWER: allMetricAnalyses.filter(entry => resolveTypeForAnalysis(entry) === 'POWER'),
    TECHNICAL: allMetricAnalyses.filter(entry => resolveTypeForAnalysis(entry) === 'TECHNICAL'),
    BALANCED: allMetricAnalyses.filter(entry => resolveTypeForAnalysis(entry) === 'BALANCED')
  };

  const summariesByType = {
    POWER: buildCorrelationSummary(byType.POWER),
    TECHNICAL: buildCorrelationSummary(byType.TECHNICAL),
    BALANCED: buildCorrelationSummary(byType.BALANCED)
  };
  const typeCounts = {
    POWER: byType.POWER.length,
    TECHNICAL: byType.TECHNICAL.length,
    BALANCED: byType.BALANCED.length
  };

  return {
    top20BlendByTournament,
    top20BlendPath,
    classificationPayload,
    classifiedTypeByTournament,
    byType,
    summariesByType,
    typeCounts
  };
};

const buildValidationCalibrationPayload = ({
  predictionsResult,
  resultsResult,
  tournamentName,
  resolvedSlug,
  season,
  dataRootDir,
  logger = console
} = {}) => {
  const evaluation = evaluateTournamentPredictions(
    predictionsResult?.predictions || [],
    resultsResult?.results || []
  );
  const tournamentCalibration = buildCalibrationData({
    tournamentName: tournamentName || resolvedSlug,
    predictions: predictionsResult?.predictions || [],
    results: resultsResult?.results || []
  });
  const seasonCalibration = buildSeasonCalibrationData({
    season,
    dataRootDir,
    logger
  });
  const hasSeasonCalibration = Array.isArray(seasonCalibration?.tournaments)
    && seasonCalibration.tournaments.length > 0;
  const calibrationReportData = hasSeasonCalibration
    ? seasonCalibration
    : tournamentCalibration;
  return {
    evaluation,
    tournamentCalibration,
    seasonCalibration,
    calibrationReportData,
    hasSeasonCalibration
  };
};

const buildMetricAnalysisPayload = async ({
  dataRootDir,
  season,
  resolvedSlug,
  tournamentName,
  eventId,
  config,
  resultsJsonPath,
  resultsResult,
  rankingsCsvPath,
  historyCsvPath,
  logger = console
} = {}) => {
  if (!resolvedSlug) return { metricAnalysis: null, approachEventOnlyInfo: null };

  const manifestEntries = loadSeasonManifestEntries(dataRootDir, season);
  const currentEntry = resolveManifestEntryForEvent(manifestEntries, {
    eventId: config?.eventId || eventId,
    tournamentSlug: resolvedSlug,
    tournamentName: tournamentName || resolvedSlug
  });
  const nextEntry = resolveNextManifestEntry(manifestEntries, currentEntry);
  let approachEventOnlyMap = null;
  const approachEventOnlyNotes = [];
  const snapshotPair = resolveApproachSnapshotPairForEvent({
    dataRootDir,
    season,
    eventId: config?.eventId || eventId,
    tournamentSlug: resolvedSlug,
    tournamentName: tournamentName || resolvedSlug,
    manifestEntries,
    approachSnapshotDir: APPROACH_SNAPSHOT_DIR,
    csvFallback: null
  });
  const preApproachPath = resolveApproachCsvForEntry(dataRootDir, season, currentEntry);
  const postApproachPath = resolveApproachCsvForEntry(dataRootDir, season, nextEntry);
  let approachSnapshotPayload = null;

  const applyEventOnlyRows = ({ label, beforeRows, afterRows, sourceNote }) => {
    const eventOnly = computeEventOnlyApproachRows({ beforeRows, afterRows });
    if (
      !eventOnly ||
      !Array.isArray(eventOnly.rows) ||
      typeof eventOnly.playersWithShots !== 'number' ||
      !Number.isFinite(eventOnly.playersWithShots)
    ) {
      const typeDescription =
        eventOnly == null
          ? String(eventOnly)
          : typeof eventOnly !== 'object'
            ? `non-object (${typeof eventOnly}): ${String(eventOnly)}`
            : `object with rows: ${
                Array.isArray(eventOnly.rows) ? 'array' : typeof eventOnly.rows
              }, playersWithShots: ${
                eventOnly.playersWithShots === undefined
                  ? 'undefined'
                  : typeof eventOnly.playersWithShots
              }`;
      throw new Error(
        `computeEventOnlyApproachRows(...) contract violation: ` +
        `expected an object with a 'rows' array (and numeric finite 'playersWithShots' count), ` +
        `but received ${typeDescription}.`
      );
    }
    if (eventOnly.rows.length > 0) {
      approachEventOnlyMap = new Map();
      eventOnly.rows.forEach(row => {
        const dgId = String(row?.dg_id || '').trim();
        if (!dgId) return;
        approachEventOnlyMap.set(dgId, row);
      });
      logger.log(`✓ Event-only approach metrics loaded for ${resolvedSlug} (${eventOnly.rows.length} rows; ${label}).`);
      if (sourceNote) logger.log(sourceNote);
      return {
        source: sourceNote || label || 'event_only',
        label,
        rows: eventOnly.rows.length,
        playersWithShots: eventOnly.playersWithShots
      };
    }
    return null;
  };

  let approachEventOnlyInfo = null;

  if (snapshotPair.eventDateMs && snapshotPair.prePath && snapshotPair.postPath) {
    const preRows = loadApproachRowsFromPath(snapshotPair.prePath);
    const postRows = loadApproachRowsFromPath(snapshotPair.postPath);

    if (preRows.length > 0 && postRows.length > 0) {
      const label = `pre=${path.basename(snapshotPair.prePath)}, post=${path.basename(snapshotPair.postPath)}`;
      approachEventOnlyInfo = applyEventOnlyRows({
        label,
        beforeRows: preRows,
        afterRows: postRows,
        sourceNote: 'NOTE: Event-only approach metrics sourced from snapshot archives (manifest-aligned).'
      });
      if (!approachEventOnlyInfo) {
        approachEventOnlyNotes.push('NOTE: Snapshot event-only approach metrics unavailable (no overlapping rows).');
      } else {
        approachEventOnlyInfo.prePath = snapshotPair.prePath || null;
        approachEventOnlyInfo.postPath = snapshotPair.postPath || null;
      }
    } else {
      approachEventOnlyNotes.push('NOTE: Snapshot event-only approach metrics unavailable (missing pre/post snapshots).');
    }
  } else if (!snapshotPair.eventDateMs) {
    approachEventOnlyNotes.push('NOTE: Snapshot event-only approach metrics skipped (manifest date missing).');
  }

  if (!approachEventOnlyMap) {
    const apiSnapshot = await getDataGolfApproachSkill({
      apiKey: DATAGOLF_API_KEY,
      cacheDir: null,
      ttlMs: DATAGOLF_APPROACH_TTL_HOURS * 60 * 60 * 1000,
      allowStale: true,
      period: 'ytd',
      fileFormat: 'json'
    });
    approachSnapshotPayload = apiSnapshot?.payload || null;
    const postPayload = approachSnapshotPayload;
    const postRows = postPayload ? extractApproachRowsFromJson(postPayload) : [];
    const preRows = snapshotPair?.prePath ? loadApproachRowsFromPath(snapshotPair.prePath) : [];

    if (preRows.length > 0 && postRows.length > 0) {
      const label = `pre=${snapshotPair?.prePath ? path.basename(snapshotPair.prePath) : 'n/a'}, post=api:${apiSnapshot?.source || 'unknown'}`;
      approachEventOnlyInfo = applyEventOnlyRows({
        label,
        beforeRows: preRows,
        afterRows: postRows,
        sourceNote: 'NOTE: Event-only approach metrics sourced from API snapshot (snapshot archive missing/incomplete).'
      });
      if (!approachEventOnlyInfo) {
        approachEventOnlyNotes.push('NOTE: API event-only approach metrics unavailable (no overlapping rows).');
      } else {
        approachEventOnlyInfo.prePath = snapshotPair?.prePath || null;
        approachEventOnlyInfo.postPath = apiSnapshot?.path || APPROACH_SNAPSHOT_YTD_LATEST_PATH;
      }
    } else if (apiSnapshot?.source === 'missing-key') {
      approachEventOnlyNotes.push('NOTE: API event-only approach metrics skipped (DATAGOLF_API_KEY missing).');
    } else if (postRows.length === 0) {
      approachEventOnlyNotes.push(`NOTE: API event-only approach metrics skipped (api source=${apiSnapshot?.source || 'unknown'}, rows=0).`);
    } else {
      approachEventOnlyNotes.push('NOTE: API event-only approach metrics skipped (missing pre snapshot rows).');
    }
  }

  if (!approachEventOnlyMap) {
    if (preApproachPath && postApproachPath) {
      const beforeRows = loadApproachCsv(preApproachPath);
      const afterRows = loadApproachCsv(postApproachPath);
      const label = `pre=${path.basename(preApproachPath)}, post=${path.basename(postApproachPath)}`;
      approachEventOnlyInfo = applyEventOnlyRows({
        label,
        beforeRows,
        afterRows,
        sourceNote: 'NOTE: Event-only approach metrics sourced from CSV fallback.'
      });
      if (!approachEventOnlyInfo) {
        approachEventOnlyNotes.push('NOTE: CSV event-only approach metrics unavailable (no overlapping rows).');
      } else {
        approachEventOnlyInfo.prePath = preApproachPath;
        approachEventOnlyInfo.postPath = postApproachPath;
      }
    } else {
      approachEventOnlyNotes.push('NOTE: CSV event-only approach metrics unavailable (missing pre/post approach CSVs).');
    }
  }

  if (!approachEventOnlyMap) {
    logger.log(`ℹ️  Event-only approach metrics unavailable for ${resolvedSlug}.`);
  }
  approachEventOnlyNotes.forEach(note => logger.log(note));

  const resultsPayload = readJsonFile(resultsJsonPath);
  const resultsRows = Array.isArray(resultsPayload?.results)
    ? resultsPayload.results
    : (Array.isArray(resultsPayload) ? resultsPayload : []);

  const metricAnalysis = buildMetricAnalysis({
    rankingsCsvPath,
    results: resultsResult.results,
    resultsRows: resultsRows.length > 0 ? resultsRows : resultsResult.results,
    historyCsvPath,
    eventId: config?.eventId || eventId,
    season,
    tournamentSlug: resolvedSlug,
    courseType: config?.courseType || null,
    approachEventOnlyMap,
    version: METRIC_ANALYSIS_VERSION
  });
  if (metricAnalysis) {
    metricAnalysis.eventId = config?.eventId || eventId || null;
    metricAnalysis.courseType = config?.courseType || determineDetectedCourseType(metricAnalysis.metrics);
    metricAnalysis.courseTypeSource = config?.source || null;
    metricAnalysis.detectedCourseType = determineDetectedCourseType(metricAnalysis.metrics);
  }

  return {
    metricAnalysis,
    approachEventOnlyInfo,
    approachSnapshotPayload
  };
};

module.exports = {
  OUTPUT_NAMES,
  METRIC_ORDER,
  METRIC_ANALYSIS_VERSION,
  getValidationOutputDir,
  getMetricAnalysisDir,
  isMetricAnalysisPopulated,
  shouldSkipMetricAnalysis,
  buildValidationRunContext,
  buildValidationInputSummary,
  buildValidationInputs,
  buildMetricAnalysisAggregateList,
  buildMetricAnalysisPayload,
  buildValidationAggregates,
  loadTournamentConfig,
  buildExistingResultsPayloadSummary,
  buildResultsFromPayloadRows,
  parseModelRankingData,
  buildResultsSheetContext,
  buildModelDeltaTrends,
  buildSeasonCalibrationData,
  buildValidationCalibrationPayload,
  buildProcessingLogData,
  buildValidationSourceSummary,
  buildProcessingLogPayload,
  buildTemplateOutputContext,
  loadSeasonManifest,
  applyFinishFallback,
  buildResultsFromHistoricalRows,
  buildResultsFromHistoricalSnapshotPayload,
  resolveHistoricalRoundsCachePath,
  loadTournamentResultsFromHistoricalApi,
  captureOutputState,
  recordOutputWrite,
  createOutputTracker,
  slugifyTournament
};
