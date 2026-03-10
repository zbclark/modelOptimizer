const path = require('path');
const { OUTPUT_ARTIFACTS, VALIDATION_SUBDIRS } = require('./outputArtifacts');

const OUTPUT_DIR_LEGACY = 'output';

function sanitizeFragment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]/g, '');
}

function slugifyTournament(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeMode(mode, fallback = 'pre_event') {
  const normalized = String(mode || '').trim().toLowerCase();
  if (['post', 'post_event', 'post-tournament', 'post_tournament'].includes(normalized)) return 'post_event';
  if (['pre', 'pre_event', 'pre-tournament', 'pre_tournament'].includes(normalized)) return 'pre_event';
  return fallback;
}

function resolveTournamentRoot({ workspaceRoot, dataRoot, season, tournamentName, tournamentSlug }) {
  const rootData = dataRoot ? path.resolve(dataRoot) : path.resolve(workspaceRoot || process.cwd(), 'data');
  const slug = slugifyTournament(tournamentSlug || tournamentName);
  if (!season || !slug) return null;
  return path.resolve(rootData, String(season), slug);
}

function resolveModeRoot({ tournamentRoot, mode, outputDirOverride }) {
  if (outputDirOverride) return path.resolve(outputDirOverride);
  if (!tournamentRoot) return null;
  return path.resolve(tournamentRoot, normalizeMode(mode));
}

function resolveSeedRunRoot({ modeRoot, mode, isSeeded, forceSeedRuns = false }) {
  if (!modeRoot) return null;
  const normalizedMode = normalizeMode(mode);
  if (normalizedMode === 'post_event' && (isSeeded || forceSeedRuns)) {
    return path.resolve(modeRoot, 'seed_runs');
  }
  return modeRoot;
}

function resolveDryRunRoot({ modeRoot, dryRunDirOverride }) {
  if (dryRunDirOverride) return path.resolve(dryRunDirOverride);
  if (!modeRoot) return null;
  return path.resolve(modeRoot, 'dryrun');
}

function resolveAnalysisRoot({ tournamentRoot, mode, analysisDirOverride }) {
  if (analysisDirOverride) return path.resolve(analysisDirOverride);
  if (!tournamentRoot) return null;
  return path.resolve(tournamentRoot, normalizeMode(mode), 'analysis');
}

function resolveRegressionRoot({ tournamentRoot, mode = 'pre_event', workspaceRoot, dataRoot, regressionDirOverride }) {
  if (regressionDirOverride) return path.resolve(regressionDirOverride);
  if (tournamentRoot) {
    return path.resolve(tournamentRoot, normalizeMode(mode), 'course_history_regression');
  }
  const rootData = dataRoot ? path.resolve(dataRoot) : path.resolve(workspaceRoot || process.cwd(), 'data');
  return path.resolve(rootData, 'course_history_regression');
}

function resolveValidationRoot({ workspaceRoot, dataRoot, season }) {
  const rootData = dataRoot ? path.resolve(dataRoot) : path.resolve(workspaceRoot || process.cwd(), 'data');
  if (!season) return null;
  return path.resolve(rootData, String(season), 'validation_outputs');
}

function resolveValidationSubdir({ validationRoot, kind }) {
  if (!validationRoot) return null;
  const key = String(kind || '').trim().toUpperCase();
  if (key === 'METRIC_ANALYSIS') return path.resolve(validationRoot, VALIDATION_SUBDIRS.METRIC_ANALYSIS);
  if (key === 'TEMPLATE_CORRELATION_SUMMARIES') return path.resolve(validationRoot, VALIDATION_SUBDIRS.TEMPLATE_CORRELATION_SUMMARIES);
  if (key === 'TOP20_BLEND') return path.resolve(validationRoot, VALIDATION_SUBDIRS.TOP20_BLEND);
  return null;
}

function buildOutputBaseName({ tournamentName, tournamentSlug, eventId, seed, outputTag }) {
  let baseName = sanitizeFragment(tournamentSlug || tournamentName || `event_${eventId || 'unknown'}`);
  if (!baseName) baseName = `event_${eventId || 'unknown'}`;
  baseName = baseName.replace(/^optimizer_/, '');

  const seedSuffix = seed ? `_seed-${String(seed).trim().toLowerCase()}` : '';
  const outputTagSuffix = outputTag ? `_${sanitizeFragment(outputTag)}` : '';

  return `${baseName}${seedSuffix}${outputTagSuffix}`;
}

function toTournamentResultsBase({ tournamentSlug, tournamentName, outputBaseName }) {
  return slugifyTournament(tournamentSlug || tournamentName) || outputBaseName;
}

function buildArtifactFilename({ artifactType, outputBaseName, tournamentSlug, tournamentName, metricKey, templateName }) {
  const tBase = toTournamentResultsBase({ tournamentSlug, tournamentName, outputBaseName });

  switch (artifactType) {
    case OUTPUT_ARTIFACTS.PRE_EVENT_RESULTS_JSON:
      return `${outputBaseName}_pre_event_results.json`;
    case OUTPUT_ARTIFACTS.PRE_EVENT_RESULTS_TXT:
      return `${outputBaseName}_pre_event_results.txt`;
    case OUTPUT_ARTIFACTS.PRE_EVENT_RANKINGS_JSON:
      return `${outputBaseName}_pre_event_rankings.json`;
    case OUTPUT_ARTIFACTS.PRE_EVENT_RANKINGS_CSV:
      return `${outputBaseName}_pre_event_rankings.csv`;
    case OUTPUT_ARTIFACTS.PRE_EVENT_SIGNAL_CONTRIBUTIONS_JSON:
      return `${outputBaseName}_signal_contributions.json`;

    case OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_JSON:
      return `${outputBaseName}_post_event_results.json`;
    case OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_TXT:
      return `${outputBaseName}_post_event_results.txt`;

    case OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_JSON:
      return `${tBase}_results.json`;
    case OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_CSV:
      return `${tBase}_results.csv`;
    case OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_ZSCORES_CSV:
      return `${tBase}_results_zscores.csv`;
    case OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_FORMATTING_CSV:
      return `${tBase}_results_formatting.csv`;

    case OUTPUT_ARTIFACTS.SEED_SUMMARY_TXT:
      return `${outputBaseName}_seed_summary.txt`;
    case OUTPUT_ARTIFACTS.SEED_LOG_TXT:
      return `${outputBaseName}_log.txt`;

    case OUTPUT_ARTIFACTS.PRE_EVENT_LOG_TXT:
      return `${outputBaseName}_pre_event_log.txt`;
    case OUTPUT_ARTIFACTS.POST_EVENT_LOG_TXT:
      return `${outputBaseName}_post_event_log.txt`;

    case OUTPUT_ARTIFACTS.TOP20_TEMPLATE_BLEND_JSON:
      return `${tBase}_top20_template_blend.json`;

    case OUTPUT_ARTIFACTS.RAMP_JSON:
      return `early_season_ramp_${sanitizeFragment(metricKey || 'default')}.json`;
    case OUTPUT_ARTIFACTS.RAMP_CSV:
      return `early_season_ramp_${sanitizeFragment(metricKey || 'default')}.csv`;

    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_JSON:
      return 'course_history_regression.json';
    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_SUMMARY_CSV:
      return 'course_history_regression_summary.csv';
    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_DETAILS_CSV:
      return 'course_history_regression_details.csv';
    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_SUMMARY_SIMILAR_CSV:
      return 'course_history_regression_summary_similar.csv';
    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_DETAILS_SIMILAR_CSV:
      return 'course_history_regression_details_similar.csv';

    case OUTPUT_ARTIFACTS.VALIDATION_CALIBRATION_REPORT_JSON:
      return 'Calibration_Report.json';
    case OUTPUT_ARTIFACTS.VALIDATION_CALIBRATION_REPORT_CSV:
      return 'Calibration_Report.csv';
    case OUTPUT_ARTIFACTS.VALIDATION_COURSE_TYPE_CLASSIFICATION_JSON:
      return 'Course_Type_Classification.json';
    case OUTPUT_ARTIFACTS.VALIDATION_COURSE_TYPE_CLASSIFICATION_CSV:
      return 'Course_Type_Classification.csv';
    case OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_CALIBRATION_GUIDE_JSON:
      return 'Weight_Calibration_Guide.json';
    case OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_CALIBRATION_GUIDE_CSV:
      return 'Weight_Calibration_Guide.csv';
    case OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_TEMPLATES_JSON:
      return 'Weight_Templates.json';
    case OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_TEMPLATES_CSV:
      return 'Weight_Templates.csv';
    case OUTPUT_ARTIFACTS.VALIDATION_MODEL_DELTA_TRENDS_JSON:
      return 'Model_Delta_Trends.json';
    case OUTPUT_ARTIFACTS.VALIDATION_MODEL_DELTA_TRENDS_CSV:
      return 'Model_Delta_Trends.csv';
    case OUTPUT_ARTIFACTS.VALIDATION_PROCESSING_LOG_JSON:
      return 'Processing_Log.json';
    case OUTPUT_ARTIFACTS.VALIDATION_METRIC_ANALYSIS_JSON:
      return `${tBase}_metric_analysis.json`;
    case OUTPUT_ARTIFACTS.VALIDATION_METRIC_ANALYSIS_CSV:
      return `${tBase}_metric_analysis.csv`;
    case OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_JSON:
      return `${String(templateName || 'TEMPLATE').toUpperCase()}_Correlation_Summary.json`;
    case OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_CSV:
      return `${String(templateName || 'TEMPLATE').toUpperCase()}_Correlation_Summary.csv`;
    default:
      return null;
  }
}

function resolveArtifactDir({
  artifactType,
  modeRoot,
  seedRunRoot,
  validationRoot,
  analysisRoot,
  regressionRoot,
  validationSubdirs = {}
}) {
  switch (artifactType) {
    case OUTPUT_ARTIFACTS.PRE_EVENT_RESULTS_JSON:
    case OUTPUT_ARTIFACTS.PRE_EVENT_RESULTS_TXT:
    case OUTPUT_ARTIFACTS.PRE_EVENT_RANKINGS_JSON:
    case OUTPUT_ARTIFACTS.PRE_EVENT_RANKINGS_CSV:
    case OUTPUT_ARTIFACTS.PRE_EVENT_SIGNAL_CONTRIBUTIONS_JSON:
    case OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_JSON:
    case OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_TXT:
    case OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_JSON:
    case OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_CSV:
    case OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_ZSCORES_CSV:
    case OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_FORMATTING_CSV:
      return modeRoot;

    case OUTPUT_ARTIFACTS.SEED_SUMMARY_TXT:
    case OUTPUT_ARTIFACTS.SEED_LOG_TXT:
    case OUTPUT_ARTIFACTS.PRE_EVENT_LOG_TXT:
    case OUTPUT_ARTIFACTS.POST_EVENT_LOG_TXT:
      return seedRunRoot || modeRoot;

    case OUTPUT_ARTIFACTS.TOP20_TEMPLATE_BLEND_JSON:
      return validationSubdirs.top20Blend || validationRoot || analysisRoot || modeRoot;

    case OUTPUT_ARTIFACTS.RAMP_JSON:
    case OUTPUT_ARTIFACTS.RAMP_CSV:
      return analysisRoot;

    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_JSON:
    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_SUMMARY_CSV:
    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_DETAILS_CSV:
    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_SUMMARY_SIMILAR_CSV:
    case OUTPUT_ARTIFACTS.COURSE_HISTORY_REGRESSION_DETAILS_SIMILAR_CSV:
      return regressionRoot;

    case OUTPUT_ARTIFACTS.VALIDATION_CALIBRATION_REPORT_JSON:
    case OUTPUT_ARTIFACTS.VALIDATION_CALIBRATION_REPORT_CSV:
    case OUTPUT_ARTIFACTS.VALIDATION_COURSE_TYPE_CLASSIFICATION_JSON:
    case OUTPUT_ARTIFACTS.VALIDATION_COURSE_TYPE_CLASSIFICATION_CSV:
    case OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_CALIBRATION_GUIDE_JSON:
    case OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_CALIBRATION_GUIDE_CSV:
    case OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_TEMPLATES_JSON:
    case OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_TEMPLATES_CSV:
    case OUTPUT_ARTIFACTS.VALIDATION_MODEL_DELTA_TRENDS_JSON:
    case OUTPUT_ARTIFACTS.VALIDATION_MODEL_DELTA_TRENDS_CSV:
    case OUTPUT_ARTIFACTS.VALIDATION_PROCESSING_LOG_JSON:
      return validationRoot;

    case OUTPUT_ARTIFACTS.VALIDATION_METRIC_ANALYSIS_JSON:
    case OUTPUT_ARTIFACTS.VALIDATION_METRIC_ANALYSIS_CSV:
      return validationSubdirs.metricAnalysis || null;

    case OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_JSON:
    case OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_CSV:
      return validationSubdirs.templateCorrelations || null;

    default:
      return null;
  }
}

function buildArtifactPath({
  artifactType,
  outputBaseName,
  tournamentSlug,
  tournamentName,
  metricKey,
  templateName,
  modeRoot,
  seedRunRoot,
  validationRoot,
  analysisRoot,
  regressionRoot,
  validationSubdirs = {}
}) {
  const targetDir = resolveArtifactDir({
    artifactType,
    modeRoot,
    seedRunRoot,
    validationRoot,
    analysisRoot,
    regressionRoot,
    validationSubdirs
  });

  const filename = buildArtifactFilename({
    artifactType,
    outputBaseName,
    tournamentSlug,
    tournamentName,
    metricKey,
    templateName
  });

  if (!targetDir || !filename) return null;
  return path.resolve(targetDir, filename);
}

function getLegacyReadCandidates({
  artifactType,
  workspaceRoot,
  modeRoot,
  outputBaseName,
  tournamentSlug,
  tournamentName
}) {
  const resultsBase = toTournamentResultsBase({
    tournamentSlug,
    tournamentName,
    outputBaseName
  });

  const candidates = [];

  if (artifactType === OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_JSON) {
    if (modeRoot) {
      candidates.push(path.resolve(modeRoot, `${outputBaseName}_post_tournament_results.json`));
      candidates.push(path.resolve(modeRoot, `${resultsBase}_post_tournament_results.json`));
      candidates.push(path.resolve(modeRoot, `${resultsBase}_results.json`));
    }
  }

  if (artifactType === OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_TXT && modeRoot) {
    candidates.push(path.resolve(modeRoot, `${outputBaseName}_post_tournament_results.txt`));
    candidates.push(path.resolve(modeRoot, `${resultsBase}_post_tournament_results.txt`));
  }

  if (artifactType === OUTPUT_ARTIFACTS.SEED_SUMMARY_TXT) {
    const legacyRoot = path.resolve(workspaceRoot || process.cwd(), OUTPUT_DIR_LEGACY);
    candidates.push(path.resolve(legacyRoot, `${outputBaseName}_seed_summary.txt`));
  }

  return candidates;
}

module.exports = {
  OUTPUT_DIR_LEGACY,
  sanitizeFragment,
  slugifyTournament,
  normalizeMode,
  resolveTournamentRoot,
  resolveModeRoot,
  resolveSeedRunRoot,
  resolveDryRunRoot,
  resolveAnalysisRoot,
  resolveRegressionRoot,
  resolveValidationRoot,
  resolveValidationSubdir,
  buildOutputBaseName,
  buildArtifactFilename,
  buildArtifactPath,
  getLegacyReadCandidates,
  OUTPUT_ARTIFACTS,
  VALIDATION_SUBDIRS
};
