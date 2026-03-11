

/**
 * Module: optimizer
 * Purpose: Adaptive Weight Optimizer v2 (end-to-end pre/post tournament workflow).
 *
 * Correct 4-Step Workflow:
 * Step 1: Historical Correlation Analysis (past years' metrics only)
 * Step 2: Baseline Rankings (2026 field with template weights)
 * Step 3: Weight Optimization (using 2026 approach metrics against 2026 results)
 * Step 4: Multi-Year Validation (test 2026 weights on past years with current metrics)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { parse } = require('csv-parse/sync');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { setupLogging } = require('../utilities/logging');
const { formatTimestamp, formatDateKey, formatTimestampForFilename } = require('../utilities/timeUtils');
const { loadCsv } = require('../utilities/csvLoader');
const { buildPlayerData } = require('../utilities/dataPrep');
const { generatePlayerRankings, cleanMetricValue, calculateMetricTrends } = require('./modelCore');
const { getSharedConfig } = require('../utilities/configParser');
const { buildMetricGroupsFromConfig } = require('../utilities/metricConfigBuilder');
const { WEIGHT_TEMPLATES } = require('../utilities/weightTemplates');
const { getDeltaPlayerScoresForEvent } = require('../utilities/deltaPlayerScores');
const { METRIC_DEFS, loadApproachCsv, computeApproachDeltas, extractApproachRowsFromJson } = require('../utilities/approachDelta');
const { blendTemplateWeights } = require('../utilities/top20TemplateBlend');
const { resolveKFoldTag } = require('../utilities/kfoldTag');
const { writeCleanRunSummaryLog } = require('../utilities/runSummaryLog');
const resultsCsvUtils = require('../utilities/tournamentResultsCsv');
const {
  parseDateToUtcMs,
  loadSeasonManifestEntries,
  resolveManifestEntryForEvent,
  resolveNextManifestEntry,
  resolvePreviousManifestEntry,
  resolveEventStartDateFromManifest,
  ensureManifestEntry,
  resolveApproachSnapshotPairForEvent
} = require('../utilities/manifestUtils');
const {
  getDataGolfRankings,
  getDataGolfApproachSkill,
  getDataGolfFieldUpdates,
  getDataGolfPlayerDecompositions,
  getDataGolfSkillRatings,
  getDataGolfHistoricalRounds
} = require('../utilities/dataGolfClient');
const { getMeteoblueLocation, getMeteoblueForecast } = require('../utilities/weatherClient');
const buildRecentYears = require('../utilities/buildRecentYears');
const collectRecords = require('../utilities/collectRecords');
const { extractHistoricalRowsFromSnapshotPayload } = require('../utilities/extractHistoricalRows');
const {
  resolveModeRoot,
  resolveSeedRunRoot,
  resolveValidationRoot,
  resolveValidationSubdir,
  resolveAnalysisRoot,
  resolveRegressionRoot,
  resolveDryRunRoot,
  buildOutputBaseName,
  buildArtifactPath,
  OUTPUT_ARTIFACTS
} = require('../utilities/outputPaths');

function extractApproachRowsFromSnapshotPayload(payload) {
  if (typeof extractApproachRowsFromJson === 'function') {
    return extractApproachRowsFromJson(payload) || [];
  }
  return [];
}

const ROOT_DIR = path.resolve(__dirname, '..');
let DATA_ROOT_DIR = path.resolve(ROOT_DIR, 'data');
let DATA_DIR = DATA_ROOT_DIR;
let DEFAULT_DATA_DIR = DATA_ROOT_DIR;
// Legacy note: this repo historically used a sibling `output/` folder. The Node-only
// workflow now writes artifacts under `data/<season>/<tournament-slug>/...`.
// Keep OUTPUT_DIR defined for internal helpers/overrides, but default it to `data/`
// so we don't implicitly create/use a generic `output/` directory.
let OUTPUT_DIR = path.resolve(ROOT_DIR, 'data');
let TOURNAMENT_INPUT_DIRS = [];
let VALIDATION_OUTPUT_DIRS = [];
const OUTPUT_NAMES = {
  calibrationReport: 'Calibration_Report',
  weightTemplates: 'Weight_Templates',
  courseTypeClassification: 'Course_Type_Classification',
  processingLog: 'Processing_Log',
  modelDeltaTrends: 'Model_Delta_Trends',
  powerCorrelationSummary: 'POWER_Correlation_Summary',
  technicalCorrelationSummary: 'TECHNICAL_Correlation_Summary',
  balancedCorrelationSummary: 'BALANCED_Correlation_Summary',
  weightCalibrationGuide: 'Weight_Calibration_Guide'
};
const APPROACH_DELTA_DIR = path.resolve(ROOT_DIR, 'data', 'approach_deltas');
const APPROACH_SNAPSHOT_DIR = path.resolve(ROOT_DIR, 'data', 'approach_snapshot');
const APPROACH_SNAPSHOT_L24_PATH = path.resolve(APPROACH_SNAPSHOT_DIR, 'approach_l24.json');
const APPROACH_SNAPSHOT_L12_PATH = path.resolve(APPROACH_SNAPSHOT_DIR, 'approach_l12.json');
const APPROACH_SNAPSHOT_YTD_LATEST_PATH = path.resolve(APPROACH_SNAPSHOT_DIR, 'approach_ytd_latest.json');
const APPROACH_EVENT_ONLY_PRE = String(process.env.APPROACH_EVENT_ONLY_PRE || '').trim();
const APPROACH_EVENT_ONLY_POST = String(process.env.APPROACH_EVENT_ONLY_POST || '').trim();
const APPROACH_L12_REFRESH_MONTH = (() => {
  const raw = parseInt(String(process.env.APPROACH_L12_REFRESH_MONTH || '').trim(), 10);
  if (Number.isNaN(raw)) return 12;
  return Math.min(12, Math.max(1, raw));
})();
const APPROACH_L12_FORCE_REFRESH = String(process.env.APPROACH_L12_FORCE_REFRESH || '').trim().toLowerCase();
const APPROACH_L12_REFRESH_SEASON = String(process.env.APPROACH_L12_REFRESH_SEASON || '').trim();
const APPROACH_L12_REFRESH_EVENT_ID = String(process.env.APPROACH_L12_REFRESH_EVENT_ID || '60').trim();
const APPROACH_SNAPSHOT_RETENTION_COUNTS = {
  ytd: (() => {
    const raw = parseInt(String(process.env.APPROACH_SNAPSHOT_RETENTION_YTD || '').trim(), 10);
    if (Number.isNaN(raw)) return 4;
    return Math.max(2, raw);
  })(),
  l24: null,
  l12: null
};
const COURSE_CONTEXT_PATH = path.resolve(ROOT_DIR, 'utilities', 'course_context.json');
const DATAGOLF_CACHE_DIR = path.resolve(ROOT_DIR, 'data', 'cache');
const TRACE_PLAYER = String(process.env.TRACE_PLAYER || '').trim();
let LOGGING_ENABLED = true;
let LOGGING_INITIALIZED = false;
let LOGGING_HANDLE = null;
const OPT_SEED_RAW = String(process.env.OPT_SEED || '').trim();
const OPT_TESTS_RAW = String(process.env.OPT_TESTS || '').trim();
const DATAGOLF_API_KEY = String(process.env.DATAGOLF_API_KEY || '').trim();
const DATAGOLF_RANKINGS_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.DATAGOLF_RANKINGS_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 24 : Math.max(1, raw);
})();
const DATAGOLF_APPROACH_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.DATAGOLF_APPROACH_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 24 : Math.max(1, raw);
})();
const DATAGOLF_APPROACH_PERIOD = String(process.env.DATAGOLF_APPROACH_PERIOD || 'l24')
  .trim()
  .toLowerCase();
const DATAGOLF_FIELD_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.DATAGOLF_FIELD_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 6 : Math.max(1, raw);
})();
const DATAGOLF_FIELD_TOUR = String(process.env.DATAGOLF_FIELD_TOUR || 'pga')
  .trim()
  .toLowerCase();
const DATAGOLF_SKILL_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.DATAGOLF_SKILL_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 24 : Math.max(1, raw);
})();
const DATAGOLF_SKILL_DISPLAY_VALUE = 'value';
const DATAGOLF_SKILL_DISPLAY_RANK = 'rank';
const DATAGOLF_DECOMP_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.DATAGOLF_DECOMP_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 24 : Math.max(1, raw);
})();
const DATAGOLF_DECOMP_TOUR = String(process.env.DATAGOLF_DECOMP_TOUR || 'pga')
  .trim()
  .toLowerCase();
const DATAGOLF_HISTORICAL_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.DATAGOLF_HISTORICAL_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 72 : Math.max(1, raw);
})();
const DATAGOLF_HISTORICAL_TOUR = String(process.env.DATAGOLF_HISTORICAL_TOUR || 'pga')
  .trim()
  .toLowerCase();
const DATAGOLF_HISTORICAL_EVENT_ID = String(process.env.DATAGOLF_HISTORICAL_EVENT_ID || 'all')
  .trim()
  .toLowerCase();
const DATAGOLF_HISTORICAL_YEAR_RAW = String(process.env.DATAGOLF_HISTORICAL_YEAR || '')
  .trim();
const WEATHER_API_KEY = String(process.env.WEATHER_API_KEY || '').trim();
const WEATHER_ENABLED = (() => {
  const raw = String(process.env.WEATHER_ENABLED || '').trim().toLowerCase();
  if (raw) return ['1', 'true', 'yes', 'on'].includes(raw);
  return WEATHER_API_KEY.length > 0;
})();
const WEATHER_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.WEATHER_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 6 : Math.max(1, raw);
})();
const WEATHER_PACKAGE = String(process.env.WEATHER_PACKAGE || 'basic-1h_basic-day').trim();
const WEATHER_FORECAST_DAYS = (() => {
  const raw = parseInt(String(process.env.WEATHER_FORECAST_DAYS || '').trim(), 10);
  return Number.isNaN(raw) ? 4 : Math.max(2, Math.min(7, raw));
})();
const WEATHER_PENALTY_CACHE_FILENAME = 'weather_wave_penalties.json';

const getBaselineWavePenaltyAdjustments = () => {
  const defaultBaseline = getEnvNumberValue('WEATHER_BASE_WEEKLONG_SPLIT', 0.10);
  const lateEarlyAdv = getEnvNumberValue('WEATHER_BASE_LATE_EARLY_ADV', defaultBaseline);
  const perRoundAdv = lateEarlyAdv / 2;

  return {
    R1_AM: 0,
    R1_PM: -perRoundAdv,
    R2_AM: -perRoundAdv,
    R2_PM: 0
  };
};

const getNetWeatherWaveAdjustments = ({ r1Am, r1Pm, r2Am, r2Pm }) => {
  const adjustments = { R1_AM: 0, R1_PM: 0, R2_AM: 0, R2_PM: 0 };
  const applyDiff = (amValue, pmValue, amKey, pmKey) => {
    const diff = Math.abs(amValue - pmValue);
    if (!Number.isFinite(diff) || diff === 0) return 0;
    if (amValue < pmValue) {
      adjustments[amKey] = diff;
    } else if (pmValue < amValue) {
      adjustments[pmKey] = diff;
    }
    return diff;
  };

  const diffR1 = applyDiff(r1Am, r1Pm, 'R1_AM', 'R1_PM');
  const diffR2 = applyDiff(r2Am, r2Pm, 'R2_AM', 'R2_PM');

  return {
    adjustments,
    diffR1,
    diffR2,
    totalDiff: diffR1 + diffR2
  };
};
const VALIDATION_APPROACH_MODE = String(process.env.VALIDATION_APPROACH_MODE || 'current_only')
  .trim()
  .toLowerCase();
const APPROACH_BLEND_WEIGHTS_RAW = String(process.env.APPROACH_BLEND_WEIGHTS || '').trim();
const APPROACH_GROUP_CAP = (() => {
  const raw = parseFloat(String(process.env.APPROACH_GROUP_CAP || '').trim());
  if (Number.isNaN(raw)) return null;
  return Math.max(0, Math.min(1, raw));
})();
const OPT_OBJECTIVE_CORR = (() => {
  const raw = parseFloat(String(process.env.OPT_OBJECTIVE_CORR || '').trim());
  return Number.isNaN(raw) ? null : raw;
})();
const OPT_OBJECTIVE_TOP20 = (() => {
  const raw = parseFloat(String(process.env.OPT_OBJECTIVE_TOP20 || '').trim());
  return Number.isNaN(raw) ? null : raw;
})();
const OPT_OBJECTIVE_ALIGN = (() => {
  const raw = parseFloat(String(process.env.OPT_OBJECTIVE_ALIGN || '').trim());
  return Number.isNaN(raw) ? null : raw;
})();
const OPT_LOEO_PENALTY = (() => {
  const raw = parseFloat(String(process.env.OPT_LOEO_PENALTY || '').trim());
  if (Number.isNaN(raw)) return 0;
  return Math.max(0, Math.min(1, raw));
})();
const OPT_LOEO_TOP_N = (() => {
  const raw = parseInt(String(process.env.OPT_LOEO_TOP_N || '').trim(), 10);
  if (Number.isNaN(raw)) return 0;
  return Math.max(0, raw);
})();
const PAST_PERF_RAMP_WEIGHT = (() => {
  const raw = parseFloat(String(process.env.PAST_PERF_RAMP_WEIGHT || '').trim());
  if (Number.isNaN(raw)) return 0.4;
  return Math.max(0, Math.min(1, raw));
})();
const VALIDATION_YEAR_WINDOW = 5;
const MIN_METRIC_COVERAGE = 0.70;
const VALIDATION_RANGE_PCT = 0.20;
const VALIDATION_PRIOR_WEIGHT = 0.25;
const DELTA_TREND_PRIOR_WEIGHT = 0.15;
const APPROACH_DELTA_PRIOR_WEIGHT = 0.15;
const APPROACH_DELTA_PRIOR_LABEL = 'approachDeltaPrior';
const APPROACH_DELTA_ROLLING_DEFAULT = 4;
const APPROACH_DELTA_MIN_DAYS = (() => {
  const raw = parseInt(String(process.env.APPROACH_DELTA_MIN_DAYS || '').trim(), 10);
  if (Number.isNaN(raw)) return 5;
  return Math.max(1, raw);
})();
const APPROACH_DELTA_SNAPSHOT_ONLY_EVENTS = normalizeIdList(
  String(process.env.APPROACH_DELTA_SNAPSHOT_ONLY_EVENTS || '')
);
let APPROACH_DELTA_ROLLING_EVENTS = (() => {
  const parsed = parseInt(String(process.env.APPROACH_DELTA_ROLLING_EVENTS || '').trim(), 10);
  if (Number.isNaN(parsed)) return APPROACH_DELTA_ROLLING_DEFAULT;
  if (parsed < 0) return APPROACH_DELTA_ROLLING_DEFAULT;
  return parsed;
})();
let APPROACH_DELTA_ROLLING_RED_FLAG_NOTE = null;
const APPROACH_DELTA_HEALTH_KEY = 'delta_150_200_fw_shot_count';
const DELTA_TREND_RANGE = {
  STABLE: 0.10,
  WATCH: 0.20,
  CHRONIC: 0.35
};

const isSnapshotOnlyDeltaEvent = ({ eventId, tournamentSlug, tournamentName }) => {
  const slug = normalizeTournamentSlug(tournamentSlug || tournamentName || '');
  const eventKey = String(eventId || '').trim();
  if (slug === 'arnold-palmer-invitational') return true;
  if (!APPROACH_DELTA_SNAPSHOT_ONLY_EVENTS.length) return false;
  if (eventKey && APPROACH_DELTA_SNAPSHOT_ONLY_EVENTS.includes(eventKey)) return true;
  if (slug && APPROACH_DELTA_SNAPSHOT_ONLY_EVENTS.includes(slug)) return true;
  return false;
};

const hashSeed = value => {
  if (!value) return null;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRng = seedValue => {
  if (seedValue === null || seedValue === undefined) return null;
  let seed = Number(seedValue);
  if (Number.isNaN(seed)) seed = hashSeed(String(seedValue));
  if (seed === null) return null;
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const SEEDED_RANDOM = OPT_SEED_RAW ? createSeededRng(OPT_SEED_RAW) : null;
const rand = SEEDED_RANDOM || Math.random;

const buildFeatureVector = (player, metricSpecs) => {
  if (!player || !Array.isArray(player.metrics)) return null;
  const specs = normalizeMetricSpecs(metricSpecs);
  if (specs.length === 0) return null;

  let validCount = 0;
    const features = specs.map(({ label, index }) => {
      const rawValue = player.metrics[index];
      if (typeof rawValue === 'number' && !Number.isNaN(rawValue)) {
        validCount += 1;
        return LOWER_BETTER_GENERATED_METRICS.has(label) ? -rawValue : rawValue;
      }
      return 0;
    });

  const coverage = validCount / specs.length;
  if (coverage < MIN_METRIC_COVERAGE) return null;
  return { features, coverage };
};


// Parse CLI arguments
const args = process.argv.slice(2);
let TEMPLATE = null;
let OVERRIDE_EVENT_ID = null;
let OVERRIDE_SEASON = null;
let TOURNAMENT_NAME = null;
let DRY_RUN = false;
let INCLUDE_CURRENT_EVENT_ROUNDS = null;
let MAX_TESTS_OVERRIDE = null;
let WRITE_VALIDATION_TEMPLATES = false;
let WRITE_TEMPLATES = false;
let OVERRIDE_DIR = null;
let OVERRIDE_DATA_DIR = null;
let OVERRIDE_OUTPUT_DIR = null;
let OVERRIDE_API_YEARS = null;
let OVERRIDE_ROLLING_DELTAS = null;
let OVERRIDE_APPROACH_DELTA_CURRENT = null;
let OVERRIDE_APPROACH_DELTA_PREVIOUS = null;
let OVERRIDE_APPROACH_DELTA_IGNORE_LAG = false;
let FORCE_RUN_MODE = null;
let FORCE_PRE_FLAG = false;
let FORCE_POST_FLAG = false;
let RUN_VALIDATION_ONLY = false;
let RUN_RESULTS_ONLY = false;
let RUN_DELTA_ONLY = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--template' && args[i + 1]) {
    TEMPLATE = args[i + 1].toUpperCase();
  }
  if ((args[i] === '--event' || args[i] === '--eventId') && args[i + 1]) {
    OVERRIDE_EVENT_ID = String(args[i + 1]).trim();
  }
  if ((args[i] === '--season' || args[i] === '--year') && args[i + 1]) {
    const parsedSeason = parseInt(String(args[i + 1]).trim());
    OVERRIDE_SEASON = Number.isNaN(parsedSeason) ? null : parsedSeason;
  }
  if ((args[i] === '--tournament' || args[i] === '--name') && args[i + 1]) {
    TOURNAMENT_NAME = String(args[i + 1]).trim();
  }
  if (args[i] === '--tests' && args[i + 1]) {
    const parsedTests = parseInt(String(args[i + 1]).trim(), 10);
    MAX_TESTS_OVERRIDE = Number.isNaN(parsedTests) ? null : parsedTests;
  }
  if (args[i] === '--log' || args[i] === '--verbose') {
    LOGGING_ENABLED = true;
  }
  if ((args[i] === '--dir' || args[i] === '--folder') && args[i + 1]) {
    OVERRIDE_DIR = String(args[i + 1]).trim();
  }
  if ((args[i] === '--dataDir' || args[i] === '--data-dir') && args[i + 1]) {
    OVERRIDE_DATA_DIR = String(args[i + 1]).trim();
  }
  if ((args[i] === '--apiYears' || args[i] === '--api-years') && args[i + 1]) {
    OVERRIDE_API_YEARS = String(args[i + 1]).trim();
  }
  if ((args[i] === '--outputDir' || args[i] === '--output-dir') && args[i + 1]) {
    OVERRIDE_OUTPUT_DIR = String(args[i + 1]).trim();
  }
  if ((args[i] === '--rollingDeltas' || args[i] === '--rolling-deltas') && args[i + 1]) {
    const parsedRolling = parseInt(String(args[i + 1]).trim(), 10);
    OVERRIDE_ROLLING_DELTAS = Number.isNaN(parsedRolling) ? null : parsedRolling;
  }
  if ((args[i] === '--approachDeltaCurrent' || args[i] === '--approach-delta-current') && args[i + 1]) {
    OVERRIDE_APPROACH_DELTA_CURRENT = String(args[i + 1]).trim();
  }
  if ((args[i] === '--approachDeltaPrevious' || args[i] === '--approach-delta-previous') && args[i + 1]) {
    OVERRIDE_APPROACH_DELTA_PREVIOUS = String(args[i + 1]).trim();
  }
  if (args[i] === '--approachDeltaIgnoreLag' || args[i] === '--approach-delta-ignore-lag') {
    OVERRIDE_APPROACH_DELTA_IGNORE_LAG = true;
  }
  if (args[i] === '--writeTemplates') {
    DRY_RUN = false;
    WRITE_TEMPLATES = true;
  }
  if (args[i] === '--writeValidationTemplates') {
    WRITE_VALIDATION_TEMPLATES = true;
  }
  if (
    args[i] === '--validation' ||
    args[i] === '--validationOnly' ||
    args[i] === '--validation-only' ||
    args[i] === '--runValidation' ||
    args[i] === '--run-validation'
  ) {
    RUN_VALIDATION_ONLY = true;
  }
  if (args[i] === '--results' || args[i] === '--resultsOnly' || args[i] === '--results-only') {
    RUN_RESULTS_ONLY = true;
    FORCE_RUN_MODE = 'post';
    FORCE_POST_FLAG = true;
  }
  if (
    args[i] === '--delta' ||
    args[i] === '--deltaOnly' ||
    args[i] === '--delta-only' ||
    args[i] === '--approachDeltaOnly' ||
    args[i] === '--approach-delta-only'
  ) {
    RUN_DELTA_ONLY = true;
  }
  if (args[i] === '--pre' || args[i] === '--preTournament' || args[i] === '--pre-tournament') {
    FORCE_RUN_MODE = 'pre';
    FORCE_PRE_FLAG = true;
  }
  if (args[i] === '--post' || args[i] === '--postTournament' || args[i] === '--post-tournament') {
    FORCE_RUN_MODE = 'post';
    FORCE_POST_FLAG = true;
  }
  if (args[i] === '--dryRun' || args[i] === '--dry-run') {
    DRY_RUN = true;
  }
  if (args[i] === '--includeCurrentEventRounds' || args[i] === '--include-current-event-rounds') {
    INCLUDE_CURRENT_EVENT_ROUNDS = true;
  }
  if (args[i] === '--excludeCurrentEventRounds' || args[i] === '--exclude-current-event-rounds') {
    INCLUDE_CURRENT_EVENT_ROUNDS = false;
  }
}

const loggingEnv = String(process.env.LOGGING_ENABLED || '').trim().toLowerCase();
if (loggingEnv === '1' || loggingEnv === 'true' || loggingEnv === 'yes') {
  LOGGING_ENABLED = true;
}

const writeValidationEnv = String(process.env.WRITE_VALIDATION_TEMPLATES || '').trim().toLowerCase();
if (writeValidationEnv === '1' || writeValidationEnv === 'true' || writeValidationEnv === 'yes') {
  WRITE_VALIDATION_TEMPLATES = true;
}

const writeTemplatesEnv = String(process.env.WRITE_TEMPLATES || '').trim().toLowerCase();
if (writeTemplatesEnv === '1' || writeTemplatesEnv === 'true' || writeTemplatesEnv === 'yes') {
  WRITE_TEMPLATES = true;
  DRY_RUN = false;
}

if (OVERRIDE_DIR) {
  const normalizedDir = OVERRIDE_DIR.replace(/^[\/]+|[\/]+$/g, '');
  const dataFolder = path.resolve(ROOT_DIR, 'data', normalizedDir);
  if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
  }
  DATA_ROOT_DIR = dataFolder;
  DATA_DIR = dataFolder;
  DEFAULT_DATA_DIR = dataFolder;
  // Treat `--dir <name>` as a data-root override only.
  // Artifact writes should remain under `data/...` rather than `output/...`.
  OUTPUT_DIR = dataFolder;
}

if (OVERRIDE_DATA_DIR) {
  const resolvedDataDir = path.resolve(OVERRIDE_DATA_DIR);
  DATA_ROOT_DIR = resolvedDataDir;
  DATA_DIR = resolvedDataDir;
  DEFAULT_DATA_DIR = resolvedDataDir;
}

if (OVERRIDE_OUTPUT_DIR) {
  OUTPUT_DIR = path.resolve(OVERRIDE_OUTPUT_DIR);
}


if (typeof OVERRIDE_ROLLING_DELTAS === 'number' && OVERRIDE_ROLLING_DELTAS >= 0) {
  APPROACH_DELTA_ROLLING_EVENTS = OVERRIDE_ROLLING_DELTAS;
}

// --- Determine context for logging (pre/post/other) ---
let runContext = 'run';
if (FORCE_PRE_FLAG) runContext = 'pre_event';
else if (FORCE_POST_FLAG) runContext = 'post_event';

if (!LOGGING_ENABLED) {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}

console.log('---');
console.log('MODEL OPTIMIZER');
console.log('---');
if (OPT_SEED_RAW) {
  console.log(`OPT_SEED: ${OPT_SEED_RAW}`);
}

const normalizedTournamentName = String(TOURNAMENT_NAME || '').trim().toLowerCase();
const RUN_SEASON_VALIDATION = RUN_VALIDATION_ONLY && (
  !normalizedTournamentName
  || ['all', 'season', 'all-tournaments', '*'].includes(normalizedTournamentName)
);

if (!OVERRIDE_EVENT_ID && !RUN_SEASON_VALIDATION) {
  console.error('\n❌ Missing required argument: --event <eventId>');
  console.error('   Example: node optimizer.js --event 6 --season 2026 --tournament "Sony Open"');
  process.exit(1);
}

function normalizeWeights(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total === 0) return weights;
  const normalized = {};
  Object.entries(weights).forEach(([k, v]) => {
    normalized[k] = v / total;
  });
  return normalized;
}

function applyApproachGroupCap(weights, cap) {
  if (!cap || cap <= 0 || cap >= 1) return weights;
  const entries = Object.entries(weights || {});
  if (entries.length === 0) return weights;
  const approachKeys = entries
    .filter(([key]) => String(key).toLowerCase().startsWith('approach'))
    .map(([key]) => key);
  if (!approachKeys.length) return weights;
  const approachTotal = approachKeys.reduce((sum, key) => sum + (weights[key] || 0), 0);
  if (approachTotal <= cap) return weights;

  const nonApproachKeys = entries
    .filter(([key]) => !approachKeys.includes(key))
    .map(([key]) => key);
  const nonApproachTotal = nonApproachKeys.reduce((sum, key) => sum + (weights[key] || 0), 0);
  const adjusted = { ...weights };
  const approachScale = approachTotal > 0 ? cap / approachTotal : 0;
  approachKeys.forEach(key => {
    adjusted[key] = (weights[key] || 0) * approachScale;
  });
  if (nonApproachTotal > 0) {
    const lift = (approachTotal - cap) / nonApproachTotal;
    nonApproachKeys.forEach(key => {
      adjusted[key] = (weights[key] || 0) * (1 + lift);
    });
  }
  return normalizeWeights(adjusted);
}

function resolveObjectiveWeights(defaults, overrides = {}) {
  const weights = { ...defaults };
  Object.entries(overrides).forEach(([key, value]) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      weights[key] = value;
    }
  });
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return defaults;
  const normalized = {};
  Object.entries(weights).forEach(([key, value]) => {
    normalized[key] = value / total;
  });
  return normalized;
}

function resolveOutputBaseName({ tournamentSlug, tournamentName, eventId }) {
  const raw = tournamentSlug
    || normalizeTournamentSlug(tournamentName || '') || ''
    || (eventId ? `event_${eventId}` : 'event');
  const normalized = String(raw || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]/g, '')
    .replace(/^optimizer[_-]+/, '');
  return normalized || (eventId ? `event_${eventId}` : 'event');
}

function findFirstExisting(paths = []) {
  return (paths || []).find(filePath => filePath && fs.existsSync(filePath)) || null;
}

function listCsvFilesInDirs(dirs) {
  const files = [];
  dirs.forEach(dir => {
    if (!dir || !fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
      if (!file.toLowerCase().endsWith('.csv')) return;
      files.push({
        name: file,
        path: path.resolve(dir, file)
      });
    });
  });
  return files;
}

function findPlayerRankingModelCsv(outputDir, tournamentName) {
  if (!outputDir || !fs.existsSync(outputDir)) return null;
  const exactName = tournamentName ? `${tournamentName} - Player Ranking Model.csv` : null;
  if (exactName) {
    const exactPath = path.resolve(outputDir, exactName);
    if (fs.existsSync(exactPath)) return exactPath;
  }
  const candidates = fs.readdirSync(outputDir)
    .filter(name => name.toLowerCase().includes('player ranking model.csv'))
    .map(name => path.resolve(outputDir, name));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.localeCompare(b));
  return candidates[0];
}

function findValidationFileByKeywords(dirs, keywords = []) {
  const normalizedKeywords = keywords.map(keyword => String(keyword || '').toLowerCase());
  const candidates = listCsvFilesInDirs(dirs);
  const matches = candidates.filter(file => {
    const lower = file.name.toLowerCase();
    return normalizedKeywords.every(keyword => lower.includes(keyword));
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches[0].path;
}

function parseCsvRows(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
    return parse(content, {
      relax_column_count: true,
      skip_empty_lines: false
    });
}

function normalizeNameForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function logSnapshotFreshness({ label, snapshot, ttlHours }) {
  if (!snapshot) return { label, status: 'missing' };
  const lastUpdatedRaw = snapshot?.payload?.last_updated || snapshot?.payload?.lastUpdated || null;
  const parsed = lastUpdatedRaw ? Date.parse(String(lastUpdatedRaw)) : NaN;
  if (!Number.isNaN(parsed)) {
    const ageHours = (Date.now() - parsed) / (1000 * 60 * 60);
    if (Number.isFinite(ttlHours) && ageHours > ttlHours) {
      console.warn(`ℹ️  ${label} snapshot is stale (${ageHours.toFixed(1)}h > ${ttlHours}h).`);
      return { label, status: 'stale', ageHours, ttlHours };
    }
    return { label, status: 'fresh', ageHours, ttlHours };
  }
  if (snapshot?.source === 'cache-stale') {
    console.warn(`ℹ️  ${label} snapshot using stale cache (no last_updated).`);
    return { label, status: 'stale', ageHours: null, ttlHours };
  }
  return { label, status: 'unknown' };
}

function resolveFileTimestamp(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return formatTimestamp(new Date(fs.statSync(filePath).mtimeMs || Date.now()));
  } catch (error) {
    return null;
  }
}

function resolveSnapshotUpdatedAt(snapshot) {
  const lastUpdatedRaw = snapshot?.payload?.last_updated
    || snapshot?.payload?.lastUpdated
    || snapshot?.payload?.meta?.generatedAt
    || snapshot?.payload?.generatedAt
    || null;
  if (lastUpdatedRaw) {
    const parsed = Date.parse(String(lastUpdatedRaw));
    if (!Number.isNaN(parsed)) return formatTimestamp(new Date(parsed));
    return String(lastUpdatedRaw);
  }
  return snapshot?.path ? resolveFileTimestamp(snapshot.path) : null;
}

function formatSnapshotUsageLine(label, snapshot) {
  if (!snapshot || !snapshot.payload) return null;
  const source = snapshot?.source || 'unknown';
  const hasPath = snapshot?.path && fs.existsSync(snapshot.path);
  const updatedAt = resolveSnapshotUpdatedAt(snapshot);
  const updatedSuffix = updatedAt ? ` (last updated ${updatedAt})` : '';
  if (hasPath) {
    const sourceLabel = (source === 'cache' || source === 'cache-stale')
      ? 'cache file'
      : (source === 'api' ? 'api; cache file' : source);
    return `- ${label}: used (${sourceLabel}): ${snapshot.path}${updatedSuffix}`;
  }
  const sourceLabel = source === 'api' ? 'api; no cache file' : source;
  return `- ${label}: used (${sourceLabel})`;
}

function buildHistoricalCachePaths({ cacheDir, tours = [], years = [], eventId = 'all' }) {
  const safeEventId = String(eventId ?? 'all').trim().toLowerCase() || 'all';
  const cachePaths = [];
  (tours || []).forEach(tour => {
    const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
    (years || []).forEach(year => {
      const safeYear = String(year || '').trim();
      const cacheSuffix = `${safeTour}_${safeEventId}_${safeYear || 'year'}`
        .replace(/[^a-z0-9._-]/g, '_');
      const cachePath = cacheDir
        ? path.resolve(cacheDir, `datagolf_historical_rounds_${cacheSuffix}.json`)
        : null;
      if (cachePath && fs.existsSync(cachePath)) {
        cachePaths.push(cachePath);
      }
    });
  });
  return cachePaths;
}

function resolveCourseNumFromHistoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const courseNum = row.course_num ?? row.courseNum ?? row.course_id ?? row.courseId ?? row.courseNumber ?? null;
  if (courseNum === null || courseNum === undefined) return null;
  const trimmed = String(courseNum).trim();
  return trimmed ? trimmed : null;
}

function buildStep1cCourseFilterMap(courseContextEntry, currentEventId) {
  const map = new Map();
  const add = (eventId, courseNums) => {
    const eventKey = String(eventId || '').trim();
    if (!eventKey) return;
    const list = Array.isArray(courseNums) ? courseNums : [courseNums];
    const normalized = list
      .map(value => String(value || '').trim())
      .filter(Boolean);
    if (normalized.length === 0) return;
    if (!map.has(eventKey)) map.set(eventKey, new Set());
    const bucket = map.get(eventKey);
    normalized.forEach(courseNum => bucket.add(courseNum));
  };

  const baseCourses = Array.isArray(courseContextEntry?.courseNums)
    ? courseContextEntry.courseNums
    : [courseContextEntry?.courseNum].filter(Boolean);
  add(currentEventId, baseCourses);

  const similarMap = courseContextEntry?.similarCourseCourseNums || {};
  Object.entries(similarMap).forEach(([eventId, courseNums]) => add(eventId, courseNums));

  const puttingMap = courseContextEntry?.puttingCourseCourseNums || {};
  Object.entries(puttingMap).forEach(([eventId, courseNums]) => add(eventId, courseNums));

  return map;
}

function isStep1cCourseAllowed(row, courseMap) {
  if (!row || !courseMap) return false;
  const eventId = String(row?.event_id || '').trim();
  if (!eventId) return false;
  const courseNum = resolveCourseNumFromHistoryRow(row);
  if (!courseNum) return false;
  const allowed = courseMap.get(eventId);
  if (!allowed || allowed.size === 0) return false;
  return allowed.has(String(courseNum).trim());
}

function buildEventCourseRoundSummary(rows, eventIdSet) {
  const counts = new Map();
  (rows || []).forEach(row => {
    const eventId = String(row?.event_id || '').trim();
    if (!eventId || (eventIdSet && !eventIdSet.has(eventId))) return;
    const courseNum = resolveCourseNumFromHistoryRow(row);
    if (!courseNum) return;
    const key = `${eventId}|${courseNum}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const entries = Array.from(counts.entries()).map(([key, rounds]) => {
    const [eventId, courseNum] = key.split('|');
    return { eventId, courseNum, rounds };
  });
  entries.sort((a, b) => {
    const eventDiff = Number(a.eventId) - Number(b.eventId);
    if (!Number.isNaN(eventDiff) && eventDiff !== 0) return eventDiff;
    const courseDiff = Number(a.courseNum) - Number(b.courseNum);
    if (!Number.isNaN(courseDiff) && courseDiff !== 0) return courseDiff;
    return String(a.courseNum).localeCompare(String(b.courseNum));
  });
  return entries;
}

function evaluateFieldIntegrity({ fieldData, fieldIdSet, approachRows, minPlayers, minApproachOverlapPct, strict }) {
  const summary = {
    fieldPlayers: Array.isArray(fieldData) ? fieldData.length : 0,
    approachRows: Array.isArray(approachRows) ? approachRows.length : 0,
    approachOverlap: 0,
    minPlayers,
    minApproachOverlapPct,
    status: 'ok'
  };

  if (!fieldData.length || fieldData.length < minPlayers) {
    summary.status = 'low_field';
  }

  if (Array.isArray(approachRows) && approachRows.length > 0 && fieldIdSet?.size) {
    const overlapCount = approachRows.reduce((count, row) => {
      const dgId = normalizeDgIdValue(row?.dg_id ?? row?.['dg_id'] ?? row?.dgId);
      if (!dgId) return count;
      return fieldIdSet.has(dgId) ? count + 1 : count;
    }, 0);
    const overlapPct = overlapCount / fieldIdSet.size;
    summary.approachOverlap = overlapPct;
    if (overlapPct < minApproachOverlapPct) {
      summary.status = summary.status === 'ok' ? 'low_approach_overlap' : summary.status;
    }
  }

  if (summary.status !== 'ok') {
    console.warn(`⚠️  Field integrity warning: status=${summary.status}, field=${summary.fieldPlayers}, approachOverlap=${(summary.approachOverlap * 100).toFixed(1)}%`);
    if (strict) {
      console.error('❌ Field integrity gate triggered; aborting run.');
      process.exit(1);
    }
  }

  return summary;
}

function buildLowDataAlert(players, options = {}) {
  if (!Array.isArray(players)) return null;
  const coverageThreshold = typeof options.coverageThreshold === 'number' ? options.coverageThreshold : 0.75;
  const topN = typeof options.topN === 'number' ? options.topN : 20;
  const alertCount = typeof options.alertCount === 'number' ? options.alertCount : 5;
  const topPlayers = players.slice(0, topN);
  const lowDataPlayers = topPlayers.filter(player => typeof player.dataCoverage === 'number' && player.dataCoverage < coverageThreshold);
  const summary = {
    coverageThreshold,
    topN,
    lowDataCount: lowDataPlayers.length,
    alertCount,
    players: lowDataPlayers.map(player => ({
      dgId: player.dgId,
      name: player.name,
      rank: player.rank,
      coverage: player.dataCoverage
    }))
  };
  if (summary.lowDataCount >= alertCount) {
    console.warn(`⚠️  Low-data alert: ${summary.lowDataCount}/${topN} players under ${Math.round(coverageThreshold * 100)}% coverage.`);
  }
  return summary;
}

function getEnvNumberValue(name, fallback) {
  const raw = parseFloat(String(process.env[name] || '').trim());
  return Number.isNaN(raw) ? fallback : raw;
}

const isTruthy = value => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const safeDateKey = value => {
  if (!value) return null;
  const str = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
};

const addDaysToDateKey = (dateKey, days = 0) => {
  const safe = safeDateKey(dateKey);
  if (!safe) return null;
  const [year, month, day] = safe.split('-').map(v => parseInt(v, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return dt.toISOString().slice(0, 10);
};

const resolveCourseLocation = (courseContextEntry = {}) => {
  if (!courseContextEntry || typeof courseContextEntry !== 'object') return {};
  const location = courseContextEntry.location || {};
  return {
    city: courseContextEntry.locationCity ?? location.city ?? null,
    state: courseContextEntry.locationState ?? location.state ?? null,
    country: courseContextEntry.locationCountry ?? location.country ?? null,
    lat: courseContextEntry.locationLat ?? location.lat ?? null,
    lon: courseContextEntry.locationLon ?? location.lon ?? null,
    query: courseContextEntry.locationQuery ?? location.query ?? null
  };
};

const coerceFiniteNumber = value => {
  if (value === null || value === undefined || value === '') return NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
};

const resolveTimeZone = courseContextEntry => {
  if (!courseContextEntry || typeof courseContextEntry !== 'object') return null;
  const raw = String(courseContextEntry.timezone || courseContextEntry.timeZone || '').trim();
  return raw ? raw : null;
};

const getLocalDatePartsFromTimeZone = (timestampSec, timeZone) => {
  if (!timeZone) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date(timestampSec * 1000));
    const map = {};
    parts.forEach(part => {
      if (part.type !== 'literal') {
        map[part.type] = part.value;
      }
    });
    if (!map.year || !map.month || !map.day || !map.hour) return null;
    return {
      dateKey: `${map.year}-${map.month}-${map.day}`,
      hour: Number(map.hour)
    };
  } catch (error) {
    console.warn(`⚠️  Failed to resolve timezone "${timeZone}": ${error.message}`);
    return null;
  }
};

const shouldUpdateWeatherContext = () => {
  const raw = String(process.env.WEATHER_UPDATE_CONTEXT || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const updateCourseContextLocation = ({ eventId, locationQuery, lat, lon, city, state, country }) => {
  const eventKey = String(eventId || '').trim();
  if (!eventKey) return false;
  if (!COURSE_CONTEXT_PATH || !fs.existsSync(COURSE_CONTEXT_PATH)) return false;
  const courseContext = loadCourseContext(COURSE_CONTEXT_PATH);
  if (!courseContext?.byEventId || !courseContext.byEventId[eventKey]) return false;
  const entry = courseContext.byEventId[eventKey];
  if (!entry || typeof entry !== 'object') return false;

  let updated = false;
  const setIfPresent = (field, value) => {
    if (value === null || value === undefined || value === '') return;
    if (entry[field] !== value) {
      entry[field] = value;
      updated = true;
    }
  };

  setIfPresent('locationQuery', locationQuery);
  setIfPresent('locationLat', Number.isFinite(lat) ? lat : null);
  setIfPresent('locationLon', Number.isFinite(lon) ? lon : null);
  setIfPresent('locationCity', city);
  setIfPresent('locationState', state);
  setIfPresent('locationCountry', country);

  if (updated) {
    courseContext.updatedAt = formatTimestamp(new Date());
    writeJsonFile(COURSE_CONTEXT_PATH, courseContext);
  }

  return updated;
};

const buildWeatherLocationQuery = ({ courseName, eventName, location }) => {
  if (location?.query) return location.query;
  const parts = [];
  if (courseName) parts.push(courseName);
  if (eventName) parts.push(eventName);
  if (location?.city) parts.push(location.city);
  if (location?.state) parts.push(location.state);
  if (location?.country) parts.push(location.country);
  const combined = parts.filter(Boolean).join(' ');
  return combined || null;
};

const buildWeatherLocationCandidates = ({ courseName, eventName, location }) => {
  const candidates = [];
  if (location?.query) candidates.push(location.query);
  if (courseName) candidates.push(courseName);
  if (eventName) candidates.push(eventName);

  if (location?.query) {
    const tokens = String(location.query)
      .replace(/[,]/g, ' ')
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean);
    const stateToken = tokens[tokens.length - 1];
    if (stateToken && /^[A-Z]{2}$/.test(stateToken)) {
      const tail2 = tokens.slice(-2).join(' ');
      const tail3 = tokens.slice(-3).join(' ');
      if (tail2) candidates.push(tail2);
      if (tail3) candidates.push(tail3);
    }
  }

  const cityStateParts = [location?.city, location?.state, location?.country]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const cityState = cityStateParts.length ? cityStateParts.join(' ') : null;

  if (courseName && cityState) candidates.push(`${courseName} ${cityState}`);
  if (eventName && cityState) candidates.push(`${eventName} ${cityState}`);
  if (cityState) candidates.push(cityState);

  const seen = new Set();
  return candidates
    .map(value => String(value || '').trim())
    .filter(value => value.length > 0)
    .filter(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const pickArraySeries = (data, keys = []) => {
  if (!data || typeof data !== 'object') return null;
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
  }
  return null;
};

const loadWeatherPenaltyCache = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.penalties || typeof payload.penalties !== 'object') return null;
    return payload;
  } catch (error) {
    console.warn(`⚠️  Failed to read weather penalty cache: ${error.message}`);
    return null;
  }
};

const writeWeatherPenaltyCache = (filePath, payload) => {
  if (!filePath || !payload || typeof payload !== 'object') return false;
  try {
    ensureDirectory(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return true;
  } catch (error) {
    console.warn(`⚠️  Unable to write weather penalty cache: ${error.message}`);
    return false;
  }
};

const computeWeatherWavePenalties = async ({
  fieldUpdatesPayload,
  courseContextEntry,
  cacheDir,
  apiKey,
  eventId = null
}) => {
  if (!WEATHER_ENABLED || !apiKey) {
    return { enabled: false, reason: apiKey ? 'disabled' : 'missing-key' };
  }

  const eventName = fieldUpdatesPayload?.event_name || null;
  const courseNameRaw = fieldUpdatesPayload?.course_name || null;
  const courseName = courseNameRaw ? String(courseNameRaw).split(';')[0].trim() : null;
  const dateStart = safeDateKey(fieldUpdatesPayload?.date_start);
  if (!dateStart) {
    return { enabled: false, reason: 'missing-date-start' };
  }

  const location = resolveCourseLocation(courseContextEntry);
  const locationQuery = buildWeatherLocationQuery({ courseName, eventName, location });
  const locationCandidates = buildWeatherLocationCandidates({ courseName, eventName, location });

  let lat = coerceFiniteNumber(location.lat);
  let lon = coerceFiniteNumber(location.lon);
  let locationSource = null;
  let locationQueryUsed = locationQuery;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const ttlMs = WEATHER_TTL_HOURS * 60 * 60 * 1000;
    let first = null;
    let locationSnapshot = null;

    for (const query of locationCandidates) {
      const attemptLookup = async forceRefresh => getMeteoblueLocation({
        apiKey,
        query,
        cacheDir,
        ttlMs,
        allowStale: true,
        forceRefresh
      });

      let snapshot = await attemptLookup(false);
      let payload = snapshot?.payload;
      let results = Array.isArray(payload?.results)
        ? payload.results
        : (Array.isArray(payload) ? payload : []);

      if (results.length === 0 && snapshot?.source === 'cache') {
        snapshot = await attemptLookup(true);
        payload = snapshot?.payload;
        results = Array.isArray(payload?.results)
          ? payload.results
          : (Array.isArray(payload) ? payload : []);
      }

      if (results.length > 0) {
        first = results[0] || null;
        locationSnapshot = snapshot;
        locationQueryUsed = query;
        break;
      }
    }

    lat = coerceFiniteNumber(first?.lat);
    lon = coerceFiniteNumber(first?.lon);
    locationSource = locationSnapshot?.source || null;

    if (Number.isFinite(lat) && Number.isFinite(lon) && shouldUpdateWeatherContext()) {
      const updated = updateCourseContextLocation({
        eventId: eventId || fieldUpdatesPayload?.event_id || null,
        locationQuery: locationQueryUsed || locationQuery,
        lat,
        lon,
        city: first?.name ?? first?.city ?? null,
        state: first?.admin1 ?? first?.state ?? null,
        country: first?.country ?? null
      });
      if (updated) {
        console.log('ℹ️  Course context location updated from Meteoblue lookup.');
      }
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      enabled: false,
      reason: 'missing-location',
      locationQuery: locationQueryUsed || locationQuery,
      locationSource
    };
  }

  const forecastSnapshot = await getMeteoblueForecast({
    apiKey,
    lat,
    lon,
    packageName: WEATHER_PACKAGE,
    cacheDir,
    ttlMs: WEATHER_TTL_HOURS * 60 * 60 * 1000,
    allowStale: true,
    timeformat: 'timestamp_utc',
    tz: 'UTC',
    windspeed: 'mph',
    precipitationamount: 'mm',
    temperature: 'F',
    forecastDays: WEATHER_FORECAST_DAYS
  });

  const data1h = forecastSnapshot?.payload?.data_1h || forecastSnapshot?.payload?.data_1hr || null;
  const dataDay = forecastSnapshot?.payload?.data_day || null;
  if (!data1h) {
    return { enabled: false, reason: 'missing-1h-data', source: forecastSnapshot?.source || null };
  }

  const timeSeries = pickArraySeries(data1h, ['time', 'times', 'timestamp']);
  const precipProbSeries = pickArraySeries(data1h, [
    'precipitation_probability',
    'precipitation_probability_mean',
    'precipitation_probability_max',
    'precipitation_probability_min',
    'precipitation_prob'
  ]);
  const precipAmountSeries = pickArraySeries(data1h, [
    'precipitation',
    'precipitation_sum',
    'precipitation_amount'
  ]);
  const convectiveAmountSeries = pickArraySeries(data1h, [
    'convective_precipitation',
    'convective_precipitation_sum',
    'convective_precipitation_amount'
  ]);
  const convectiveProbSeries = pickArraySeries(data1h, [
    'convective_precipitation_probability',
    'convective_precipitation_probability_mean',
    'convective_precipitation_probability_max',
    'convective_precipitation_probability_min'
  ]);
  const windSpeedSeries = pickArraySeries(data1h, [
    'windspeed',
    'wind_speed',
    'wind_speed_10m',
    'wind_speed_mean',
    'wind_speed_max'
  ]);
  const windGustSeries = pickArraySeries(data1h, [
    'windgusts',
    'wind_gust',
    'wind_gusts_10m',
    'wind_gusts',
    'wind_gust_speed',
    'wind_gusts_max'
  ]);

  if (!Array.isArray(timeSeries) || timeSeries.length === 0) {
    return { enabled: false, reason: 'missing-time-series' };
  }

  const dayTimeSeries = dataDay ? pickArraySeries(dataDay, ['time', 'times', 'timestamp']) : null;
  const dayPredictabilityClass = dataDay ? pickArraySeries(dataDay, [
    'predictability_class',
    'predictabilityClass'
  ]) : null;

  const tzOffsetSec = Number(fieldUpdatesPayload?.tz_offset ?? 0);
  const tzOffsetMs = Number.isFinite(tzOffsetSec) ? tzOffsetSec * 1000 : 0;
  const timeZone = resolveTimeZone(courseContextEntry);

  const amStart = getEnvNumberValue('WEATHER_WAVE_AM_START', 6);
  const amEnd = getEnvNumberValue('WEATHER_WAVE_AM_END', 12);
  const pmStart = getEnvNumberValue('WEATHER_WAVE_PM_START', 12);
  const pmEnd = getEnvNumberValue('WEATHER_WAVE_PM_END', 18);

  const r1Date = dateStart;
  const r2Date = addDaysToDateKey(dateStart, 1);

  const windows = [
    { key: 'R1_AM', dateKey: r1Date, start: amStart, end: amEnd },
    { key: 'R1_PM', dateKey: r1Date, start: pmStart, end: pmEnd },
    { key: 'R2_AM', dateKey: r2Date, start: amStart, end: amEnd },
    { key: 'R2_PM', dateKey: r2Date, start: pmStart, end: pmEnd }
  ];

  const windowStats = windows.reduce((acc, window) => {
    acc[window.key] = {
      maxProb: null,
      sumPrecip: 0,
      maxPrecip: null,
      sumConvective: 0,
      maxConvectiveProb: null,
      predictabilityClass: null,
      maxWind: null,
      maxGust: null,
      samples: 0
    };
    return acc;
  }, {});
  const hourlyStats = new Map();

  const resolveDateKeyForTimestamp = ts => {
    let dateKey = null;
    if (timeZone) {
      const localParts = getLocalDatePartsFromTimeZone(ts, timeZone);
      if (localParts) {
        dateKey = localParts.dateKey;
      }
    }
    if (!dateKey) {
      const localDate = new Date((ts * 1000) + tzOffsetMs);
      dateKey = localDate.toISOString().slice(0, 10);
    }
    return dateKey;
  };

  const predictabilityByDate = new Map();
  if (Array.isArray(dayTimeSeries) && Array.isArray(dayPredictabilityClass)) {
    dayTimeSeries.forEach((timestamp, idx) => {
      const ts = Number(timestamp);
      if (!Number.isFinite(ts)) return;
      const classValue = Number(dayPredictabilityClass[idx]);
      if (!Number.isFinite(classValue)) return;
      const dateKey = resolveDateKeyForTimestamp(ts);
      if (!dateKey) return;
      predictabilityByDate.set(dateKey, classValue);
    });
  }

  Object.values(windowStats).forEach(stats => {
    stats.predictabilityClass = null;
  });

  timeSeries.forEach((timestamp, idx) => {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return;

    let dateKey = null;
    let hour = null;

    if (timeZone) {
      const localParts = getLocalDatePartsFromTimeZone(ts, timeZone);
      if (localParts) {
        dateKey = localParts.dateKey;
        hour = localParts.hour;
      }
    }

    if (!dateKey || hour === null) {
      const localDate = new Date((ts * 1000) + tzOffsetMs);
      dateKey = localDate.toISOString().slice(0, 10);
      hour = localDate.getUTCHours();
    }

    const hourlyKey = `${dateKey}|${hour}`;
    let hourly = hourlyStats.get(hourlyKey);
    if (!hourly) {
      hourly = {
        maxProb: null,
        sumPrecip: 0,
        maxPrecip: null,
        sumConvective: 0,
        maxConvectiveProb: null,
        predictabilityClass: null,
        maxWind: null,
        maxGust: null,
        samples: 0
      };
      hourlyStats.set(hourlyKey, hourly);
    }

    if (hourly.predictabilityClass === null) {
      const classValue = predictabilityByDate.get(dateKey);
      if (Number.isFinite(classValue)) {
        hourly.predictabilityClass = classValue;
      }
    }

    const probHourly = precipProbSeries ? Number(precipProbSeries[idx]) : null;
    const precipHourly = precipAmountSeries ? Number(precipAmountSeries[idx]) : null;
    const convectiveHourly = convectiveAmountSeries ? Number(convectiveAmountSeries[idx]) : null;
    const convectiveProbRawHourly = convectiveProbSeries ? Number(convectiveProbSeries[idx]) : null;
    const convectiveProbHourly = Number.isFinite(convectiveProbRawHourly)
      ? convectiveProbRawHourly
      : (Number.isFinite(convectiveHourly) && convectiveHourly > 0 && Number.isFinite(probHourly) ? probHourly : null);
    const windHourly = windSpeedSeries ? Number(windSpeedSeries[idx]) : null;
    const gustHourly = windGustSeries ? Number(windGustSeries[idx]) : null;
    if (Number.isFinite(probHourly)) {
      hourly.maxProb = hourly.maxProb === null ? probHourly : Math.max(hourly.maxProb, probHourly);
    }
    if (Number.isFinite(precipHourly)) {
      hourly.sumPrecip += precipHourly;
      hourly.maxPrecip = hourly.maxPrecip === null ? precipHourly : Math.max(hourly.maxPrecip, precipHourly);
    }
    if (Number.isFinite(convectiveHourly)) {
      hourly.sumConvective += convectiveHourly;
    }
    if (Number.isFinite(convectiveProbHourly)) {
      hourly.maxConvectiveProb = hourly.maxConvectiveProb === null
        ? convectiveProbHourly
        : Math.max(hourly.maxConvectiveProb, convectiveProbHourly);
    }
    if (Number.isFinite(windHourly)) {
      hourly.maxWind = hourly.maxWind === null ? windHourly : Math.max(hourly.maxWind, windHourly);
    }
    if (Number.isFinite(gustHourly)) {
      hourly.maxGust = hourly.maxGust === null ? gustHourly : Math.max(hourly.maxGust, gustHourly);
    }
    hourly.samples += 1;

    windows.forEach(window => {
      if (window.dateKey !== dateKey) return;
      if (hour < window.start || hour >= window.end) return;
      const stats = windowStats[window.key];
      if (!stats) return;
      if (stats.predictabilityClass === null) {
        const classValue = predictabilityByDate.get(dateKey);
        if (Number.isFinite(classValue)) {
          stats.predictabilityClass = classValue;
        }
      }
      const prob = precipProbSeries ? Number(precipProbSeries[idx]) : null;
      const precip = precipAmountSeries ? Number(precipAmountSeries[idx]) : null;
      const convective = convectiveAmountSeries ? Number(convectiveAmountSeries[idx]) : null;
      const convectiveProbRaw = convectiveProbSeries ? Number(convectiveProbSeries[idx]) : null;
      const convectiveProb = Number.isFinite(convectiveProbRaw)
        ? convectiveProbRaw
        : (Number.isFinite(convective) && convective > 0 && Number.isFinite(prob) ? prob : null);
      const wind = windSpeedSeries ? Number(windSpeedSeries[idx]) : null;
      const gust = windGustSeries ? Number(windGustSeries[idx]) : null;
      if (Number.isFinite(prob)) {
        stats.maxProb = stats.maxProb === null ? prob : Math.max(stats.maxProb, prob);
      }
      if (Number.isFinite(precip)) {
        stats.sumPrecip += precip;
        stats.maxPrecip = stats.maxPrecip === null ? precip : Math.max(stats.maxPrecip, precip);
      }
      if (Number.isFinite(convective)) {
        stats.sumConvective += convective;
      }
      if (Number.isFinite(convectiveProb)) {
        stats.maxConvectiveProb = stats.maxConvectiveProb === null
          ? convectiveProb
          : Math.max(stats.maxConvectiveProb, convectiveProb);
      }
      if (Number.isFinite(wind)) {
        stats.maxWind = stats.maxWind === null ? wind : Math.max(stats.maxWind, wind);
      }
      if (Number.isFinite(gust)) {
        stats.maxGust = stats.maxGust === null ? gust : Math.max(stats.maxGust, gust);
      }
      stats.samples += 1;
    });
  });

  const rainProbMaxPenalty = getEnvNumberValue('WEATHER_RAIN_PROB_MAX_PENALTY', 0.10);
  const rainProbGamma = getEnvNumberValue('WEATHER_RAIN_PROB_GAMMA', 1.7);

  const rainAmtLow = getEnvNumberValue('WEATHER_RAIN_AMT_LOW', 0.5);
  const rainAmtMed = getEnvNumberValue('WEATHER_RAIN_AMT_MED', 2.0);
  const rainAmtHigh = getEnvNumberValue('WEATHER_RAIN_AMT_HIGH', 5.0);
  const rainAmtPenaltyLow = getEnvNumberValue('WEATHER_RAIN_AMT_PENALTY_LOW', 0.02);
  const rainAmtPenaltyMed = getEnvNumberValue('WEATHER_RAIN_AMT_PENALTY_MED', 0.04);
  const rainAmtPenaltyHigh = getEnvNumberValue('WEATHER_RAIN_AMT_PENALTY_HIGH', 0.06);
  const convectiveProbThreshold = getEnvNumberValue('WEATHER_CONVECTIVE_PROB_THRESHOLD', 40);
  const convectivePenalty = getEnvNumberValue('WEATHER_CONVECTIVE_PENALTY', 0.08);

  const windSustainedThreshold = getEnvNumberValue('WEATHER_WIND_SUSTAINED_THRESHOLD', 15);
  const windGustThreshold = getEnvNumberValue('WEATHER_WIND_GUST_THRESHOLD', 20);
  const windPenaltyOne = getEnvNumberValue('WEATHER_WIND_PENALTY_ONE', 0.03);
  const windPenaltyBoth = getEnvNumberValue('WEATHER_WIND_PENALTY_BOTH', 0.05);
  const penaltyCap = getEnvNumberValue('WEATHER_PENALTY_CAP', 0.14);

  const computePenaltyForStats = stats => {
    const prob = Number.isFinite(stats.maxProb) ? stats.maxProb : null;
    let rainPenalty = 0;
    if (prob !== null) {
      const normalizedProb = Math.max(0, Math.min(1, prob / 100));
      const gamma = Number.isFinite(rainProbGamma) && rainProbGamma > 0 ? rainProbGamma : 1;
      rainPenalty = rainProbMaxPenalty * Math.pow(normalizedProb, gamma);
    }

    const predictabilityClass = Number.isFinite(stats.predictabilityClass)
      ? stats.predictabilityClass
      : null;
    const predictabilityScale = predictabilityClass !== null
      ? Math.max(0, Math.min(1, (predictabilityClass * 0.2)))
      : 1;
    if (rainPenalty > 0) {
      rainPenalty *= predictabilityScale;
    }

    const precipTotal = Number.isFinite(stats.sumPrecip) ? stats.sumPrecip : null;
    const convectiveTotal = Number.isFinite(stats.sumConvective) ? stats.sumConvective : 0;
    const nonConvectiveTotal = precipTotal !== null
      ? Math.max(0, precipTotal - convectiveTotal)
      : null;
    let rainAmountPenalty = 0;
    if (nonConvectiveTotal !== null) {
      if (nonConvectiveTotal >= rainAmtHigh) rainAmountPenalty = rainAmtPenaltyHigh;
      else if (nonConvectiveTotal >= rainAmtMed) rainAmountPenalty = rainAmtPenaltyMed;
      else if (nonConvectiveTotal >= rainAmtLow) rainAmountPenalty = rainAmtPenaltyLow;
    }

    const convectiveProb = Number.isFinite(stats.maxConvectiveProb) ? stats.maxConvectiveProb : null;
    const convectiveHit = convectiveProb !== null && convectiveProb >= convectiveProbThreshold;
    const convectivePenaltyApplied = convectiveHit ? convectivePenalty : 0;

    const sustainedHit = Number.isFinite(stats.maxWind) && stats.maxWind >= windSustainedThreshold;
    const gustHit = Number.isFinite(stats.maxGust) && stats.maxGust >= windGustThreshold;
    let windPenalty = 0;
    if (sustainedHit && gustHit) windPenalty = windPenaltyBoth;
    else if (sustainedHit || gustHit) windPenalty = windPenaltyOne;

    const total = Math.min(
      penaltyCap,
      rainPenalty + rainAmountPenalty + convectivePenaltyApplied + windPenalty
    );
    return {
      total,
      rainPenalty,
      rainAmountPenalty,
      convectivePenalty: convectivePenaltyApplied,
      convectiveProb,
      convectiveHit,
      nonConvectiveTotal,
      predictabilityClass,
      predictabilityScale,
      windPenalty,
      sustainedHit,
      gustHit
    };
  };

  const penalties = {};
  Object.entries(windowStats).forEach(([key, stats]) => {
    penalties[key] = { ...stats, ...computePenaltyForStats(stats) };
  });

  const hourlyPenalties = {};
  hourlyStats.forEach((stats, key) => {
    const [dateKey, hourValue] = key.split('|');
    const hour = Number(hourValue);
    const penalty = computePenaltyForStats(stats).total;
    if (!hourlyPenalties[dateKey]) hourlyPenalties[dateKey] = {};
    hourlyPenalties[dateKey][hour] = Number.isFinite(penalty) ? penalty : 0;
  });

  return {
    enabled: true,
    dateStart,
    locationQuery,
    lat,
    lon,
    penalties,
    hourlyPenalties,
    source: forecastSnapshot?.source || null
  };
};

function normalizeValidationMetricName(metricName) {
  const aliases = {
    'Poor Shot Avoidance': 'Poor Shots'
  };
  return aliases[metricName] || metricName;
}

function buildMetricNameToGroupMap(metricConfig) {
  const map = new Map();
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return map;
  metricConfig.groups.forEach(group => {
    group.metrics.forEach(metric => {
      map.set(metric.name, group.name);
    });
  });
  return map;
}

function resolveValidationMetricToConfig(metricName, metricConfig) {
  if (!metricName) return null;
  const normalized = normalizeValidationMetricName(metricName);
  const labelMap = buildMetricNameToGroupMap(metricConfig);
  if (labelMap.has(normalized)) return normalized;

  const stripped = normalizeGeneratedMetricLabel(normalized);
  if (!stripped) return null;
  const matches = [];
  labelMap.forEach((groupName, name) => {
    if (normalizeGeneratedMetricLabel(name) === stripped) {
      matches.push(name);
    }
  });
  if (matches.length === 1) return matches[0];
  return null;
}

function parseValidationTypeSummary(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const rows = parseCsvRows(filePath);
  if (!rows.length) return null;

  let headerIndex = -1;
  let metricIdx = -1;
  let corrIdx = -1;

  rows.forEach((row, idx) => {
    if (headerIndex !== -1) return;
    const cells = row.map(cell => String(cell || '').trim());
    const metricCol = cells.findIndex(cell => cell.toLowerCase() === 'metric');
    const corrCol = cells.findIndex(cell => cell.toLowerCase().includes('avg correlation'));
    if (metricCol !== -1 && corrCol !== -1) {
      headerIndex = idx;
      metricIdx = metricCol;
      corrIdx = corrCol;
    }
  });

  if (headerIndex === -1) return null;
  const dataRows = rows.slice(headerIndex + 1);
  const metrics = [];
  dataRows.forEach(row => {
    const metric = String(row[metricIdx] || '').trim();
    if (!metric) return;
    const corrValue = parseFloat(String(row[corrIdx] || '').replace('%', '').trim());
    if (Number.isNaN(corrValue)) return;
    metrics.push({ metric, avgCorrelation: corrValue });
  });

  return metrics.length ? metrics : null;
}

function parseValidationWeightTemplates(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const rows = parseCsvRows(filePath);
  const results = { POWER: [], TECHNICAL: [], BALANCED: [] };
  let currentType = null;
  let columnIndex = null;

  rows.forEach(rawRow => {
    const row = rawRow.map(cell => String(cell || '').trim());
    const firstCell = row[0] || '';
    const upperCell = firstCell.toUpperCase();

    if (upperCell.includes('POWER COURSES')) {
      currentType = 'POWER';
      columnIndex = null;
      return;
    }
    if (upperCell.includes('TECHNICAL COURSES')) {
      currentType = 'TECHNICAL';
      columnIndex = null;
      return;
    }
    if (upperCell.includes('BALANCED COURSES')) {
      currentType = 'BALANCED';
      columnIndex = null;
      return;
    }

    if (!currentType) return;
    if (firstCell.toLowerCase() === 'metric') {
      columnIndex = {
        metric: row.findIndex(cell => cell.toLowerCase() === 'metric'),
        config: row.findIndex(cell => cell.toLowerCase().includes('config weight')),
        template: row.findIndex(cell => cell.toLowerCase().includes('template weight')),
        recommended: row.findIndex(cell => cell.toLowerCase().includes('recommended'))
      };
      return;
    }

    if (!columnIndex || columnIndex.metric === -1) return;
    const metric = row[columnIndex.metric];
    if (!metric) return;
    const configWeight = parseFloat(row[columnIndex.config]);
    const templateWeight = parseFloat(row[columnIndex.template]);
    const recommendedWeight = parseFloat(row[columnIndex.recommended]);
    results[currentType].push({
      metric,
      configWeight: Number.isNaN(configWeight) ? null : configWeight,
      templateWeight: Number.isNaN(templateWeight) ? null : templateWeight,
      recommendedWeight: Number.isNaN(recommendedWeight) ? null : recommendedWeight
    });
  });

  return results;
}

function parseValidationDeltaTrends(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const rows = parseCsvRows(filePath);
  if (!rows.length) return null;

  let headerIndex = -1;
  let metricIdx = -1;
  let biasIdx = -1;
  let statusIdx = -1;

  rows.forEach((row, idx) => {
    if (headerIndex !== -1) return;
    const cells = row.map(cell => String(cell || '').trim());
    const metricCol = cells.findIndex(cell => cell.toLowerCase() === 'metric');
    const biasCol = cells.findIndex(cell => cell.toLowerCase().includes('bias z'));
    const statusCol = cells.findIndex(cell => cell.toLowerCase() === 'status');
    if (metricCol !== -1) {
      headerIndex = idx;
      metricIdx = metricCol;
      biasIdx = biasCol;
      statusIdx = statusCol;
    }
  });

  if (headerIndex === -1) return null;
  const dataRows = rows.slice(headerIndex + 1);
  const results = [];
  dataRows.forEach(row => {
    const metric = String(row[metricIdx] || '').trim();
    if (!metric) return;
    const biasZ = biasIdx !== -1 ? parseFloat(String(row[biasIdx] || '').trim()) : null;
    const status = statusIdx !== -1 ? String(row[statusIdx] || '').trim().toUpperCase() : null;
    results.push({ metric, biasZ: Number.isNaN(biasZ) ? null : biasZ, status });
  });

  return results.length ? results : null;
}

function determineValidationCourseType(typeSummaries) {
  const scores = Object.entries(typeSummaries || {}).map(([type, metrics]) => {
    if (!metrics || metrics.length === 0) return { type, score: -Infinity };
    const total = metrics.reduce((sum, entry) => sum + Math.abs(entry.avgCorrelation || 0), 0);
    return { type, score: total / metrics.length };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.score > -Infinity ? scores[0].type : null;
}

function buildTop20SignalMap(top20Correlations = [], top20Logistic = null, metricLabels = []) {
  const signalMap = new Map();
  const corrEntries = Array.isArray(top20Correlations)
    ? top20Correlations.filter(entry => typeof entry?.correlation === 'number' && Number.isFinite(entry.correlation))
    : [];
  if (corrEntries.length > 0) {
    const corrSum = corrEntries.reduce((sum, entry) => sum + Math.abs(entry.correlation), 0) || 0;
    corrEntries.forEach(entry => {
      const label = normalizeGeneratedMetricLabel(entry.label);
      if (!label) return;
      const value = Math.abs(entry.correlation);
      signalMap.set(label, corrSum > 0 ? value / corrSum : value);
    });
  }

  if (top20Logistic && top20Logistic.success && Array.isArray(top20Logistic.weights) && metricLabels.length > 0) {
    const weights = top20Logistic.weights.map(value => Math.abs(value || 0));
    const total = weights.reduce((sum, value) => sum + value, 0) || 0;
    weights.forEach((value, idx) => {
      const label = normalizeGeneratedMetricLabel(metricLabels[idx]);
      if (!label) return;
      const normalized = total > 0 ? value / total : value;
      const existing = signalMap.get(label) || 0;
      const blended = corrEntries.length > 0 ? (existing * 0.5 + normalized * 0.5) : normalized;
      signalMap.set(label, blended);
    });
  }

  return signalMap;
}

function computeTemplateAlignmentScores(metricConfig, templateConfigs = {}, signalMap = new Map()) {
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return {};
  if (!signalMap || signalMap.size === 0) return {};

  const scores = {};
  ['POWER', 'TECHNICAL', 'BALANCED'].forEach(type => {
    const template = templateConfigs[type];
    if (!template) return;
    const flatWeights = flattenMetricWeights(metricConfig, template.metricWeights || {});
    let total = 0;
    const weightMap = new Map();
    Object.entries(flatWeights).forEach(([key, value]) => {
      const [, metricNameRaw] = key.split('::');
      const label = normalizeGeneratedMetricLabel(metricNameRaw);
      if (!label) return;
      const weight = Math.abs(typeof value === 'number' ? value : 0);
      if (weight <= 0) return;
      weightMap.set(label, weight);
      total += weight;
    });
    if (total <= 0) return;

    let dot = 0;
    signalMap.forEach((signal, label) => {
      const templateWeight = weightMap.get(label) || 0;
      if (!templateWeight) return;
      dot += signal * (templateWeight / total);
    });
    scores[type] = dot;
  });

  return scores;
}

function buildValidationAlignmentMap(metricConfig, summaryMetrics = []) {
  const map = new Map();
  (summaryMetrics || []).forEach(entry => {
    const resolved = resolveValidationMetricToConfig(entry.metric, metricConfig);
    if (!resolved) return;
    if (typeof entry.avgCorrelation !== 'number' || Number.isNaN(entry.avgCorrelation)) return;
    map.set(normalizeGeneratedMetricLabel(resolved), entry.avgCorrelation);
  });
  return map;
}

function buildDeltaTrendMap(metricConfig, deltaTrends = []) {
  const map = new Map();
  (deltaTrends || []).forEach(entry => {
    const resolved = resolveValidationMetricToConfig(entry.metric, metricConfig);
    if (!resolved) return;
    const biasZ = typeof entry.biasZ === 'number' ? entry.biasZ : null;
    const score = biasZ !== null ? (1 - biasZ) : 0;
    map.set(normalizeGeneratedMetricLabel(resolved), score);
  });
  return map;
}

function buildValidationMetricWeights(metricConfig, validationWeights = [], fallbackMetricWeights = {}) {
  const metricWeights = { ...(fallbackMetricWeights || {}) };
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return metricWeights;

  const validationMap = new Map();
  validationWeights.forEach(entry => {
    const resolved = resolveValidationMetricToConfig(entry.metric, metricConfig);
    if (!resolved) return;
    const weight = typeof entry.recommendedWeight === 'number'
      ? entry.recommendedWeight
      : (typeof entry.templateWeight === 'number' ? entry.templateWeight : null);
    if (weight === null || Number.isNaN(weight)) return;
    validationMap.set(resolved, weight);
  });

  metricConfig.groups.forEach(group => {
    const keys = group.metrics.map(metric => metric.name);
    const weights = keys.map(metricName => validationMap.has(metricName) ? validationMap.get(metricName) : null);
    const hasValidation = weights.some(weight => typeof weight === 'number');
    if (!hasValidation) return;
    const normalized = weights.map(weight => (typeof weight === 'number' ? weight : 0));
    const total = normalized.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return;
    group.metrics.forEach((metric, idx) => {
      const key = `${group.name}::${metric.name}`;
      metricWeights[key] = normalized[idx] / total;
    });
  });

  return metricWeights;
}

function buildValidationGroupWeights(metricConfig, summaryMetrics = [], fallbackGroupWeights = {}) {
  const groupWeights = { ...(fallbackGroupWeights || {}) };
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return groupWeights;
  const groupMap = buildMetricNameToGroupMap(metricConfig);
  const totals = {};

  summaryMetrics.forEach(entry => {
    const resolved = resolveValidationMetricToConfig(entry.metric, metricConfig);
    if (!resolved) return;
    const groupName = groupMap.get(resolved);
    if (!groupName) return;
    const corr = Math.abs(entry.avgCorrelation || 0);
    totals[groupName] = (totals[groupName] || 0) + corr;
  });

  const totalWeight = Object.values(totals).reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) return groupWeights;

  Object.entries(totals).forEach(([groupName, value]) => {
    groupWeights[groupName] = value / totalWeight;
  });

  return normalizeWeights(groupWeights);
}

function buildValidationTemplateForType({
  type,
  metricConfig,
  validationData,
  templateConfigs,
  eventId,
  sourceLabel
}) {
  if (!type) return null;
  const weightsForType = validationData?.weightTemplates?.[type] || [];
  const summaryForType = validationData?.typeSummaries?.[type] || [];
  if (!weightsForType.length && !summaryForType.length) return null;

  const fallbackTemplate = templateConfigs?.[type]
    || templateConfigs?.[String(eventId)]
    || Object.values(templateConfigs || {})[0];

  const groupWeights = buildValidationGroupWeights(
    metricConfig,
    summaryForType,
    fallbackTemplate?.groupWeights || {}
  );
  const metricWeights = buildValidationMetricWeights(
    metricConfig,
    weightsForType,
    fallbackTemplate?.metricWeights || {}
  );

  const descriptionSuffix = sourceLabel ? ` (${sourceLabel})` : '';
  return {
    name: type,
    description: `Validation CSV ${type} template${descriptionSuffix}`,
    groupWeights,
    metricWeights: nestMetricWeights(metricWeights)
  };
}

function buildValidationMetricConstraints(metricConfig, validationWeights = [], rangePct = VALIDATION_RANGE_PCT) {
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return {};
  const constraints = {};
  const validationMap = new Map();
  validationWeights.forEach(entry => {
    const resolved = resolveValidationMetricToConfig(entry.metric, metricConfig);
    if (!resolved) return;
    const weight = typeof entry.recommendedWeight === 'number'
      ? entry.recommendedWeight
      : (typeof entry.templateWeight === 'number' ? entry.templateWeight : null);
    if (weight === null || Number.isNaN(weight)) return;
    validationMap.set(resolved, weight);
  });

  metricConfig.groups.forEach(group => {
    group.metrics.forEach(metric => {
      const validated = validationMap.get(metric.name);
      if (validated === undefined) return;
      const key = `${group.name}::${metric.name}`;
      constraints[key] = {
        min: Math.max(0, validated * (1 - rangePct)),
        max: validated * (1 + rangePct)
      };
    });
  });

  return constraints;
}

function flattenMetricWeights(metricConfig, metricWeights) {
  const flattened = {};
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return flattened;
  if (!metricWeights) return flattened;

  metricConfig.groups.forEach(group => {
    group.metrics.forEach(metric => {
      const flatKey = `${group.name}::${metric.name}`;
      if (Object.prototype.hasOwnProperty.call(metricWeights, flatKey)) {
        const value = metricWeights[flatKey];
        flattened[flatKey] = typeof value === 'number' ? value : (value?.weight ?? null);
        return;
      }
      const groupBlock = metricWeights[group.name];
      if (groupBlock && Object.prototype.hasOwnProperty.call(groupBlock, metric.name)) {
        const entry = groupBlock[metric.name];
        flattened[flatKey] = typeof entry === 'number' ? entry : (entry?.weight ?? null);
      }
    });
  });

  return flattened;
}

function templatesAreDifferent(templateA, templateB, metricConfig, tolerance = 1e-4) {
  if (!templateA || !templateB) return true;
  const groupWeightsA = templateA.groupWeights || {};
  const groupWeightsB = templateB.groupWeights || {};
  const groupKeys = new Set([...Object.keys(groupWeightsA), ...Object.keys(groupWeightsB)]);
  for (const key of groupKeys) {
    const a = groupWeightsA[key] ?? null;
    const b = groupWeightsB[key] ?? null;
    if (a === null || b === null) return true;
    if (Math.abs(a - b) > tolerance) return true;
  }

  const flatA = flattenMetricWeights(metricConfig, templateA.metricWeights || {});
  const flatB = flattenMetricWeights(metricConfig, templateB.metricWeights || {});
  const metricKeys = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);
  for (const key of metricKeys) {
    const a = flatA[key];
    const b = flatB[key];
    if (a === null || b === null || a === undefined || b === undefined) return true;
    if (Math.abs(a - b) > tolerance) return true;
  }

  return false;
}

function adjustConstraintsByDeltaTrends(metricConfig, constraints = {}, deltaTrends = []) {
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return constraints;
  if (!deltaTrends || deltaTrends.length === 0) return constraints;
  const statusMap = new Map();
  deltaTrends.forEach(entry => {
    const resolved = resolveValidationMetricToConfig(entry.metric, metricConfig);
    if (!resolved) return;
    const status = String(entry.status || '').toUpperCase();
    statusMap.set(resolved, status);
  });

  const updated = { ...constraints };
  Object.entries(updated).forEach(([key, constraint]) => {
    const [, metricNameRaw] = key.split('::');
    const metricName = metricNameRaw ? metricNameRaw.trim() : null;
    if (!metricName || !constraint) return;
    const status = statusMap.get(metricName) || 'WATCH';
    const rangePct = DELTA_TREND_RANGE[status] ?? VALIDATION_RANGE_PCT;
    const center = (constraint.min + constraint.max) / 2;
    updated[key] = {
      min: Math.max(0, center * (1 - rangePct)),
      max: center * (1 + rangePct)
    };
  });

  return updated;
}

function summarizeDeltaTrendGuardrails(metricConfig, constraints = {}, deltaTrends = []) {
  const summary = {
    totalConstrained: 0,
    statusCounts: { STABLE: 0, WATCH: 0, CHRONIC: 0 },
    ranges: { ...DELTA_TREND_RANGE }
  };
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return summary;

  const statusMap = new Map();
  (deltaTrends || []).forEach(entry => {
    const resolved = resolveValidationMetricToConfig(entry.metric, metricConfig);
    if (!resolved) return;
    const status = String(entry.status || '').toUpperCase();
    statusMap.set(resolved, status);
  });

  Object.keys(constraints || {}).forEach(key => {
    const [, metricNameRaw] = key.split('::');
    const metricName = metricNameRaw ? metricNameRaw.trim() : null;
    if (!metricName) return;
    const status = statusMap.get(metricName) || 'WATCH';
    if (!summary.statusCounts[status]) summary.statusCounts[status] = 0;
    summary.statusCounts[status] += 1;
    summary.totalConstrained += 1;
  });

  return summary;
}

function applyMetricWeightConstraints(metricConfig, metricWeights, constraints = {}) {
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return metricWeights;
  const updated = { ...metricWeights };
  metricConfig.groups.forEach(group => {
    const keys = group.metrics.map(metric => `${group.name}::${metric.name}`);
    const clamped = keys.map(key => {
      const value = typeof updated[key] === 'number' ? updated[key] : 0;
      const constraint = constraints[key];
      if (!constraint) return value;
      return Math.min(constraint.max, Math.max(constraint.min, value));
    });
    const total = clamped.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return;
    keys.forEach((key, idx) => {
      updated[key] = clamped[idx] / total;
    });
  });
  return updated;
}

function loadValidationOutputs(metricConfig, dirs) {
  const dataDirs = dirs || [DATA_DIR, DEFAULT_DATA_DIR];
  const correlationDirs = [];
  dataDirs.forEach(dir => {
    if (!dir) return;
    const analysisDir = path.resolve(dir, 'template_correlation_analysis');
    const summariesDir = path.resolve(dir, 'template_correlation_summaries');
    if (fs.existsSync(analysisDir)) correlationDirs.push(analysisDir);
    if (fs.existsSync(summariesDir)) correlationDirs.push(summariesDir);
  });
  const searchDirs = [...dataDirs, ...correlationDirs];
  const findTypeSummaryFile = (typeLabel) => (
    findValidationFileByKeywords(searchDirs, ['03', typeLabel, 'summary']) ||
    findValidationFileByKeywords(searchDirs, [typeLabel, 'correlation', 'summary']) ||
    findValidationFileByKeywords(searchDirs, [typeLabel, 'correlation']) ||
    findValidationFileByKeywords(searchDirs, [typeLabel, 'summary']) ||
    null
  );
  const typeSummaries = {
    POWER: parseValidationTypeSummary(findTypeSummaryFile('power')) || [],
    TECHNICAL: parseValidationTypeSummary(findTypeSummaryFile('technical')) || [],
    BALANCED: parseValidationTypeSummary(findTypeSummaryFile('balanced')) || []
  };
  const weightTemplatesPath =
    findValidationFileByKeywords(searchDirs, ['weight', 'templates']) ||
    findValidationFileByKeywords(searchDirs, ['weight', 'template']) ||
    findValidationFileByKeywords(searchDirs, ['weight_templates']) ||
    null;
  const weightTemplates = parseValidationWeightTemplates(weightTemplatesPath) || { POWER: [], TECHNICAL: [], BALANCED: [] };
  const deltaTrendsPath =
    findValidationFileByKeywords(searchDirs, ['05', 'delta', 'trends']) ||
    findValidationFileByKeywords(searchDirs, ['model', 'delta', 'trends']) ||
    findValidationFileByKeywords(searchDirs, ['delta', 'trends']) ||
    null;
  const deltaTrends = parseValidationDeltaTrends(deltaTrendsPath) || [];

  const courseType = determineValidationCourseType(typeSummaries);
  if (courseType) {
    console.log(`✓ Validation course type selected from summaries: ${courseType}`);
  } else {
    console.log('ℹ️  Validation course type selection unavailable (missing summary CSVs).');
  }

  if (!weightTemplatesPath) {
    console.log('ℹ️  Validation weight templates CSV not found; skipping validation weight constraints.');
  }

  return {
    courseType,
    typeSummaries,
    weightTemplates,
    weightTemplatesPath,
    deltaTrends,
    deltaTrendsPath
  };
}

function findApproachDeltaFile(dirs, tournamentName, fallbackName) {
  const normalized = normalizeTemplateKey(tournamentName || fallbackName);
  const normalizedSlug = normalizeTournamentSlug(tournamentName || fallbackName);
  const candidates = [];
  const stripDateSuffix = (value) => String(value || '')
    .replace(/([_-])\d{4}([_-])\d{2}([_-]\d{2}|-\d{2})$/i, '')
    .replace(/([_-])\d{4}([_-])\d{2}$/i, '')
    .replace(/[_-]+$/g, '');

  (dirs || []).forEach(dir => {
    if (!dir || !fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
      if (!file.toLowerCase().endsWith('.json')) return;
      const lower = file.toLowerCase();
      if (!lower.includes('approach_deltas')) return;
      candidates.push({ file, path: path.resolve(dir, file) });
    });
  });

  if (candidates.length === 0) return null;

  if (normalized) {
    const matches = candidates.filter(candidate => {
      const baseName = candidate.file.replace(/\.json$/i, '').replace(/^approach_deltas?_?/i, '');
      const normalizedFile = normalizeTemplateKey(stripDateSuffix(baseName));
      return normalizedFile.includes(normalized) || normalized.includes(normalizedFile);
    });
    if (matches.length > 0) {
      matches.sort((a, b) => resolveApproachDeltaTimestamp(b.path) - resolveApproachDeltaTimestamp(a.path));
      return matches[0].path;
    }
  }

  if (normalizedSlug) {
    const slugMatches = candidates.filter(candidate => {
      const baseName = candidate.file.replace(/\.json$/i, '').replace(/^approach_deltas?_?/i, '');
      const normalizedFileSlug = normalizeTournamentSlug(stripDateSuffix(baseName));
      if (!normalizedFileSlug) return false;
      return normalizedFileSlug === normalizedSlug
        || normalizedFileSlug.startsWith(`${normalizedSlug}-`)
        || normalizedFileSlug.startsWith(`${normalizedSlug}_`)
        || normalizedSlug.startsWith(`${normalizedFileSlug}-`)
        || normalizedSlug.startsWith(`${normalizedFileSlug}_`)
        || normalizedSlug.includes(normalizedFileSlug);
    });
    if (slugMatches.length > 0) {
      slugMatches.sort((a, b) => resolveApproachDeltaTimestamp(b.path) - resolveApproachDeltaTimestamp(a.path));
      return slugMatches[0].path;
    }
  }

  const hasQuery = Boolean(normalized || normalizedSlug);
  if (hasQuery) return null;
  if (candidates.length === 1) return candidates[0].path;
  candidates.sort((a, b) => a.file.localeCompare(b.file));
  return candidates[0].path;
}

function loadApproachDeltaRows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { meta: null, rows: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(raw)) return { meta: null, rows: raw };
    if (raw && typeof raw === 'object') {
      return { meta: raw.meta || null, rows: Array.isArray(raw.rows) ? raw.rows : [] };
    }
  } catch (error) {
    console.warn(`⚠️  Failed to parse approach delta JSON: ${error.message}`);
  }
  return { meta: null, rows: [] };
}

function listApproachDeltaFiles(dirs) {
  const files = new Set();
  (dirs || []).forEach(dir => {
    if (!dir || !fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
      const lower = file.toLowerCase();
      if (!lower.endsWith('.json')) return;
      if (!lower.includes('approach_deltas')) return;
      files.add(path.resolve(dir, file));
    });
  });
  return Array.from(files);
}

function parseApproachDeltaDateFromFilename(filePath) {
  const baseName = path.basename(filePath || '');
  const match = baseName.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (!match) return NaN;
  const [, year, month, day] = match;
  const iso = `${year}-${month}-${day}T00:00:00Z`;
  return Date.parse(iso);
}

function parseApproachSnapshotDateFromFilename(filePath) {
  const baseName = path.basename(filePath || '');
  const match = baseName.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (!match) return NaN;
  const [, year, month, day] = match;
  const iso = `${year}-${month}-${day}T00:00:00Z`;
  return Date.parse(iso);
}

function resolveApproachDeltaTimestamp(filePath, meta) {
  const metaTime = meta?.generatedAt ? Date.parse(meta.generatedAt) : NaN;
  if (!Number.isNaN(metaTime)) return metaTime;
  const filenameTime = parseApproachDeltaDateFromFilename(filePath);
  if (!Number.isNaN(filenameTime)) return filenameTime;
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (error) {
    return 0;
  }
}

function evaluateApproachDeltaHealth({ filePath, meta, rows }) {
  const timestamp = resolveApproachDeltaTimestamp(filePath, meta);
  if (!timestamp || Number.isNaN(timestamp)) {
    return { ok: false, reason: 'missing_timestamp', sample: null };
  }
  const sampleRow = (rows || []).find(row => row && row.dg_id) || (rows || [])[0] || null;
  const hasPositiveShots = (rows || []).some(row => {
    const value = row?.[APPROACH_DELTA_HEALTH_KEY];
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  });
  if (!hasPositiveShots) {
    return {
      ok: false,
      reason: `missing_positive_${APPROACH_DELTA_HEALTH_KEY}`,
      sample: sampleRow
        ? {
          dgId: sampleRow.dg_id || null,
          playerName: sampleRow.player_name || sampleRow.playerName || null,
          value: sampleRow?.[APPROACH_DELTA_HEALTH_KEY] ?? null
        }
        : null
    };
  }
  return { ok: true, reason: null, sample: null };
}

function logApproachDeltaHealthFailure({ reason, filePath, sample }) {
  console.error('\n❌ Approach delta health check failed.');
  console.error(`   reason: ${reason || 'unknown'}`);
  console.error(`   file: ${filePath || 'n/a'}`);
  if (sample) {
    const playerLabel = sample.playerName ? `${sample.playerName} (${sample.dgId || 'n/a'})` : (sample.dgId || 'n/a');
    console.error(`   samplePlayer: ${playerLabel}`);
    if (sample.value !== null && sample.value !== undefined) {
      console.error(`   sampleValue: ${sample.value}`);
    }
  }
}

function resolveApproachSnapshotSourcePath(source) {
  if (!source) return null;
  if (typeof source !== 'string') return null;
  if (source.startsWith('snapshot:')) {
    const selector = source.slice('snapshot:'.length).trim().toLowerCase();
    const archives = listApproachSnapshotArchives();
    if (selector === 'previous') {
      if (archives.length > 1) return archives[archives.length - 2].path;
      if (archives.length === 1) return archives[0].path;
      return APPROACH_SNAPSHOT_YTD_LATEST_PATH;
    }
    if (selector === 'current') {
      if (archives.length > 0) return archives[archives.length - 1].path;
      return APPROACH_SNAPSHOT_YTD_LATEST_PATH;
    }
    return APPROACH_SNAPSHOT_YTD_LATEST_PATH;
  }
  if (fs.existsSync(source)) return source;
  return null;
}

function resolveApproachSnapshotTimestamp(source) {
  const resolvedPath = resolveApproachSnapshotSourcePath(source);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return null;
  if (!resolvedPath.toLowerCase().endsWith('.json')) {
    try {
      return fs.statSync(resolvedPath).mtimeMs;
    } catch (error) {
      return null;
    }
  }
  const filenameTime = parseApproachSnapshotDateFromFilename(resolvedPath);
  if (!Number.isNaN(filenameTime)) return filenameTime;
  const payload = readJsonFile(resolvedPath);
  if (payload) {
    const lastUpdated = payload.last_updated || payload.lastUpdated || payload?.meta?.generatedAt || payload?.generatedAt || null;
    const parsed = lastUpdated ? Date.parse(String(lastUpdated)) : NaN;
    if (!Number.isNaN(parsed)) return parsed;
  }
  try {
    return fs.statSync(resolvedPath).mtimeMs;
  } catch (error) {
    return null;
  }
}

function buildRollingApproachDeltaRows(entries, metricSpecs, fieldIdSet, maxFiles = APPROACH_DELTA_ROLLING_EVENTS) {
  const filesToUse = entries.slice(0, Math.max(0, maxFiles));
  const accum = new Map();

  filesToUse.forEach(entry => {
    const rows = Array.isArray(entry?.rows) ? entry.rows : [];
    rows.forEach(row => {
      const dgId = String(row?.dg_id || row?.dgId || '').trim();
      if (!dgId) return;
      if (fieldIdSet && !fieldIdSet.has(dgId)) return;
      let target = accum.get(dgId);
      if (!target) {
        target = {
          dg_id: dgId,
          player_name: row?.player_name || row?.playerName || null,
          sums: {},
          counts: {}
        };
        accum.set(dgId, target);
      }
      if (!target.player_name && (row?.player_name || row?.playerName)) {
        target.player_name = row?.player_name || row?.playerName;
      }

      metricSpecs.forEach(spec => {
        const value = row?.[spec.key];
        if (typeof value !== 'number' || Number.isNaN(value)) return;
        target.sums[spec.key] = (target.sums[spec.key] || 0) + value;
        target.counts[spec.key] = (target.counts[spec.key] || 0) + 1;
      });
    });
  });

  const rows = [];
  accum.forEach(entry => {
    const outputRow = {
      dg_id: entry.dg_id,
      player_name: entry.player_name,
      tournament_field: fieldIdSet ? true : null
    };
    metricSpecs.forEach(spec => {
      const count = entry.counts[spec.key] || 0;
      outputRow[spec.key] = count > 0 ? entry.sums[spec.key] / count : null;
    });
    rows.push(outputRow);
  });

  return {
    rows,
    meta: {
      method: 'rolling_average',
      filesUsed: filesToUse.map(entry => entry.path),
      fileCount: filesToUse.length,
      maxFiles
    }
  };
}

function buildApproachDeltaAlignmentFromRollingRows(metricSpecs, rows) {
  const aggregates = new Map();
  (rows || []).forEach(row => {
    metricSpecs.forEach(spec => {
      if (!spec.alignmentLabel) return;
      const rawValue = row?.[spec.key];
      if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) return;
      const adjustedValue = spec.lowerBetter ? -rawValue : rawValue;
      const label = normalizeGeneratedMetricLabel(spec.alignmentLabel);
      const entry = aggregates.get(label) || { sum: 0, count: 0 };
      entry.sum += adjustedValue;
      entry.count += 1;
      aggregates.set(label, entry);
    });
  });

  let maxAbs = 0;
  const map = new Map();
  aggregates.forEach((entry, label) => {
    const mean = entry.count > 0 ? entry.sum / entry.count : 0;
    map.set(label, mean);
    maxAbs = Math.max(maxAbs, Math.abs(mean));
  });

  if (maxAbs > 0) {
    map.forEach((value, label) => {
      map.set(label, value / maxAbs);
    });
  }

  return map;
}

function buildApproachAlignmentMapFromMetricWeights(metricConfig, metricWeights, metricSpecs) {
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return new Map();
  if (!metricWeights) return new Map();
  const targetLabels = new Set(
    (metricSpecs || [])
      .filter(spec => spec?.alignmentLabel)
      .map(spec => normalizeGeneratedMetricLabel(spec.alignmentLabel))
      .filter(Boolean)
  );
  if (targetLabels.size === 0) return new Map();

  const map = new Map();
  metricConfig.groups.forEach(group => {
    (group.metrics || []).forEach(metric => {
      const label = normalizeGeneratedMetricLabel(metric.name);
      if (!targetLabels.has(label)) return;
      const key = `${group.name}::${metric.name}`;
      const weight = metricWeights[key];
      if (typeof weight !== 'number' || Number.isNaN(weight)) return;
      map.set(label, Math.abs(weight));
    });
  });

  return map;
}

function buildApproachDeltaPlayerScores(metricSpecs, deltaRows, alignmentMap) {
  if (!alignmentMap || alignmentMap.size === 0) return [];
  const weightByLabel = new Map();
  alignmentMap.forEach((value, label) => {
    const weight = Math.abs(value || 0);
    if (weight > 0) weightByLabel.set(label, weight);
  });
  if (weightByLabel.size === 0) return [];

  const specs = (metricSpecs || []).filter(spec => spec.alignmentLabel);
  if (specs.length === 0) return [];

  const results = [];
  (deltaRows || []).forEach(row => {
    const dgId = String(row?.dg_id || row?.dgId || '').trim();
    if (!dgId) return;
    let weightedSum = 0;
    let totalWeight = 0;
    let usedMetrics = 0;
    const bucketTotals = {};
    const bucketWeights = {};
    const bucketUsed = {};

    specs.forEach(spec => {
      const label = normalizeGeneratedMetricLabel(spec.alignmentLabel);
      const weight = weightByLabel.get(label) || 0;
      if (!weight) return;
      const rawValue = row?.[spec.key];
      if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) return;
      const adjustedValue = spec.lowerBetter ? -rawValue : rawValue;
      weightedSum += adjustedValue * weight;
      totalWeight += weight;
      usedMetrics += 1;

      if (spec.bucketKey) {
        const key = spec.bucketKey;
        bucketTotals[key] = (bucketTotals[key] || 0) + (adjustedValue * weight);
        bucketWeights[key] = (bucketWeights[key] || 0) + weight;
        bucketUsed[key] = (bucketUsed[key] || 0) + 1;
      }
    });

    if (totalWeight === 0) return;
    const bucketScores = {};
    Object.keys(bucketTotals).forEach(key => {
      const bucketWeight = bucketWeights[key] || 0;
      if (bucketWeight > 0) {
        bucketScores[key] = bucketTotals[key] / bucketWeight;
      }
    });
    results.push({
      dgId,
      playerName: row?.player_name || row?.playerName || null,
      score: weightedSum / totalWeight,
      usedMetrics,
      bucketScores,
      bucketUsedMetrics: bucketUsed
    });
  });

  return results.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function getApproachDeltaFileEntries(dirs, excludePath = null) {
  const normalizedExclude = excludePath ? path.resolve(excludePath) : null;
  const entries = listApproachDeltaFiles(dirs)
    .filter(file => !normalizedExclude || path.resolve(file) !== normalizedExclude)
    .map(file => {
      const data = loadApproachDeltaRows(file);
      return {
        path: file,
        meta: data.meta || null,
        rows: Array.isArray(data.rows) ? data.rows : [],
        time: resolveApproachDeltaTimestamp(file, data.meta)
      };
    })
    .filter(entry => entry.rows.length > 0);

  entries.sort((a, b) => (b.time || 0) - (a.time || 0));
  return entries;
}

function buildApproachDeltaMetricSpecs() {
  const bucketDefs = [
    { bucket: '50_100_fw', labelBase: 'Approach <100', bucketKey: 'short' },
    { bucket: '100_150_fw', labelBase: 'Approach <150 FW', bucketKey: 'mid' },
    { bucket: '150_200_fw', labelBase: 'Approach <200 FW', bucketKey: 'long' },
    { bucket: 'under_150_rgh', labelBase: 'Approach <150 Rough', bucketKey: 'mid' },
    { bucket: 'over_150_rgh', labelBase: 'Approach >150 Rough', bucketKey: 'long' },
    { bucket: 'over_200_fw', labelBase: 'Approach >200 FW', bucketKey: 'veryLong' }
  ];

  const specs = [];
  const addSpec = (key, label, lowerBetter, alignmentLabel = null, bucketKey = null) => {
    specs.push({ key, label, lowerBetter, alignmentLabel, bucketKey });
  };

  bucketDefs.forEach(({ bucket, labelBase, bucketKey }) => {
    addSpec(`delta_${bucket}_gir_rate`, `${labelBase} GIR`, false, `${labelBase} GIR`, bucketKey);
    addSpec(`delta_${bucket}_sg_per_shot`, `${labelBase} SG`, false, `${labelBase} SG`, bucketKey);
    addSpec(`delta_${bucket}_proximity_per_shot`, `${labelBase} Prox`, true, `${labelBase} Prox`, bucketKey);
    addSpec(`delta_${bucket}_good_shot_rate`, `${labelBase} Good Shot Rate`, false, null, bucketKey);
    addSpec(`delta_${bucket}_poor_shot_avoid_rate`, `${labelBase} Poor Shot Avoid Rate`, false, null, bucketKey);
    addSpec(`delta_${bucket}_good_shot_count`, `${labelBase} Good Shot Count`, false, null, bucketKey);
    addSpec(`delta_${bucket}_poor_shot_count`, `${labelBase} Poor Shot Count`, true, null, bucketKey);
    addSpec(`weighted_delta_${bucket}_good_shot_rate`, `${labelBase} Weighted Δ Good Shot Rate`, false, null, bucketKey);
    addSpec(`weighted_delta_${bucket}_poor_shot_avoid_rate`, `${labelBase} Weighted Δ Poor Shot Avoid Rate`, false, null, bucketKey);
  });

  return specs;
}

function computeApproachDeltaCorrelations(deltaRows, results, metricSpecs) {
  const { map: resultsById } = buildFinishPositionMap(results);

  return metricSpecs.map(spec => {
    const xValues = [];
    const yValues = [];
    (deltaRows || []).forEach(row => {
      const dgId = String(row.dg_id || row.dgId || '').trim();
      if (!dgId) return;
      const finishPosition = resultsById.get(dgId);
      if (typeof finishPosition !== 'number' || Number.isNaN(finishPosition)) return;
      const rawValue = row[spec.key];
      if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) return;
      const adjustedValue = spec.lowerBetter ? -rawValue : rawValue;
      xValues.push(adjustedValue);
      yValues.push(-finishPosition);
    });

    if (xValues.length < 5) {
      return { label: spec.label, key: spec.key, correlation: 0, samples: xValues.length, alignmentLabel: spec.alignmentLabel, lowerBetter: spec.lowerBetter };
    }

    return {
      label: spec.label,
      key: spec.key,
      correlation: calculateSpearmanCorrelation(xValues, yValues),
      samples: xValues.length,
      alignmentLabel: spec.alignmentLabel,
      lowerBetter: spec.lowerBetter
    };
  });
}

function buildApproachDeltaAlignmentMap(metricConfig, deltaCorrelations = []) {
  const map = new Map();
  (deltaCorrelations || []).forEach(entry => {
    if (!entry?.alignmentLabel) return;
    if (typeof entry.correlation !== 'number' || Number.isNaN(entry.correlation)) return;
    map.set(normalizeGeneratedMetricLabel(entry.alignmentLabel), entry.correlation);
  });
  return map;
}

function normalizeTemplateKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeDgIdValue(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.split('.')[0].trim();
}

const APPROACH_GROUPS = new Set([
  'Approach - Short (<100)',
  'Approach - Mid (100-150)',
  'Approach - Long (150-200)',
  'Approach - Very Long (>200)'
]);

function removeApproachGroupWeights(groupWeights) {
  const adjusted = { ...groupWeights };
  Object.keys(adjusted).forEach(groupName => {
    if (APPROACH_GROUPS.has(groupName)) {
      adjusted[groupName] = 0;
    }
  });
  return normalizeWeights(adjusted);
}

const HISTORICAL_METRICS = [
  { key: 'scoringAverage', label: 'Scoring Average', lowerBetter: true },
  { key: 'eagles', label: 'Eagles or Better', lowerBetter: false },
  { key: 'birdies', label: 'Birdies', lowerBetter: false },
  { key: 'birdiesOrBetter', label: 'Birdies or Better', lowerBetter: false },
  { key: 'strokesGainedTotal', label: 'SG Total', lowerBetter: false },
  { key: 'drivingDistance', label: 'Driving Distance', lowerBetter: false },
  { key: 'drivingAccuracy', label: 'Driving Accuracy', lowerBetter: false, percentage: true },
  { key: 'strokesGainedT2G', label: 'SG T2G', lowerBetter: false },
  { key: 'strokesGainedApp', label: 'SG Approach', lowerBetter: false },
  { key: 'strokesGainedArg', label: 'SG Around Green', lowerBetter: false },
  { key: 'strokesGainedOTT', label: 'SG OTT', lowerBetter: false },
  { key: 'strokesGainedPutt', label: 'SG Putting', lowerBetter: false },
  { key: 'greensInReg', label: 'GIR', lowerBetter: false, percentage: true },
  { key: 'scrambling', label: 'Scrambling', lowerBetter: false, percentage: true },
  { key: 'greatShots', label: 'Great Shots', lowerBetter: false },
  { key: 'poorShots', label: 'Poor Shots', lowerBetter: true },
  { key: 'fairwayProx', label: 'Fairway Proximity', lowerBetter: true },
  { key: 'roughProx', label: 'Rough Proximity', lowerBetter: true }
];

const GENERATED_METRIC_LABELS = [
  'SG Total',
  'Driving Distance',
  'Driving Accuracy',
  'SG T2G',
  'SG Approach',
  'SG Around Green',
  'SG OTT',
  'SG Putting',
  'Greens in Regulation',
  'Scrambling',
  'Great Shots',
  'Poor Shots',
  'Scoring Average',
  'Birdies or Better',
  'Birdie Chances Created',
  'Fairway Proximity',
  'Rough Proximity',
  'Approach <100 GIR',
  'Approach <100 SG',
  'Approach <100 Prox',
  'Approach <150 FW GIR',
  'Approach <150 FW SG',
  'Approach <150 FW Prox',
  'Approach <150 Rough GIR',
  'Approach <150 Rough SG',
  'Approach <150 Rough Prox',
  'Approach >150 Rough GIR',
  'Approach >150 Rough SG',
  'Approach >150 Rough Prox',
  'Approach <200 FW GIR',
  'Approach <200 FW SG',
  'Approach <200 FW Prox',
  'Approach >200 FW GIR',
  'Approach >200 FW SG',
  'Approach >200 FW Prox'
];

const APPROACH_BUCKET_LABELS = new Set([
  'Approach <100 GIR', 'Approach <100 SG', 'Approach <100 Prox',
  'Approach <150 FW GIR', 'Approach <150 FW SG', 'Approach <150 FW Prox',
  'Approach <150 Rough GIR', 'Approach <150 Rough SG', 'Approach <150 Rough Prox',
  'Approach >150 Rough GIR', 'Approach >150 Rough SG', 'Approach >150 Rough Prox',
  'Approach <200 FW GIR', 'Approach <200 FW SG', 'Approach <200 FW Prox',
  'Approach >200 FW GIR', 'Approach >200 FW SG', 'Approach >200 FW Prox'
]);
let TOP20_METRIC_LABELS = GENERATED_METRIC_LABELS.filter(label => !APPROACH_BUCKET_LABELS.has(label));

const APPROACH_BUCKET_SUFFIXES = [
  'gir_rate',
  'good_shot_rate',
  'poor_shot_avoid_rate',
  'proximity_per_shot',
  'sg_per_shot'
];
const EVENT_ONLY_LOW_DATA_THRESHOLD = 20;

const parseApproachNumber = (value, isPercent = false) => {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[%,$]/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (isPercent) return parsed > 1 ? parsed / 100 : parsed;
  return parsed;
};

const buildApproachIndex = rows => {
  const index = new Map();
  (rows || []).forEach(row => {
    const dgId = row?.dg_id !== undefined && row?.dg_id !== null
      ? String(row.dg_id).split('.')[0].trim()
      : '';
    if (!dgId) return;
    const metrics = {};
    (METRIC_DEFS || []).forEach(def => {
      metrics[def.key] = parseApproachNumber(row?.[def.key], def.isPercent);
    });
    index.set(dgId, { dgId, playerName: row?.player_name || row?.playerName || null, metrics });
  });
  return index;
};

const resolveShotCountKey = metricKey => {
  const suffixMatch = APPROACH_BUCKET_SUFFIXES.find(suffix => metricKey.endsWith(`_${suffix}`));
  if (!suffixMatch) return null;
  return metricKey.replace(new RegExp(`_${suffixMatch}$`), '_shot_count');
};

const computeEventOnlyApproachRows = ({ beforeRows, afterRows }) => {
  const beforeIndex = buildApproachIndex(beforeRows);
  const afterIndex = buildApproachIndex(afterRows);
  const allIds = new Set([...beforeIndex.keys(), ...afterIndex.keys()]);
  const rows = [];
  let playersWithShots = 0;

  allIds.forEach(dgId => {
    const before = beforeIndex.get(dgId);
    const after = afterIndex.get(dgId);
    if (!before && !after) return;

    const row = { dg_id: dgId, player_name: after?.playerName || before?.playerName || null };
    let hasShots = false;

    (METRIC_DEFS || []).forEach(def => {
      const key = def.key;
      const beforeValue = before?.metrics?.[key] ?? null;
      const afterValue = after?.metrics?.[key] ?? null;

      if (key.endsWith('_shot_count')) {
        const deltaShots = (afterValue ?? 0) - (beforeValue ?? 0);
        if (deltaShots > 0) {
          row[key] = deltaShots;
          hasShots = true;
        } else {
          row[key] = null;
        }
        return;
      }

      if (key.endsWith('_low_data_indicator')) {
        const bucket = key.replace('_low_data_indicator', '');
        const shotKey = `${bucket}_shot_count`;
        const beforeShots = before?.metrics?.[shotKey] ?? null;
        const afterShots = after?.metrics?.[shotKey] ?? null;
        const deltaShots = (afterShots ?? 0) - (beforeShots ?? 0);
        const flag = (beforeValue === 1 || afterValue === 1 || (deltaShots > 0 && deltaShots < EVENT_ONLY_LOW_DATA_THRESHOLD)) ? 1 : 0;
        row[key] = flag;
        return;
      }

      const shotCountKey = resolveShotCountKey(key);
      if (!shotCountKey) {
        row[key] = afterValue ?? beforeValue ?? null;
        return;
      }

      const beforeShots = before?.metrics?.[shotCountKey] ?? null;
      const afterShots = after?.metrics?.[shotCountKey] ?? null;
      const deltaShots = (afterShots ?? 0) - (beforeShots ?? 0);
      const hasAfterShots = typeof afterShots === 'number' && Number.isFinite(afterShots) && afterShots > 0;
      const hasBeforeShots = typeof beforeShots === 'number' && Number.isFinite(beforeShots) && beforeShots > 0;
      if (!hasAfterShots || afterValue === null) {
        row[key] = null;
        return;
      }

      if (!hasBeforeShots || beforeValue === null || deltaShots <= 0) {
        row[key] = afterValue;
        hasShots = true;
        return;
      }

      const eventValue = ((afterValue * afterShots) - (beforeValue * beforeShots)) / deltaShots;
      row[key] = Number.isFinite(eventValue) ? eventValue : null;
      if (deltaShots > 0) hasShots = true;
    });

    if (hasShots) {
      playersWithShots += 1;
      rows.push(row);
    }
  });

  return { rows, playersWithShots };
};

const SHEET_LIKE_METRIC_LABELS = GENERATED_METRIC_LABELS;
const SHEET_LIKE_PERCENTAGE_INDICES = new Set([
  2,  // Driving Accuracy
  8,  // Greens in Regulation
  9,  // Scrambling
  17, // Approach <100 GIR
  20, // Approach <150 FW GIR
  23, // Approach <150 Rough GIR
  26, // Approach >150 Rough GIR
  29, // Approach <200 FW GIR
  32  // Approach >200 FW GIR
]);

function formatSheetMetricValue(value, index) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0.000';
  if (SHEET_LIKE_PERCENTAGE_INDICES.has(index)) {
    const pctValue = value <= 1.5 ? value * 100 : value;
    return `${pctValue.toFixed(2)}%`;
  }
  return Number(value.toFixed(3)).toFixed(3);
}

function generateSheetLikePlayerNotes(player, groups, groupStats) {
  const notes = [];

  if (player.war >= 1.0) {
    notes.push('⭐ Elite performer');
  } else if (player.war >= 0.5) {
    notes.push('↑ Above average');
  } else if (player.war <= -0.5) {
    notes.push('↓ Below field average');
  }

  const allMetrics = [];
  groups.forEach(group => {
    group.metrics.forEach(metric => {
      allMetrics.push({
        name: metric.name,
        index: metric.index,
        weight: metric.weight,
        group: group.name
      });
    });
  });

  const keyMetrics = allMetrics
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const strengths = [];
  const weaknesses = [];

  keyMetrics.forEach(metric => {
    if (!player.metrics || !player.metrics[metric.index] ||
        !groupStats || !groupStats[metric.group] ||
        !groupStats[metric.group][metric.name]) {
      return;
    }

    const playerValue = player.metrics[metric.index];
    const mean = groupStats[metric.group][metric.name].mean;
    const stdDev = groupStats[metric.group][metric.name].stdDev;
    const zScore = (playerValue - mean) / (stdDev || 0.001);

    const isNegativeMetric = metric.name.includes('Poor') ||
      metric.name.includes('Scoring Average') ||
      metric.name.includes('Prox');

    const adjustedZScore = isNegativeMetric ? -zScore : zScore;

    const displayName = metric.name
      .replace('strokesGained', 'SG')
      .replace('drivingDistance', 'Distance')
      .replace('drivingAccuracy', 'Accuracy')
      .replace('greensInReg', 'GIR')
      .replace('birdiesOrBetter', 'Birdies');

    if (adjustedZScore >= 0.75) {
      strengths.push({
        name: displayName,
        score: adjustedZScore,
        weight: metric.weight
      });
    } else if (adjustedZScore <= -0.75) {
      weaknesses.push({
        name: displayName,
        score: adjustedZScore,
        weight: metric.weight
      });
    }
  });

  strengths.sort((a, b) => (b.score * b.weight) - (a.score * a.weight));

  if (strengths.length > 0) {
    const strengthsText = strengths.slice(0, 2).map(s => s.name).join(', ');
    notes.push(`💪 ${strengthsText}`);
  }

  const totalKeyWeight = keyMetrics.reduce((sum, m) => sum + m.weight, 0);
  const playerStrengthWeight = strengths.reduce((sum, s) => {
    const matchingKeyMetric = keyMetrics.find(km => km.name.includes(s.name) || s.name.includes(km.name));
    return sum + (matchingKeyMetric ? matchingKeyMetric.weight : 0);
  }, 0);

  const fitPercentage = totalKeyWeight > 0 ? (playerStrengthWeight / totalKeyWeight) * 100 : 0;

  let hasStrongFitNote = false;
  let hasPoorFitNote = false;
  if (fitPercentage >= 50) {
    notes.push('✅ Strong course fit');
    hasStrongFitNote = true;
  } else if (fitPercentage >= 25) {
    notes.push('👍 Good course fit');
  } else if (weaknesses.length > 0 && weaknesses.some(w => w.weight > 0.1)) {
    notes.push('⚠️ Poor course fit');
    hasPoorFitNote = true;
  }

  const bucketSigMatch = player.deltaNote ? player.deltaNote.match(/BucketSig\s+([↑↓])\s+z=([\-\d.]+)/) : null;
  if (bucketSigMatch) {
    const bucketArrow = bucketSigMatch[1];
    const bucketZ = parseFloat(bucketSigMatch[2]);
    if (hasPoorFitNote && (bucketArrow === '↑' || bucketZ >= 0.75)) {
      notes.push('ℹ️ Recent bucket trend strong (short-term) despite poor baseline fit');
    } else if (hasStrongFitNote && (bucketArrow === '↓' || bucketZ <= -0.75)) {
      notes.push('ℹ️ Recent bucket trend weak (short-term) despite strong baseline fit');
    }
  }

  const trendMetricNames = [
    'Total game', 'Driving', 'Accuracy', 'Tee-to-green',
    'Approach', 'Around green', 'Off tee', 'Putting',
    'GIR', 'Scrambling', 'Great shots', 'Poor shots',
    'Scoring', 'Birdies'
  ];

  let strongestTrend = null;
  let strongestValue = 0;

  player.trends?.forEach((trend, i) => {
    if (Math.abs(trend) > Math.abs(strongestValue)) {
      strongestValue = trend;
      strongestTrend = { metric: i, value: trend };
    }
  });

  if (strongestTrend && Math.abs(strongestTrend.value) > 0.1) {
    const trendDirection = strongestTrend.value > 0 ? '↑' : '↓';
    const metricName = trendMetricNames[strongestTrend.metric] || 'Overall';
    notes.push(`${trendDirection} ${metricName}`);
  }

  if (player.dataCoverage < 0.75) {
    notes.push(`⚠️ Limited data (${Math.round(player.dataCoverage * 100)}%)`);
  }

  if (player.roundsCount && player.roundsCount < 10) {
    notes.push(`📊 Only ${player.roundsCount} rounds`);
  }

  if (APPROACH_DELTA_ROLLING_RED_FLAG_NOTE) {
    notes.push(APPROACH_DELTA_ROLLING_RED_FLAG_NOTE);
  }

  if (player.deltaNote) {
    notes.push(player.deltaNote);
  }

  const formatWaveLabel = wave => {
    if (!wave) return null;
    const normalized = String(wave).trim().toLowerCase();
    if (normalized === 'early') return 'AM';
    if (normalized === 'late') return 'PM';
    return normalized.toUpperCase();
  };

  const formatWaveWord = wave => {
    if (!wave) return null;
    const normalized = String(wave).trim().toLowerCase();
    if (normalized === 'early') return 'Early';
    if (normalized === 'late') return 'Late';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const waveParts = [];
  const round1Label = formatWaveLabel(player.waveRound1);
  const round2Label = formatWaveLabel(player.waveRound2);
  if (round1Label) waveParts.push(`R1 ${round1Label}`);
  if (round2Label) waveParts.push(`R2 ${round2Label}`);

  const round1Word = formatWaveWord(player.waveRound1);
  const round2Word = formatWaveWord(player.waveRound2);
  const wavePair = (round1Word && round2Word) ? `${round1Word}/${round2Word}` : null;
  const penaltyValue = Number.isFinite(player.weatherWavePenalty)
    ? player.weatherWavePenalty
    : null;
  if (wavePair || waveParts.length > 0) {
    const waveLabel = wavePair || waveParts.join(', ');
    const r1Value = Number.isFinite(player.weatherWavePenaltyR1)
      ? player.weatherWavePenaltyR1
      : null;
    const r2Value = Number.isFinite(player.weatherWavePenaltyR2)
      ? player.weatherWavePenaltyR2
      : null;
    const formatWaveValue = value => (
      value === null || value === 0
        ? null
        : `${value > 0 ? 'penalty' : 'boost'}=${Math.abs(value).toFixed(2)}`
    );
    const r1Suffix = formatWaveValue(r1Value);
    const r2Suffix = formatWaveValue(r2Value);
    const totalSuffix = formatWaveValue(penaltyValue);
    const detailParts = [];
    if (r1Suffix) detailParts.push(`R1 ${r1Suffix}`);
    if (r2Suffix) detailParts.push(`R2 ${r2Suffix}`);
    if (totalSuffix) detailParts.push(`Net ${totalSuffix}`);
    const valueSuffix = detailParts.length > 0 ? ` (${detailParts.join(', ')})` : '';
    notes.push(`Wave / ⛈️: ${waveLabel}${valueSuffix}`);
  }

  return notes.join(' | ');
}

function buildPerformanceNotes({ finishPosition, modelRank, actualTrends, approachDeltaRow, actualMetrics, modelMetrics }) {
  const notes = [];
  const getCategoryForMetric = metricName => {
    if (!metricName) return '';
    const metricLower = String(metricName).toLowerCase();
    if (metricLower.includes('ott') || metricLower.includes('driving')) return 'Driving';
    if (metricLower.includes('approach') || metricLower.includes('iron')) return 'Approach';
    if (metricLower.includes('around') || metricLower.includes('arg') || metricLower.includes('short game')) return 'Short Game';
    if (metricLower.includes('putting') || metricLower.includes('putt')) return 'Putting';
    if (metricLower.includes('total') || metricLower.includes('t2g')) return 'Overall';
    if (metricLower.includes('gir') || metricLower.includes('greens')) return 'Approach';
    if (metricLower.includes('proximity') || metricLower.includes('prox')) return 'Approach';
    return '';
  };
  if (Number.isFinite(finishPosition) && Number.isFinite(modelRank)) {
    const diff = modelRank - finishPosition;
    if (diff >= 10) {
      notes.push(`✅ Beat model by ${diff}`);
    } else if (diff <= -10) {
      notes.push(`⚠️ Missed model by ${Math.abs(diff)}`);
    } else if (Math.abs(diff) >= 3) {
      notes.push(`≈ Near model (${diff >= 0 ? '+' : ''}${diff})`);
    }
  }

  if (Number.isFinite(finishPosition) && Number.isFinite(modelRank)) {
    const performedWell = finishPosition <= 20;
    const predictedWell = modelRank <= 20;
    if (performedWell && predictedWell) {
      notes.push('✅ Success aligned with model');
    } else if (performedWell && !predictedWell) {
      notes.push('⚠️ Success despite model prediction');
    } else if (!performedWell && predictedWell) {
      notes.push('❌ Underperformed model prediction');
    }
  }

  if (Array.isArray(actualMetrics) && Array.isArray(modelMetrics)) {
    const labelIndexMap = new Map(GENERATED_METRIC_LABELS.map((label, index) => [label, index]));
    const comparableLabels = [
      'SG Total', 'SG T2G', 'SG Approach', 'SG Around Green', 'SG OTT', 'SG Putting',
      'Driving Distance', 'Driving Accuracy', 'Greens in Regulation',
      'Fairway Proximity', 'Rough Proximity'
    ];
    const deltas = [];
    comparableLabels.forEach(label => {
      const idx = labelIndexMap.get(label);
      if (typeof idx !== 'number') return;
      const actual = actualMetrics[idx];
      const model = modelMetrics[idx];
      if (typeof actual !== 'number' || Number.isNaN(actual)) return;
      if (typeof model !== 'number' || Number.isNaN(model)) return;
      const diff = actual - model;
      deltas.push({ label, diff, actual, model });
    });

    deltas.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    deltas.slice(0, 4).forEach(entry => {
      const lowerBetter = LOWER_BETTER_GENERATED_METRICS.has(entry.label);
      const better = lowerBetter ? entry.diff < 0 : entry.diff > 0;
      const isPercent = SHEET_LIKE_PERCENTAGE_INDICES.has(labelIndexMap.get(entry.label));
      const diffDisplay = isPercent
        ? `${(entry.diff * 100).toFixed(2)}%`
        : entry.label.includes('SG')
          ? entry.diff.toFixed(3)
          : entry.diff.toFixed(2);
      const prefix = better ? '✅' : '⚠️';
      notes.push(`${prefix} ${entry.label} ${better ? 'beat' : 'missed'} model (${diffDisplay})`);
    });
  }

  if (Array.isArray(actualTrends) && actualTrends.length > 0 && Array.isArray(actualMetrics)) {
    const labelIndexMap = new Map(GENERATED_METRIC_LABELS.map((label, index) => [label, index]));
    const trendMetricLabels = [
      'SG Total', 'Driving Distance', 'Driving Accuracy', 'SG T2G',
      'SG Approach', 'SG Around Green', 'SG OTT', 'SG Putting',
      'Greens in Regulation', 'Scrambling', 'Great Shots', 'Poor Shots',
      'Scoring Average', 'Birdies or Better', 'Fairway Proximity', 'Rough Proximity'
    ];

    const trendAnalysis = [];
    actualTrends.forEach((trendValue, trendIndex) => {
      if (typeof trendValue !== 'number' || Number.isNaN(trendValue)) return;
      if (Math.abs(trendValue) <= 0.05) return;
      const metricLabel = trendMetricLabels[trendIndex];
      if (!metricLabel) return;
      const metricIdx = labelIndexMap.get(metricLabel);
      if (typeof metricIdx !== 'number') return;

      const currentValue = actualMetrics[metricIdx];
      if (typeof currentValue !== 'number' || Number.isNaN(currentValue)) return;

      const isHigherBetter = !LOWER_BETTER_GENERATED_METRICS.has(metricLabel);
      const isPositiveTrend = trendValue > 0;

      let isGoodPerformance;
      if (metricLabel.includes('SG')) {
        isGoodPerformance = isHigherBetter ? currentValue > 0 : currentValue < 0;
      } else if (Array.isArray(modelMetrics)) {
        const modelValue = modelMetrics[metricIdx];
        if (typeof modelValue === 'number' && Number.isFinite(modelValue)) {
          isGoodPerformance = isHigherBetter ? currentValue > modelValue : currentValue < modelValue;
        } else {
          isGoodPerformance = isHigherBetter ? currentValue > 0 : currentValue < 0;
        }
      } else {
        isGoodPerformance = isHigherBetter ? currentValue > 0 : currentValue < 0;
      }

      const isCorrelationConfirmed = (isPositiveTrend && isGoodPerformance)
        || (!isPositiveTrend && !isGoodPerformance);
      const significanceScore = Math.abs(trendValue) * (isCorrelationConfirmed ? 2 : 1);

      trendAnalysis.push({
        metric: metricLabel,
        trendValue,
        trendDirection: isPositiveTrend ? 'improving' : 'declining',
        correlation: isCorrelationConfirmed ? 'confirmed' : 'contradicted',
        significance: significanceScore
      });
    });

    trendAnalysis.sort((a, b) => b.significance - a.significance);
    if (trendAnalysis.length > 0) {
      const trendsToShow = Math.min(trendAnalysis.length, 3);
      const primaryTrend = trendAnalysis[0];
      const category = getCategoryForMetric(primaryTrend.metric);
      if (category) {
        const directionArrow = primaryTrend.trendDirection === 'improving' ? '↑' : '↓';
        notes.push(`${directionArrow} ${category}`);
      }
      for (let t = 0; t < trendsToShow; t++) {
        const trend = trendAnalysis[t];
        const trendEmoji = trend.trendDirection === 'improving' ? '📈' : '📉';
        const trendDisplay = Math.abs(trend.trendValue).toFixed(3);
        const trendNote = `${trendEmoji} ${trend.metric}: ${trend.correlation === 'confirmed' ? 'trend continuing' : 'trend reversing'} (${trendDisplay})`;
        notes.push(trendNote);
      }
    }
  }

  const trendMetricNames = [
    'Total game', 'Driving', 'Accuracy', 'Tee-to-green',
    'Approach', 'Around green', 'Off tee', 'Putting',
    'GIR', 'Scrambling', 'Great shots', 'Poor shots',
    'Scoring', 'Birdies', 'Fairway Prox', 'Rough Prox'
  ];
  if (Array.isArray(actualTrends) && actualTrends.length > 0) {
    let strongest = null;
    actualTrends.forEach((value, index) => {
      if (typeof value !== 'number' || Number.isNaN(value)) return;
      if (!strongest || Math.abs(value) > Math.abs(strongest.value)) {
        strongest = { index, value };
      }
    });
    if (strongest && Math.abs(strongest.value) >= 0.01) {
      const arrow = strongest.value > 0 ? '↑' : '↓';
      const metricName = trendMetricNames[strongest.index] || 'Trend';
      notes.push(`${arrow} ${metricName}`);
    }
  }

  if (approachDeltaRow && typeof approachDeltaRow === 'object') {
    const deltaCandidates = Object.entries(approachDeltaRow)
      .filter(([key, value]) => key.includes('_sg_per_shot') && typeof value === 'number' && Number.isFinite(value))
      .map(([key, value]) => ({ key, value }));
    if (deltaCandidates.length > 0) {
      deltaCandidates.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      const best = deltaCandidates[0];
      if (best && Math.abs(best.value) >= 0.05) {
        const arrow = best.value > 0 ? '↑' : '↓';
        const label = best.key
          .replace(/^delta_/, '')
          .replace(/_sg_per_shot$/, '')
          .replace(/_/g, ' ');
        notes.push(`Δ Approach ${arrow} ${label}`);
      }
    }
  }

  return notes.join(' | ');
}

function buildActualMetricsFromHistory(rows, eventId, season) {
  const eventKey = String(eventId || '').trim();
  const seasonKey = String(season || '').trim();
  const sums = new Map();
  const counts = new Map();

  const metricLabels = GENERATED_METRIC_LABELS.slice(0, 17);
  const labelToValue = (label, row) => {
    switch (label) {
      case 'SG Total':
        return cleanMetricValue(row.sg_total);
      case 'Driving Distance':
        return cleanMetricValue(row.driving_dist);
      case 'Driving Accuracy':
        return cleanMetricValue(row.driving_acc, true);
      case 'SG T2G':
        return cleanMetricValue(row.sg_t2g);
      case 'SG Approach':
        return cleanMetricValue(row.sg_app);
      case 'SG Around Green':
        return cleanMetricValue(row.sg_arg);
      case 'SG OTT':
        return cleanMetricValue(row.sg_ott);
      case 'SG Putting':
        return cleanMetricValue(row.sg_putt);
      case 'Greens in Regulation':
        return cleanMetricValue(row.gir, true);
      case 'Scrambling':
        return cleanMetricValue(row.scrambling, true);
      case 'Great Shots':
        return cleanMetricValue(row.great_shots);
      case 'Poor Shots':
        return cleanMetricValue(row.poor_shots);
      case 'Scoring Average':
        return cleanMetricValue(row.score);
      case 'Birdies or Better':
        return deriveBirdiesOrBetterFromRow(row);
      case 'Birdie Chances Created':
        return null;
      case 'Fairway Proximity':
        return cleanMetricValue(row.prox_fw);
      case 'Rough Proximity':
        return cleanMetricValue(row.prox_rgh);
      default:
        return null;
    }
  };

  (rows || []).forEach(row => {
    const rowEvent = String(row?.event_id || '').trim();
    if (eventKey && rowEvent !== eventKey) return;
    const rowSeason = String(row?.season || row?.year || '').trim();
    if (seasonKey && rowSeason !== seasonKey) return;
    const dgId = String(row?.dg_id || '').trim();
    if (!dgId) return;

    metricLabels.forEach((label, index) => {
      const value = labelToValue(label, row);
      if (typeof value !== 'number' || Number.isNaN(value)) return;
      const key = `${dgId}::${index}`;
      sums.set(key, (sums.get(key) || 0) + value);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });

  const metricsById = new Map();
  sums.forEach((sum, key) => {
    const [dgId, index] = key.split('::');
    const count = counts.get(key) || 0;
    if (!metricsById.has(dgId)) metricsById.set(dgId, Array(35).fill(null));
    const metrics = metricsById.get(dgId);
    const idx = parseInt(index, 10);
    if (!Number.isNaN(idx) && count > 0) {
      metrics[idx] = sum / count;
    }
  });

  return metricsById;
}

function buildActualTrendsFromHistory(rows, eventId, season) {
  const eventKey = String(eventId || '').trim();
  const seasonKey = String(season || '').trim();
  const roundsByPlayer = new Map();

  (rows || []).forEach(row => {
    const rowEvent = String(row?.event_id || '').trim();
    if (eventKey && rowEvent !== eventKey) return;
    const rowSeason = String(row?.season || row?.year || '').trim();
    if (seasonKey && rowSeason !== seasonKey) return;
    const dgId = String(row?.dg_id || '').trim();
    if (!dgId) return;

    const date = row?.date || row?.round_date || row?.start_date || row?.end_date || row?.event_completed || null;
    const roundNum = Number(row?.round_num || row?.round || row?.roundNum || 0);
    const entry = {
      date: date || `${rowSeason}-01-01`,
      roundNum: Number.isFinite(roundNum) ? roundNum : 0,
      metrics: {
        scoringAverage: cleanMetricValue(row.score),
        eagles: cleanMetricValue(row.eagles_or_better),
        birdies: cleanMetricValue(row.birdies),
        birdiesOrBetter: deriveBirdiesOrBetterFromRow(row),
        strokesGainedTotal: cleanMetricValue(row.sg_total),
        drivingDistance: cleanMetricValue(row.driving_dist),
        drivingAccuracy: cleanMetricValue(row.driving_acc, true),
        strokesGainedT2G: cleanMetricValue(row.sg_t2g),
        strokesGainedApp: cleanMetricValue(row.sg_app),
        strokesGainedArg: cleanMetricValue(row.sg_arg),
        strokesGainedOTT: cleanMetricValue(row.sg_ott),
        strokesGainedPutt: cleanMetricValue(row.sg_putt),
        greensInReg: cleanMetricValue(row.gir, true),
        scrambling: cleanMetricValue(row.scrambling, true),
        greatShots: cleanMetricValue(row.great_shots),
        poorShots: cleanMetricValue(row.poor_shots),
        fairwayProx: cleanMetricValue(row.prox_fw),
        roughProx: cleanMetricValue(row.prox_rgh)
      }
    };

    if (!roundsByPlayer.has(dgId)) roundsByPlayer.set(dgId, []);
    roundsByPlayer.get(dgId).push(entry);
  });

  const trendsById = new Map();
  roundsByPlayer.forEach((rounds, dgId) => {
    trendsById.set(dgId, calculateMetricTrends(rounds));
  });

  return trendsById;
}

function buildApproachDeltaMap(rows = []) {
  const map = new Map();
  (rows || []).forEach(row => {
    const dgId = String(row?.dg_id || row?.dgId || '').trim();
    if (!dgId) return;
    map.set(dgId, row);
  });
  return map;
}

function buildResultsMetricSpecs() {
  const excludedMetrics = new Set([
    'Birdies or Better',
    'Birdie Chances Created'
  ]);
  return GENERATED_METRIC_LABELS
    .map((label, index) => ({ label, index }))
    .filter(spec => !excludedMetrics.has(spec.label));
}

function parseRankingCsvModelValues(filePath, metricSpecs) {
  if (!filePath || !fs.existsSync(filePath)) return new Map();
  const rows = parseCsvRows(filePath);
  if (!rows.length) return new Map();

  let headerIndex = -1;
  let headerRow = null;
  rows.forEach((row, idx) => {
    if (headerIndex !== -1) return;
    const cells = row.map(cell => String(cell || '').trim());
    const dgIndex = cells.findIndex(cell => cell.toLowerCase() === 'dg id');
    if (dgIndex !== -1) {
      headerIndex = idx;
      headerRow = cells;
    }
  });

  if (headerIndex === -1 || !headerRow) return new Map();

  const headerMap = new Map();
  headerRow.forEach((cell, idx) => {
    if (!cell) return;
    headerMap.set(cell, idx);
  });

  const dgIdIdx = headerMap.get('DG ID');
  if (typeof dgIdIdx !== 'number') return new Map();
  const nameIdx = headerMap.get('Player Name');
  const rankIdx = headerMap.get('Rank');

  const metricColumns = (metricSpecs || [])
    .map(spec => ({ spec, idx: headerMap.get(spec.label) }))
    .filter(entry => typeof entry.idx === 'number');

  const map = new Map();
  rows.slice(headerIndex + 1).forEach(row => {
    const dgIdRaw = row[dgIdIdx];
    if (dgIdRaw === undefined || dgIdRaw === null || String(dgIdRaw).trim() === '') return;
    const dgId = String(dgIdRaw).trim();
    if (!dgId) return;

    const playerName = typeof nameIdx === 'number' ? String(row[nameIdx] || '').trim() : '';
    const rankRaw = typeof rankIdx === 'number' ? String(row[rankIdx] || '').trim() : '';
    const rank = rankRaw ? Number(rankRaw.replace(/[^0-9.-]/g, '')) : NaN;

    const metrics = Array(GENERATED_METRIC_LABELS.length).fill(null);
    metricColumns.forEach(({ spec, idx }) => {
      const rawValue = row[idx];
      const isPercent = SHEET_LIKE_PERCENTAGE_INDICES.has(spec.index);
      const parsed = parseApproachNumber(rawValue, isPercent);
      if (typeof parsed === 'number' && Number.isFinite(parsed)) {
        metrics[spec.index] = parsed;
      }
    });

    map.set(dgId, {
      dgId,
      name: playerName || null,
      rank: Number.isFinite(rank) ? rank : null,
      metrics
    });
  });

  return map;
}

function buildPostEventResultsCsv({
  rankingsById,
  resultsById,
  actualMetricsById,
  actualTrendsById,
  approachDeltaById
}) {
  const resultMetricSpecs = buildResultsMetricSpecs();
  const metricHeaders = resultMetricSpecs.map(spec => spec.label);

  const headers = [
    'Performance Notes',
    'DG ID',
    'Player Name',
    'Finish Position',
    'Model Rank',
    ...metricHeaders.flatMap(label => [`${label} (Actual)`, `${label} (Model)`])
  ];

  const approachDeltaSpecs = buildApproachDeltaMetricSpecs();
  const approachLabelToKey = approachDeltaSpecs.reduce((acc, spec) => {
    acc[spec.label] = spec.key;
    return acc;
  }, {});
  const resolveApproachActualValue = (label, row) => {
    if (!label || !row) return null;
    const deltaKey = approachLabelToKey[label];
    if (!deltaKey) return null;
    if (deltaKey.startsWith('delta_')) {
      const suffix = deltaKey.slice('delta_'.length);
      const currentKey = `curr_${suffix}`;
      const previousKey = `prev_${suffix}`;
      const currentValue = row?.[currentKey];
      const previousValue = row?.[previousKey];

      const shotSuffixes = ['gir_rate', 'sg_per_shot', 'proximity_per_shot'];
      const isPerShotMetric = shotSuffixes.some(suffixKey => suffix.endsWith(suffixKey));
      if (isPerShotMetric) {
        const baseSuffix = suffix
          .replace(/gir_rate$/, 'shot_count')
          .replace(/sg_per_shot$/, 'shot_count')
          .replace(/proximity_per_shot$/, 'shot_count');
        const prevCount = row?.[`prev_${baseSuffix}`];
        const currCount = row?.[`curr_${baseSuffix}`];
        if (
          typeof currentValue === 'number'
          && Number.isFinite(currentValue)
          && typeof previousValue === 'number'
          && Number.isFinite(previousValue)
          && typeof prevCount === 'number'
          && Number.isFinite(prevCount)
          && typeof currCount === 'number'
          && Number.isFinite(currCount)
        ) {
          const deltaShots = currCount - prevCount;
          if (deltaShots > 0) {
            const impliedTotal = (currentValue * currCount) - (previousValue * prevCount);
            const impliedValue = impliedTotal / deltaShots;
            if (Number.isFinite(impliedValue)) {
              if (suffix.endsWith('gir_rate')) {
                return Math.min(1, Math.max(0, impliedValue));
              }
              return impliedValue;
            }
          }
        }
      }

      if (typeof currentValue === 'number' && Number.isFinite(currentValue)) return currentValue;
      return null;
    }
    const fallbackValue = row?.[deltaKey];
    return (typeof fallbackValue === 'number' && Number.isFinite(fallbackValue)) ? fallbackValue : null;
  };

  const allIds = new Set([
    ...Array.from(rankingsById.keys()),
    ...Array.from(resultsById.keys())
  ]);
  const orderedIds = Array.from(allIds).sort((a, b) => {
    const rankA = resultsById.get(a);
    const rankB = resultsById.get(b);
    const hasRankA = Number.isFinite(rankA);
    const hasRankB = Number.isFinite(rankB);
    if (hasRankA && hasRankB) return rankA - rankB;
    if (hasRankA) return -1;
    if (hasRankB) return 1;
    const modelA = rankingsById.get(a)?.rank;
    const modelB = rankingsById.get(b)?.rank;
    const hasModelA = Number.isFinite(modelA);
    const hasModelB = Number.isFinite(modelB);
    if (hasModelA && hasModelB) return modelA - modelB;
    if (hasModelA) return -1;
    if (hasModelB) return 1;
    return Number(a) - Number(b);
  });

  const blankRow = Array(headers.length).fill('');
  const rows = [blankRow, blankRow, blankRow, blankRow, headers];

  orderedIds.forEach(dgId => {
    const model = rankingsById.get(dgId) || null;
    const finishPosition = resultsById.get(dgId) ?? null;
    const actualMetrics = actualMetricsById.get(dgId) || Array(35).fill(null);
    const actualTrends = actualTrendsById.get(dgId) || [];
    const approachDeltaRow = approachDeltaById.get(dgId) || null;

    const performanceNotes = buildPerformanceNotes({
      finishPosition,
      modelRank: model?.rank ?? null,
      actualTrends,
      approachDeltaRow,
      actualMetrics,
      modelMetrics: Array.isArray(model?.metrics) ? model.metrics : null
    });

    const playerName = model?.name || approachDeltaRow?.player_name || null;
    const actualRank = Number.isFinite(finishPosition) ? finishPosition : '';
    const modelRank = model?.rank ?? '';

    const baseValues = [actualRank, modelRank];

    resultMetricSpecs.forEach(spec => {
      const { label, index: idx } = spec;
      let actualValue = null;
      if (idx < 17) {
        actualValue = actualMetrics[idx];
      } else {
        actualValue = resolveApproachActualValue(label, approachDeltaRow);
      }

      const modelValue = Array.isArray(model?.metrics) ? model.metrics[idx] : null;
      const formattedActual = typeof actualValue === 'number' && Number.isFinite(actualValue)
        ? formatSheetMetricValue(actualValue, idx)
        : '';
      const formattedModel = typeof modelValue === 'number' && Number.isFinite(modelValue)
        ? formatSheetMetricValue(modelValue, idx)
        : '';
      baseValues.push(formattedActual, formattedModel);
    });

    rows.push([
      performanceNotes || '',
      dgId,
      playerName || '',
      ...baseValues
    ]);
  });

  return rows.map(row => row.map(value => JSON.stringify(value ?? '')).join(',')).join('\n');
}

function buildSheetLikeRankingCsv(ranking, groups) {
  const players = Array.isArray(ranking?.players) ? ranking.players : [];
  const groupStats = ranking?.groupStats || {};
  const metricLabels = SHEET_LIKE_METRIC_LABELS;

  const computeMedian = (values) => {
    const filtered = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
    if (!filtered.length) return null;
    const mid = Math.floor(filtered.length / 2);
    if (filtered.length % 2 === 0) {
      return (filtered[mid - 1] + filtered[mid]) / 2;
    }
    return filtered[mid];
  };

  const deltaTrendMedian = computeMedian(players.map(player => player.deltaTrendScore));
  const deltaPredictiveMedian = computeMedian(players.map(player => player.deltaPredictiveScore));
  const deltaTrendHeader = `Delta Trend Score (median=${deltaTrendMedian === null ? 'n/a' : deltaTrendMedian.toFixed(3)})`;
  const deltaPredictiveHeader = `Delta Predictive Score (median=${deltaPredictiveMedian === null ? 'n/a' : deltaPredictiveMedian.toFixed(3)})`;

  if (metricLabels.length !== 35) {
    throw new Error('Invalid metric labels for sheet-like CSV');
  }

  const headers = [
    'Expected Peformance Notes',
    'Rank', 'DG ID', 'Player Name', 'Top 5', 'Top 10', 'Weighted Score', 'Past Perf. Mult.',
    ...metricLabels.slice(0, 17).flatMap(m => [m, `${m} Trend`]),
    ...metricLabels.slice(17),
    'Refined Weighted Score',
    'WAR',
    deltaTrendHeader,
    deltaPredictiveHeader
  ];

  const rows = [];
  const blankRow = Array(headers.length).fill('');

  // Add a dedicated median row for quick filtering/benchmarking in Sheets.
  // NOTE: Leave DG ID blank so downstream parsers (validationRunner) skip this row.
  const medianHistoricalMetrics = metricLabels.slice(0, 17).map((_, idx) => {
    const median = computeMedian(players.map(player => player.metrics?.[idx]));
    return median === null ? '' : formatSheetMetricValue(median, idx);
  });

  // Historical trends align with the same mapping used in the player rows.
  // idx === 14 is a reserved/blank trend slot in the existing export logic.
  const medianHistoricalTrends = metricLabels.slice(0, 17).map((_, idx) => {
    if (idx === 14) return '0.000';
    const trendIdx = idx < 14 ? idx : idx - 1;
    const median = computeMedian(players.map(player => player.trends?.[trendIdx]));
    return median === null ? '' : Number(median.toFixed(3)).toFixed(3);
  });

  const medianApproach = metricLabels.slice(17).map((_, idx) => {
    const metricIdx = idx + 17;
    const median = computeMedian(players.map(player => player.metrics?.[metricIdx]));
    return median === null ? '' : formatSheetMetricValue(median, metricIdx);
  });

  const refinedWeightedScoreMedian = computeMedian(players.map(player => player.refinedWeightedScore));
  const warMedian = computeMedian(players.map(player => player.war));
  const deltaTrendMedianValue = computeMedian(players.map(player => player.deltaTrendScore));
  const deltaPredMedianValue = computeMedian(players.map(player => player.deltaPredictiveScore));

  const medianTrailingValues = [
    refinedWeightedScoreMedian === null ? '' : Number(refinedWeightedScoreMedian.toFixed(2)).toFixed(2),
    warMedian === null ? '' : Number(warMedian.toFixed(2)).toFixed(2),
    deltaTrendMedianValue === null ? '' : Number(deltaTrendMedianValue.toFixed(3)).toFixed(3),
    deltaPredMedianValue === null ? '' : Number(deltaPredMedianValue.toFixed(3)).toFixed(3)
  ];

  const medianRow = [
    'MEDIAN',
    '', // Rank
    '', // DG ID (blank so parsers skip)
    '', // Player Name
    '', // Top 5
    '', // Top 10
    '', // Weighted Score
    '', // Past Perf. Mult.
    ...medianHistoricalMetrics.flatMap((metricVal, idx) => [metricVal, medianHistoricalTrends[idx]]),
    ...medianApproach,
    ...medianTrailingValues
  ];

  rows.push(blankRow, blankRow, blankRow);
  rows.push(medianRow);
  rows.push(headers);

  players.forEach(player => {
    if (!player.metrics) player.metrics = Array(35).fill(0);
    if (!player.trends) player.trends = Array(17).fill(0);

    const notes = generateSheetLikePlayerNotes(player, groups, groupStats);
    const weightedScoreValue = (typeof player.weightedScore === 'number' && !Number.isNaN(player.weightedScore))
      ? player.weightedScore.toFixed(2)
      : '0.00';

    const base = [
      notes,
      player.rank,
      player.dgId,
      player.name,
      Number(player.top5 || 0),
      Number(player.top10 || 0),
      weightedScoreValue,
      (player.pastPerformanceMultiplier || 1.0).toFixed(3)
    ];

    const historical = player.metrics.slice(0, 17).flatMap((val, idx) => {
      if (idx === 14) {
        return [formatSheetMetricValue(val, idx), '0.000'];
      }
      const trendIdx = idx < 14 ? idx : idx - 1;
      const trendValue = (player.trends && player.trends[trendIdx] !== undefined)
        ? Number(player.trends[trendIdx]).toFixed(3)
        : '0.000';
      return [formatSheetMetricValue(val, idx), trendValue];
    });

    const approach = player.metrics.slice(17).map((val, idx) => formatSheetMetricValue(val, idx + 17));

    const refinedWeightedScoreValue = (typeof player.refinedWeightedScore === 'number' && !Number.isNaN(player.refinedWeightedScore))
      ? player.refinedWeightedScore.toFixed(2)
      : '0.00';
    const deltaTrendValue = typeof player.deltaTrendScore === 'number' && !Number.isNaN(player.deltaTrendScore)
      ? player.deltaTrendScore.toFixed(3)
      : '';
    const deltaPredValue = typeof player.deltaPredictiveScore === 'number' && !Number.isNaN(player.deltaPredictiveScore)
      ? player.deltaPredictiveScore.toFixed(3)
      : '';
    const warValue = typeof player.war === 'number' && !Number.isNaN(player.war)
      ? player.war.toFixed(2)
      : '0.00';
    const trailingValues = [refinedWeightedScoreValue, warValue, deltaTrendValue, deltaPredValue];

    rows.push([...base, ...historical, ...approach, ...trailingValues]);
  });

  return rows.map(row => row.map(value => JSON.stringify(value ?? '')).join(',')).join('\n');
}

const SKILL_RATING_METRICS = [
  { label: 'SG Total', skillKey: 'sg_total' },
  { label: 'SG OTT', skillKey: 'sg_ott' },
  { label: 'SG Approach', skillKey: 'sg_app' },
  { label: 'SG Around Green', skillKey: 'sg_arg' },
  { label: 'SG Putting', skillKey: 'sg_putt' },
  { label: 'Driving Distance', skillKey: 'driving_dist' },
  { label: 'Driving Accuracy', skillKey: 'driving_acc' }
];

const LOWER_BETTER_GENERATED_METRICS = new Set([
  'Poor Shots',
  'Scoring Average',
  'Fairway Proximity',
  'Rough Proximity',
  'Approach <100 Prox',
  'Approach <150 FW Prox',
  'Approach <150 Rough Prox',
  'Approach >150 Rough Prox',
  'Approach <200 FW Prox',
  'Approach >200 FW Prox'
]);

function deriveBirdiesOrBetterFromRow(row) {
  if (!row) return null;
  const hasBirdies = row.birdies !== undefined && row.birdies !== null;
  const hasEagles = row.eagles_or_better !== undefined && row.eagles_or_better !== null;
  if (hasBirdies || hasEagles) {
    const birdies = hasBirdies ? cleanMetricValue(row.birdies) : 0;
    const eagles = hasEagles ? cleanMetricValue(row.eagles_or_better) : 0;
    return birdies + eagles;
  }
  if (row.birdies_or_better !== undefined && row.birdies_or_better !== null) {
    return cleanMetricValue(row.birdies_or_better);
  }
  return null;
}

function buildHistoricalMetricSamples(rawHistoryData, eventId) {
  const samples = [];
  const cutSamples = [];
  const maxFinishByYear = new Map();
  const eventIdStr = String(eventId || '').trim();

  rawHistoryData.forEach(row => {
    const rowEventId = String(row['event_id'] || '').trim();
    if (eventIdStr && rowEventId !== eventIdStr) return;

    const year = parseInt(String(row['year'] || row['season'] || '').trim());
    if (Number.isNaN(year)) return;

    const finishInfo = parseFinishStatus(row['fin_text']);
    const finishPosition = finishInfo.position;
    if (typeof finishPosition === 'number' && !Number.isNaN(finishPosition)) {
      const currentMax = maxFinishByYear.get(year) || 0;
      if (finishPosition > currentMax) maxFinishByYear.set(year, finishPosition);
    }

    const derivedBirdiesOrBetter = deriveBirdiesOrBetterFromRow(row);

    const metrics = {
      scoringAverage: row.score ? cleanMetricValue(row.score) : null,
      eagles: row.eagles_or_better ? cleanMetricValue(row.eagles_or_better) : null,
      birdies: row.birdies ? cleanMetricValue(row.birdies) : null,
      birdiesOrBetter: typeof derivedBirdiesOrBetter === 'number' ? derivedBirdiesOrBetter : null,
      strokesGainedTotal: row.sg_total ? cleanMetricValue(row.sg_total) : null,
      drivingDistance: row.driving_dist ? cleanMetricValue(row.driving_dist) : null,
      drivingAccuracy: row.driving_acc ? cleanMetricValue(row.driving_acc, true) : null,
      strokesGainedT2G: row.sg_t2g ? cleanMetricValue(row.sg_t2g) : null,
      strokesGainedApp: row.sg_app ? cleanMetricValue(row.sg_app) : null,
      strokesGainedArg: row.sg_arg ? cleanMetricValue(row.sg_arg) : null,
      strokesGainedOTT: row.sg_ott ? cleanMetricValue(row.sg_ott) : null,
      strokesGainedPutt: row.sg_putt ? cleanMetricValue(row.sg_putt) : null,
      greensInReg: row.gir ? cleanMetricValue(row.gir, true) : null,
      scrambling: row.scrambling ? cleanMetricValue(row.scrambling, true) : null,
      greatShots: row.great_shots !== undefined && row.great_shots !== null
        ? cleanMetricValue(row.great_shots)
        : null,
      poorShots: row.poor_shots !== undefined && row.poor_shots !== null
        ? cleanMetricValue(row.poor_shots)
        : null,
      fairwayProx: row.prox_fw ? cleanMetricValue(row.prox_fw) : null,
      roughProx: row.prox_rgh ? cleanMetricValue(row.prox_rgh) : null
    };

    if (typeof finishPosition === 'number' && !Number.isNaN(finishPosition)) {
      samples.push({ year, finishPosition, metrics });
      return;
    }
    if (finishInfo.isCut) {
      cutSamples.push({ year, metrics });
    }
  });

  cutSamples.forEach(sample => {
    const maxFinish = maxFinishByYear.get(sample.year);
    if (!Number.isFinite(maxFinish)) return;
    samples.push({
      year: sample.year,
      finishPosition: maxFinish + 1,
      metrics: sample.metrics
    });
  });

  return samples;
}

function computeHistoricalMetricCorrelations(samples) {
  const perYear = {};
  const aggregate = {};

  const grouped = samples.reduce((acc, sample) => {
    if (!acc[sample.year]) acc[sample.year] = [];
    acc[sample.year].push(sample);
    return acc;
  }, {});

  Object.entries(grouped).forEach(([year, yearSamples]) => {
    const metricsForYear = {};
    HISTORICAL_METRICS.forEach(metric => {
      const xValues = [];
      const yValues = [];

      yearSamples.forEach(sample => {
        const rawValue = sample.metrics[metric.key];
        if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) return;
        const adjustedValue = metric.lowerBetter ? -rawValue : rawValue;
        const successScore = -sample.finishPosition;
        xValues.push(adjustedValue);
        yValues.push(successScore);
      });

      if (xValues.length < 5) {
        metricsForYear[metric.key] = { correlation: 0, samples: xValues.length };
        return;
      }

      const correlation = calculateSpearmanCorrelation(xValues, yValues);
      metricsForYear[metric.key] = { correlation, samples: xValues.length };
    });

    perYear[year] = metricsForYear;
  });

  HISTORICAL_METRICS.forEach(metric => {
    let totalSamples = 0;
    let weightedCorrelation = 0;

    Object.values(perYear).forEach(yearMetrics => {
      const entry = yearMetrics[metric.key];
      if (!entry) return;
      weightedCorrelation += entry.correlation * entry.samples;
      totalSamples += entry.samples;
    });

    aggregate[metric.key] = {
      correlation: totalSamples > 0 ? weightedCorrelation / totalSamples : 0,
      samples: totalSamples
    };
  });

  return { perYear, average: aggregate };
}

function computeGeneratedMetricCorrelations(players, results) {
  const { map: resultsById } = buildFinishPositionMap(results);

  return GENERATED_METRIC_LABELS.map((label, index) => {
    const xValues = [];
    const yValues = [];

    players.forEach(player => {
      const dgId = String(player.dgId || '').trim();
      if (!dgId) return;
      const finishPosition = resultsById.get(dgId);
      if (typeof finishPosition !== 'number' || Number.isNaN(finishPosition)) return;
      if (!Array.isArray(player.metrics) || typeof player.metrics[index] !== 'number') return;
      const rawValue = player.metrics[index];
      if (Number.isNaN(rawValue)) return;
      const adjustedValue = LOWER_BETTER_GENERATED_METRICS.has(label) ? -rawValue : rawValue;
      xValues.push(adjustedValue);
      yValues.push(-finishPosition);
    });

    if (xValues.length < 5) {
      return { index, label, correlation: 0, samples: xValues.length };
    }

    return {
      index,
      label,
      correlation: calculateSpearmanCorrelation(xValues, yValues),
      samples: xValues.length
    };
  });
}

function computeGeneratedMetricTopNCorrelations(players, results, topN = 20) {
  const { map: resultsById } = buildFinishPositionMap(results);

  return GENERATED_METRIC_LABELS.map((label, index) => {
    const xValues = [];
    const yValues = [];

    players.forEach(player => {
      const dgId = String(player.dgId || '').trim();
      if (!dgId) return;
      const finishPosition = resultsById.get(dgId);
      if (typeof finishPosition !== 'number' || Number.isNaN(finishPosition)) return;
      if (!Array.isArray(player.metrics) || typeof player.metrics[index] !== 'number') return;
      const rawValue = player.metrics[index];
      if (Number.isNaN(rawValue)) return;
      const adjustedValue = LOWER_BETTER_GENERATED_METRICS.has(label) ? -rawValue : rawValue;
      const isTopN = finishPosition <= topN ? 1 : 0;
      xValues.push(adjustedValue);
      yValues.push(isTopN);
    });

    if (xValues.length < 5) {
      return { index, label, correlation: 0, samples: xValues.length };
    }

    return {
      index,
      label,
      correlation: calculateSpearmanCorrelation(xValues, yValues),
      samples: xValues.length
    };
  });
}

function sigmoid(value) {
  if (value < -50) return 0;
  if (value > 50) return 1;
  return 1 / (1 + Math.exp(-value));
}

function trainTopNLogisticModel(players, results, metricLabels, options = {}) {
  const {
    topN = 20,
    iterations = 400,
    learningRate = 0.15,
    l2 = 0.01
  } = options;

  const resultsById = new Map();
  results.forEach(result => {
    const dgId = String(result.dgId || '').trim();
    if (!dgId) return;
    if (result.finishPosition && !Number.isNaN(result.finishPosition)) {
      resultsById.set(dgId, result.finishPosition);
    }
  });

  const featureCount = metricLabels.length;
  const rows = [];
  const labels = [];

  players.forEach(player => {
    const dgId = String(player.dgId || '').trim();
    if (!dgId) return;
    const finishPosition = resultsById.get(dgId);
    if (!finishPosition || Number.isNaN(finishPosition)) return;
    if (!Array.isArray(player.metrics) || player.metrics.length < featureCount) return;
    const metricRow = [];
    for (let i = 0; i < featureCount; i++) {
      const rawValue = player.metrics[i];
      if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) return;
      const adjustedValue = LOWER_BETTER_GENERATED_METRICS.has(metricLabels[i]) ? -rawValue : rawValue;
      metricRow.push(adjustedValue);
    }
    rows.push(metricRow);
    labels.push(finishPosition <= topN ? 1 : 0);
  });

  if (rows.length < 10) {
    return {
      success: false,
      message: 'Not enough samples for logistic model',
      samples: rows.length
    };
  }

  const means = Array(featureCount).fill(0);
  const stds = Array(featureCount).fill(0);

  rows.forEach(row => {
    row.forEach((value, idx) => {
      means[idx] += value;
    });
  });
  for (let i = 0; i < featureCount; i++) {
    means[i] /= rows.length;
  }
  rows.forEach(row => {
    row.forEach((value, idx) => {
      const diff = value - means[idx];
      stds[idx] += diff * diff;
    });
  });
  for (let i = 0; i < featureCount; i++) {
    stds[i] = Math.sqrt(stds[i] / rows.length) || 1;
  }

  const normalizedRows = rows.map(row => row.map((value, idx) => (value - means[idx]) / stds[idx]));

  let weights = Array(featureCount).fill(0);
  let bias = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const grad = Array(featureCount).fill(0);
    let gradBias = 0;
    let loss = 0;

    for (let i = 0; i < normalizedRows.length; i++) {
      const row = normalizedRows[i];
      const linear = row.reduce((sum, value, idx) => sum + value * weights[idx], bias);
      const pred = sigmoid(linear);
      const error = pred - labels[i];
      loss += -labels[i] * Math.log(pred + 1e-9) - (1 - labels[i]) * Math.log(1 - pred + 1e-9);

      for (let j = 0; j < featureCount; j++) {
        grad[j] += error * row[j];
      }
      gradBias += error;
    }

    const n = normalizedRows.length;
    for (let j = 0; j < featureCount; j++) {
      grad[j] = grad[j] / n + l2 * weights[j];
      weights[j] -= learningRate * grad[j];
    }
    bias -= learningRate * (gradBias / n);
  }

  const predictions = normalizedRows.map(row => sigmoid(row.reduce((sum, value, idx) => sum + value * weights[idx], bias)));
  const predictedClass = predictions.map(p => (p >= 0.5 ? 1 : 0));
  const accuracy = predictedClass.filter((pred, idx) => pred === labels[idx]).length / labels.length;
  const logLoss = predictions.reduce((sum, p, idx) => {
    const y = labels[idx];
    return sum - (y * Math.log(p + 1e-9) + (1 - y) * Math.log(1 - p + 1e-9));
  }, 0) / labels.length;

  const weightRanking = weights
    .map((weight, idx) => ({
      label: metricLabels[idx],
      weight,
      absWeight: Math.abs(weight)
    }))
    .sort((a, b) => b.absWeight - a.absWeight);

  return {
    success: true,
    samples: rows.length,
    accuracy,
    logLoss,
    bias,
    weights,
    weightRanking: weightRanking.slice(0, 10)
  };
}

function buildSuggestedMetricWeights(metricLabels, top20Signal, top20Logistic) {
  const signalMap = new Map((top20Signal || []).map(entry => [entry.label, entry.correlation]));

  if (top20Logistic && top20Logistic.success && Array.isArray(top20Logistic.weights)) {
    const weights = top20Logistic.weights.map((weight, idx) => {
      const label = metricLabels[idx] || `Metric ${idx}`;
      const corr = signalMap.get(label);
      return {
        label,
        weight,
        absWeight: Math.abs(weight),
        logisticWeight: weight,
        top20Correlation: typeof corr === 'number' ? corr : null
      };
    });
    const total = weights.reduce((sum, entry) => sum + entry.absWeight, 0);
    const normalized = weights.map(entry => ({
      ...entry,
      weight: total > 0 ? entry.weight / total : 0,
      absWeight: total > 0 ? entry.absWeight / total : 0
    }));
    return {
      source: 'top20-logistic',
      weights: normalized.sort((a, b) => b.absWeight - a.absWeight)
    };
  }

  if (Array.isArray(top20Signal) && top20Signal.length > 0) {
    const weights = top20Signal.map(entry => ({
      label: entry.label,
      weight: entry.correlation,
      absWeight: Math.abs(entry.correlation),
      logisticWeight: null,
      top20Correlation: entry.correlation
    }));
    const total = weights.reduce((sum, entry) => sum + entry.absWeight, 0);
    const normalized = weights.map(entry => ({
      ...entry,
      weight: total > 0 ? entry.weight / total : 0,
      absWeight: total > 0 ? entry.absWeight / total : 0
    }));
    return {
      source: 'top20-signal',
      weights: normalized.sort((a, b) => b.absWeight - a.absWeight)
    };
  }

  return { source: 'none', weights: [] };
}

function buildMetricLabelToGroupMap(metricConfig) {
  const map = new Map();
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return map;
  metricConfig.groups.forEach(group => {
    group.metrics.forEach(metric => {
      const label = normalizeGeneratedMetricLabel(metric.name);
      if (label) {
        map.set(label, group.name);
      }
    });
  });
  return map;
}

function buildSuggestedGroupWeights(metricConfig, suggestedMetricWeights) {
  if (!suggestedMetricWeights || !Array.isArray(suggestedMetricWeights.weights)) {
    return { source: suggestedMetricWeights?.source || 'none', weights: [] };
  }

  const labelToGroup = buildMetricLabelToGroupMap(metricConfig);
  const groupTotals = {};

  suggestedMetricWeights.weights.forEach(entry => {
    const label = normalizeGeneratedMetricLabel(entry.label);
    const groupName = labelToGroup.get(label);
    if (!groupName) return;
    const contribution = typeof entry.absWeight === 'number'
      ? entry.absWeight
      : Math.abs(entry.weight || 0);
    groupTotals[groupName] = (groupTotals[groupName] || 0) + contribution;
  });

  const total = Object.values(groupTotals).reduce((sum, value) => sum + value, 0);
  const normalized = Object.entries(groupTotals).map(([groupName, value]) => ({
    groupName,
    weight: total > 0 ? value / total : 0
  })).sort((a, b) => b.weight - a.weight);

  return {
    source: suggestedMetricWeights.source || 'none',
    weights: normalized
  };
}

function buildMetricLabelToNameMap(metricConfig) {
  const map = new Map();
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return map;
  metricConfig.groups.forEach(group => {
    group.metrics.forEach(metric => {
      const label = normalizeGeneratedMetricLabel(metric.name);
      if (!label) return;
      map.set(label, { groupName: group.name, metricName: metric.name });
    });
  });
  return map;
}

function buildSkillRatingsValidation(ranking, skillSnapshot, metricConfig, options = {}) {
  const { mode = 'value', fallbackSnapshot = null } = options;
  const resolveSkillPlayers = snapshot => {
    const payload = snapshot?.payload;
    if (Array.isArray(payload?.players)) return payload.players;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload)) return payload;
    return [];
  };

  const payload = skillSnapshot?.payload;
  let skillPlayers = resolveSkillPlayers(skillSnapshot);
  const fallbackPlayers = resolveSkillPlayers(fallbackSnapshot);

  const buildRankMap = (players, skillKey) => {
    const values = players
      .map(player => {
        const dgId = String(player?.dg_id || '').trim();
        const value = Number(player?.[skillKey]);
        if (!dgId || !Number.isFinite(value)) return null;
        return { dgId, value };
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value);

    const rankMap = new Map();
    values.forEach((entry, index) => {
      rankMap.set(entry.dgId, index + 1);
    });
    return rankMap;
  };

  const derivedRankMaps = mode === 'rank' && fallbackPlayers.length > 0
    ? new Map(SKILL_RATING_METRICS.map(entry => [entry.skillKey, buildRankMap(fallbackPlayers, entry.skillKey)]))
    : null;

  if (skillPlayers.length === 0 && mode === 'rank' && fallbackPlayers.length > 0) {
    skillPlayers = fallbackPlayers;
  }
  if (!ranking || !Array.isArray(ranking.players)) {
    return { status: 'unavailable', reason: 'ranking_unavailable' };
  }
  if (skillPlayers.length === 0) {
    return { status: 'unavailable', reason: 'skill_ratings_unavailable' };
  }

  const skillById = new Map();
  skillPlayers.forEach(player => {
    const dgId = String(player?.dg_id || '').trim();
    if (!dgId) return;
    skillById.set(dgId, player);
  });

  const labelToMetric = buildMetricLabelToNameMap(metricConfig);
  const labelIndex = new Map(GENERATED_METRIC_LABELS.map((label, index) => [label, index]));

  let derivedFromValue = false;
  const metrics = SKILL_RATING_METRICS.map(entry => {
    const index = labelIndex.get(entry.label);
    const metricRef = labelToMetric.get(normalizeGeneratedMetricLabel(entry.label));
    if (typeof index !== 'number' || !metricRef) {
      return { ...entry, correlation: 0, samples: 0 };
    }

    const stats = ranking.groupStats?.[metricRef.groupName]?.[metricRef.metricName];
    const stdDev = stats?.stdDev || 0.001;
    const mean = typeof stats?.mean === 'number' ? stats.mean : 0;

    const modelValues = [];
    const skillValues = [];
    ranking.players.forEach(player => {
      const dgId = String(player?.dgId || '').trim();
      if (!dgId) return;
      const skill = skillById.get(dgId);
      if (!skill) return;
      let skillValueRaw = Number(skill?.[entry.skillKey]);
      if (mode === 'rank' && !Number.isFinite(skillValueRaw) && derivedRankMaps?.has(entry.skillKey)) {
        const derivedRank = derivedRankMaps.get(entry.skillKey).get(dgId);
        if (Number.isFinite(derivedRank)) {
          skillValueRaw = derivedRank;
          derivedFromValue = true;
        }
      }
      const modelRaw = player?.metrics?.[index];
      if (!Number.isFinite(skillValueRaw) || !Number.isFinite(modelRaw)) return;

      if (mode === 'rank') {
        const zScore = (modelRaw - mean) / stdDev;
        modelValues.push(zScore);
        skillValues.push(-skillValueRaw);
      } else {
        modelValues.push(modelRaw);
        skillValues.push(skillValueRaw);
      }
    });

    const samples = modelValues.length;
    const correlation = samples >= 5
      ? calculateSpearmanCorrelation(modelValues, skillValues)
      : 0;

    return { ...entry, correlation, samples };
  });

  const validMetrics = metrics.filter(metric => metric.samples > 0);
  const avgAbsCorrelation = validMetrics.length
    ? validMetrics.reduce((sum, metric) => sum + Math.abs(metric.correlation || 0), 0) / validMetrics.length
    : 0;

  const matchedPlayers = ranking.players.filter(player => {
    const dgId = String(player?.dgId || '').trim();
    return dgId && skillById.has(dgId);
  }).length;

  return {
    status: 'ok',
    source: skillSnapshot?.source || 'unknown',
    path: skillSnapshot?.path || null,
    lastUpdated: payload?.last_updated || null,
    display: mode,
    derivedFromValue,
    matchedPlayers,
    metrics,
    avgAbsCorrelation
  };
}

function buildPlayerDecompositionValidation(ranking, decompSnapshot) {
  const payload = decompSnapshot?.payload;
  const decompPlayers = Array.isArray(payload?.players)
    ? payload.players
    : (Array.isArray(payload?.data) ? payload.data : []);
  if (!ranking || !Array.isArray(ranking.players)) {
    return { status: 'unavailable', reason: 'ranking_unavailable' };
  }
  if (decompPlayers.length === 0) {
    return { status: 'unavailable', reason: 'player_decompositions_unavailable' };
  }

  const decompById = new Map();
  decompPlayers.forEach(player => {
    const dgId = String(player?.dg_id || '').trim();
    if (!dgId) return;
    decompById.set(dgId, player);
  });

  const modelValues = [];
  const decompValues = [];

  ranking.players.forEach(player => {
    const dgId = String(player?.dgId || '').trim();
    if (!dgId) return;
    const decomp = decompById.get(dgId);
    if (!decomp) return;
    const modelScore = Number.isFinite(player?.refinedWeightedScore)
      ? player.refinedWeightedScore
      : (Number.isFinite(player?.weightedScore)
        ? player.weightedScore
        : (Number.isFinite(player?.compositeScore)
          ? player.compositeScore
          : (Number.isFinite(player?.war) ? player.war : null)));
    const decompScore = Number(decomp?.final_pred ?? decomp?.baseline_pred);
    if (!Number.isFinite(modelScore) || !Number.isFinite(decompScore)) return;
    modelValues.push(modelScore);
    decompValues.push(decompScore);
  });

  const samples = modelValues.length;
  if (samples < 5) {
    return { status: 'unavailable', reason: 'insufficient_samples', samples };
  }

  const correlation = calculateSpearmanCorrelation(modelValues, decompValues);
  return {
    status: 'ok',
    source: decompSnapshot?.source || 'unknown',
    path: decompSnapshot?.path || null,
    lastUpdated: payload?.last_updated || null,
    eventName: payload?.event_name || null,
    courseName: payload?.course_name || null,
    samples,
    matchedPlayers: samples,
    correlation
  };
}

function buildFilledGroupWeights(suggestedGroupWeights, fallbackGroupWeights) {
  const merged = { ...(fallbackGroupWeights || {}) };
  (suggestedGroupWeights?.weights || []).forEach(entry => {
    if (entry?.groupName && typeof entry.weight === 'number') {
      merged[entry.groupName] = entry.weight;
    }
  });
  return normalizeWeights(merged);
}

function buildMetricWeightsFromSuggested(metricConfig, suggestedMetricWeights, fallbackMetricWeights) {
  const result = { ...(fallbackMetricWeights || {}) };
  if (!suggestedMetricWeights || !Array.isArray(suggestedMetricWeights.weights) || suggestedMetricWeights.weights.length === 0) {
    return result;
  }

  const labelToMetric = buildMetricLabelToNameMap(metricConfig);
  const grouped = new Map();

  suggestedMetricWeights.weights.forEach(entry => {
    const label = normalizeGeneratedMetricLabel(entry.label);
    const mapping = labelToMetric.get(label);
    if (!mapping) return;
    if (!grouped.has(mapping.groupName)) grouped.set(mapping.groupName, new Map());
    grouped.get(mapping.groupName).set(mapping.metricName, entry.weight || 0);
  });

  metricConfig.groups.forEach(group => {
    if (!grouped.has(group.name)) return;
    const groupWeights = grouped.get(group.name);
    const total = Array.from(groupWeights.values()).reduce((sum, value) => sum + value, 0);
    if (total <= 0) return;
    group.metrics.forEach(metric => {
      const key = `${group.name}::${metric.name}`;
      if (groupWeights.has(metric.name)) {
        result[key] = groupWeights.get(metric.name) / total;
      } else {
        result[key] = 0;
      }
    });
  });
  return result;
}

function blendGroupWeights(priorWeights = {}, modelWeights = {}, priorShare = 0.6, modelShare = 0.4) {
  const blended = {};
  const keys = new Set([...Object.keys(priorWeights || {}), ...Object.keys(modelWeights || {})]);
  keys.forEach(key => {
    const prior = typeof priorWeights[key] === 'number' ? priorWeights[key] : 0;
    const model = typeof modelWeights[key] === 'number' ? modelWeights[key] : 0;
    blended[key] = prior * priorShare + model * modelShare;
  });
  return normalizeWeights(blended);
}

function blendMetricWeights(metricConfig, priorMetricWeights = {}, modelMetricWeights = {}, priorShare = 0.6, modelShare = 0.4) {
  const blended = {};
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return blended;

  metricConfig.groups.forEach(group => {
    const metrics = group.metrics || [];
    const keys = metrics.map(metric => `${group.name}::${metric.name}`);
    const groupValues = keys.map(key => {
      const prior = typeof priorMetricWeights[key] === 'number' ? priorMetricWeights[key] : 0;
      const model = typeof modelMetricWeights[key] === 'number' ? modelMetricWeights[key] : 0;
      return prior * priorShare + model * modelShare;
    });
    const totalAbs = groupValues.reduce((sum, value) => sum + Math.abs(value), 0);
    keys.forEach((key, idx) => {
      if (totalAbs > 0) {
        blended[key] = groupValues[idx] / totalAbs;
      } else if (typeof priorMetricWeights[key] === 'number') {
        blended[key] = priorMetricWeights[key];
      } else {
        blended[key] = 0;
      }
    });
  });

  return blended;
}

function normalizeMetricSpecs(metricSpecs) {
  if (!Array.isArray(metricSpecs)) return [];
  if (metricSpecs.length === 0) return [];
  if (typeof metricSpecs[0] === 'string') {
    return metricSpecs.map((label, index) => ({ label, index }));
  }
  return metricSpecs.map((spec, index) => ({
    label: spec.label,
    index: typeof spec.index === 'number' ? spec.index : index
  }));
}

function computeGeneratedMetricCorrelationsForLabels(players, results, metricSpecs) {
  const { map: resultsById } = buildFinishPositionMap(results);

  const specs = normalizeMetricSpecs(metricSpecs);
  return specs.map(spec => {
    const { label, index } = spec;
    const xValues = [];
    const yValues = [];

    players.forEach(player => {
      const dgId = String(player.dgId || '').trim();
      if (!dgId) return;
      const finishPosition = resultsById.get(dgId);
      if (typeof finishPosition !== 'number' || Number.isNaN(finishPosition)) return;
      if (!Array.isArray(player.metrics) || typeof player.metrics[index] !== 'number') return;
      const rawValue = player.metrics[index];
      if (Number.isNaN(rawValue)) return;
      const adjustedValue = LOWER_BETTER_GENERATED_METRICS.has(label) ? -rawValue : rawValue;
      xValues.push(adjustedValue);
      yValues.push(-finishPosition);
    });

    if (xValues.length < 5) {
      return { index, label, correlation: 0, samples: xValues.length };
    }

    return {
      index,
      label,
      correlation: calculateSpearmanCorrelation(xValues, yValues),
      samples: xValues.length
    };
  });
}

function computeGeneratedMetricTopNCorrelationsForLabels(players, results, metricSpecs, topN = 20) {
  const { map: resultsById } = buildFinishPositionMap(results);

  const specs = normalizeMetricSpecs(metricSpecs);
  return specs.map(spec => {
    const { label, index } = spec;
    const xValues = [];
    const yValues = [];

    players.forEach(player => {
      const dgId = String(player.dgId || '').trim();
      if (!dgId) return;
      const finishPosition = resultsById.get(dgId);
      if (typeof finishPosition !== 'number' || Number.isNaN(finishPosition)) return;
      if (!Array.isArray(player.metrics) || typeof player.metrics[index] !== 'number') return;
      const rawValue = player.metrics[index];
      if (Number.isNaN(rawValue)) return;
      const adjustedValue = LOWER_BETTER_GENERATED_METRICS.has(label) ? -rawValue : rawValue;
      const isTopN = finishPosition <= topN ? 1 : 0;
      xValues.push(adjustedValue);
      yValues.push(isTopN);
    });

    if (xValues.length < 5) {
      return { index, label, correlation: 0, samples: xValues.length };
    }

    return {
      index,
      label,
      correlation: calculateSpearmanCorrelation(xValues, yValues),
      samples: xValues.length
    };
  });
}

function buildTopNSamplesFromPlayers(players, results, metricSpecs, topN = 20) {
  const { map: resultsById } = buildFinishPositionMap(results);

  return players.reduce((acc, player) => {
    const dgId = String(player.dgId || '').trim();
    if (!dgId) return acc;
    const finishPosition = resultsById.get(dgId);
    if (typeof finishPosition !== 'number' || Number.isNaN(finishPosition)) return acc;
    const featurePack = buildFeatureVector(player, metricSpecs);
    if (!featurePack) return acc;
    acc.push({ features: featurePack.features, label: finishPosition <= 20 ? 1 : 0 });
    return acc;
  }, []);
}

function trainLogisticFromSamples(samples, options = {}) {
  const { iterations = 300, learningRate = 0.12, l2 = 0.01 } = options;
  if (!Array.isArray(samples) || samples.length < 10) {
    return { success: false, message: 'Not enough samples', samples: samples ? samples.length : 0 };
  }

  const featureCount = samples[0].features.length;
  const means = Array(featureCount).fill(0);
  const stds = Array(featureCount).fill(0);

  samples.forEach(sample => {
    sample.features.forEach((value, idx) => {
      means[idx] += value;
    });
  });
  for (let i = 0; i < featureCount; i++) {
    means[i] /= samples.length;
  }
  samples.forEach(sample => {
    sample.features.forEach((value, idx) => {
      const diff = value - means[idx];
      stds[idx] += diff * diff;
    });
  });
  for (let i = 0; i < featureCount; i++) {
    stds[i] = Math.sqrt(stds[i] / samples.length) || 1;
  }

  const normalized = samples.map(sample => ({
    features: sample.features.map((value, idx) => (value - means[idx]) / stds[idx]),
    label: sample.label
  }));

  let weights = Array(featureCount).fill(0);
  let bias = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const grad = Array(featureCount).fill(0);
    let gradBias = 0;

    normalized.forEach(sample => {
      const linear = sample.features.reduce((sum, value, idx) => sum + value * weights[idx], bias);
      const pred = sigmoid(linear);
      const error = pred - sample.label;
      for (let j = 0; j < featureCount; j++) {
        grad[j] += error * sample.features[j];
      }
      gradBias += error;
    });

    const n = normalized.length;
    for (let j = 0; j < featureCount; j++) {
      grad[j] = grad[j] / n + l2 * weights[j];
      weights[j] -= learningRate * grad[j];
    }
    bias -= learningRate * (gradBias / n);
  }

  return {
    success: true,
    samples: samples.length,
    weights,
    bias,
    means,
    stds,
    l2
  };
}

function evaluateLogisticModel(model, samples) {
  if (!model || !model.success || !Array.isArray(samples) || samples.length === 0) {
    return { accuracy: 0, logLoss: 0, samples: samples ? samples.length : 0 };
  }

  let correct = 0;
  let logLoss = 0;

  samples.forEach(sample => {
    const normalized = sample.features.map((value, idx) => (value - model.means[idx]) / model.stds[idx]);
    const linear = normalized.reduce((sum, value, idx) => sum + value * model.weights[idx], model.bias);
    const pred = sigmoid(linear);
    const predictedClass = pred >= 0.5 ? 1 : 0;
    if (predictedClass === sample.label) correct += 1;
    logLoss += -sample.label * Math.log(pred + 1e-9) - (1 - sample.label) * Math.log(1 - pred + 1e-9);
  });

  return {
    accuracy: correct / samples.length,
    logLoss: logLoss / samples.length,
    samples: samples.length
  };
}

function summarizeLogisticModel(model, samples, metricLabels) {
  if (!model || !model.success) {
    return { success: false, message: model?.message || 'Model unavailable', samples: model?.samples || 0 };
  }

  const evaluation = evaluateLogisticModel(model, samples);
  const weightRanking = model.weights
    .map((weight, idx) => ({
      label: metricLabels[idx],
      weight,
      absWeight: Math.abs(weight)
    }))
    .sort((a, b) => b.absWeight - a.absWeight)
    .slice(0, 10);

  return {
    success: true,
    samples: evaluation.samples,
    accuracy: evaluation.accuracy,
    logLoss: evaluation.logLoss,
    bias: model.bias,
    weights: model.weights,
    l2: model.l2,
    weightRanking
  };
}

function computeSingleMetricCorrelation(players, results, options = {}) {
  const { label = 'Metric', valueGetter = null } = options;
  const { map: resultsById } = buildFinishPositionMap(results);

  const xValues = [];
  const yValues = [];

  players.forEach(player => {
    const dgId = String(player.dgId || '').trim();
    if (!dgId) return;
    const finishPosition = resultsById.get(dgId);
    if (typeof finishPosition !== 'number' || Number.isNaN(finishPosition)) return;
    const rawValue = valueGetter ? valueGetter(player) : null;
    if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) return;
    xValues.push(rawValue);
    yValues.push(finishPosition);
  });

  if (xValues.length < 5) {
    return { label, correlation: 0, samples: xValues.length };
  }

  return {
    label,
    correlation: calculateSpearmanCorrelation(xValues, yValues),
    samples: xValues.length
  };
}

function normalizeGeneratedMetricLabel(metricLabel) {
  return String(metricLabel || '')
    .replace(/^(Scoring|Course Management):\s*/i, '')
    .trim();
}

function shouldInvertGeneratedMetric(label, correlation) {
  return LOWER_BETTER_GENERATED_METRICS.has(label) && correlation < 0;
}

function buildInvertedLabelSet(top20Signal = []) {
  const inverted = new Set();
  (top20Signal || []).forEach(entry => {
    if (!entry) return;
    const label = String(entry.label || '').trim();
    if (!label) return;
    if (shouldInvertGeneratedMetric(label, entry.correlation || 0)) {
      inverted.add(normalizeGeneratedMetricLabel(label));
    }
  });
  return inverted;
}

function applyInversionsToMetricWeights(metricConfig, metricWeights = {}, invertedLabelSet = new Set()) {
  if (!metricConfig || !Array.isArray(metricConfig.groups) || invertedLabelSet.size === 0) {
    return { ...metricWeights };
  }

  const updated = { ...metricWeights };
  metricConfig.groups.forEach(group => {
    group.metrics.forEach(metric => {
      const normalizedName = normalizeGeneratedMetricLabel(metric.name);
      if (!invertedLabelSet.has(normalizedName)) return;
      const key = `${group.name}::${metric.name}`;
      const weight = updated[key];
      if (typeof weight === 'number') {
        updated[key] = -Math.abs(weight);
      }
    });
  });

  return updated;
}

function normalizeIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(id => String(id || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,|]/)
    .map(id => String(id || '').trim())
    .filter(Boolean);
}

function clamp01(value, fallback = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function scoreLowerBetter(value, good, bad) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value <= good) return 1;
  if (value >= bad) return 0;
  return (bad - value) / (bad - good);
}

function scoreHigherBetter(value, good, bad) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value >= good) return 1;
  if (value <= bad) return 0;
  return (value - bad) / (good - bad);
}

function computeCvReliability(cvSummary, options = {}) {
  if (!cvSummary || !cvSummary.success) return 0;
  const {
    logLossGood = 0.25,
    logLossBad = 0.45,
    accuracyGood = 0.65,
    accuracyBad = 0.52,
    minEvents = 3,
    maxEvents = 8,
    minSamples = 120,
    maxSamples = 350
  } = options;

  const logLossScore = scoreLowerBetter(cvSummary.avgLogLoss, logLossGood, logLossBad);
  const accuracyScore = scoreHigherBetter(cvSummary.avgAccuracy, accuracyGood, accuracyBad);
  const eventCount = typeof cvSummary.eventCount === 'number' ? cvSummary.eventCount : 0;
  const sampleCount = typeof cvSummary.totalSamples === 'number' ? cvSummary.totalSamples : 0;
  const eventScore = clamp01((eventCount - (minEvents - 1)) / Math.max(1, maxEvents - (minEvents - 1)));
  const sampleScore = clamp01((sampleCount - minSamples) / Math.max(1, maxSamples - minSamples));
  const baseScore = (logLossScore + accuracyScore) / 2;
  return clamp01(baseScore * eventScore * sampleScore);
}

function groupWeightsMapToArray(groupWeights) {
  return Object.entries(groupWeights || {})
    .map(([groupName, weight]) => ({ groupName, weight }))
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));
}

function blendSuggestedGroupWeightsWithCv(suggestedGroupWeights, fallbackGroupWeights, cvReliability, options = {}) {
  const maxModelShare = typeof options.maxModelShare === 'number' ? options.maxModelShare : 0.35;
  if (!suggestedGroupWeights || !Array.isArray(suggestedGroupWeights.weights) || suggestedGroupWeights.weights.length === 0) {
    return {
      source: suggestedGroupWeights?.source || 'none',
      weights: [],
      cvReliability,
      modelShare: 0,
      priorShare: 1
    };
  }

  const modelShare = clamp01(maxModelShare * clamp01(cvReliability));
  const priorShare = 1 - modelShare;
  const filledGroupWeights = buildFilledGroupWeights(suggestedGroupWeights, fallbackGroupWeights);
  const blended = blendGroupWeights(fallbackGroupWeights, filledGroupWeights, priorShare, modelShare);

  return {
    source: suggestedGroupWeights.source || 'none',
    weights: groupWeightsMapToArray(blended),
    cvReliability,
    modelShare,
    priorShare
  };
}

const CURRENT_EVENT_ROUNDS_DEFAULTS = {
  currentSeasonMetrics: true,
  currentSeasonBaseline: false,
  currentSeasonOptimization: false,
  historicalEvaluation: false
};

function resolveIncludeCurrentEventRounds(fallback) {
  if (INCLUDE_CURRENT_EVENT_ROUNDS === true) return true;
  if (INCLUDE_CURRENT_EVENT_ROUNDS === false) return false;
  return fallback;
}

function buildResultsFromRows(rows) {
  const numericResults = new Map();
  const cutIds = new Set();

  rows.forEach(row => {
    const dgId = String(row['dg_id'] || '').trim();
    if (!dgId) return;
    const finishInfo = parseFinishStatus(row['fin_text']);
    if (typeof finishInfo.position === 'number' && !Number.isNaN(finishInfo.position)) {
      const existing = numericResults.get(dgId);
      if (!existing || finishInfo.position < existing) {
        numericResults.set(dgId, finishInfo.position);
      }
      return;
    }
    if (finishInfo.isCut) {
      cutIds.add(dgId);
    }
  });

  const positions = Array.from(numericResults.values());
  const fallback = positions.length ? Math.max(...positions) + 1 : null;
  const results = Array.from(numericResults.entries()).map(([dgId, finishPosition]) => ({ dgId, finishPosition }));
  if (Number.isFinite(fallback)) {
    cutIds.forEach(dgId => {
      if (!numericResults.has(dgId)) results.push({ dgId, finishPosition: fallback });
    });
  }

  return results;
}

function pickFirstValue(row, keys) {
  for (const key of keys) {
    if (!row) continue;
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }
  }
  return null;
}

function buildResultsFromResultRows(rows) {
  const numericResults = new Map();
  const cutIds = new Set();

  rows.forEach(row => {
    const dgId = pickFirstValue(row, ['DG ID', 'dgId', 'dg_id', 'dg id', 'Player ID', 'player_id']);
    if (!dgId) return;
    const finishRaw = pickFirstValue(row, ['Finish Position', 'finishPosition', 'finish', 'fin_text', 'fin', 'Finish']);
    const finishInfo = parseFinishStatus(finishRaw);
    if (typeof finishInfo.position === 'number' && !Number.isNaN(finishInfo.position)) {
      const key = String(dgId).trim();
      const existing = numericResults.get(key);
      if (!existing || finishInfo.position < existing) {
        numericResults.set(key, finishInfo.position);
      }
      return;
    }
    if (finishInfo.isCut) {
      cutIds.add(String(dgId).trim());
    }
  });

  const positions = Array.from(numericResults.values());
  const fallback = positions.length ? Math.max(...positions) + 1 : null;
  const results = Array.from(numericResults.entries()).map(([dgId, finishPosition]) => ({ dgId, finishPosition }));
  if (Number.isFinite(fallback)) {
    cutIds.forEach(dgId => {
      if (!numericResults.has(dgId)) results.push({ dgId, finishPosition: fallback });
    });
  }

  return results;
}

function loadResultsFromJsonFile(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return { results: [], meta: null };
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const eventId = payload?.eventId ? String(payload.eventId).trim() : null;
    const season = payload?.season ? String(payload.season).trim() : null;
    const expectedEventId = options.eventId ? String(options.eventId).trim() : null;
    const expectedSeason = options.season ? String(options.season).trim() : null;
    if (expectedEventId && eventId && eventId !== expectedEventId) {
      return { results: [], meta: { reason: 'eventId_mismatch', eventId, season } };
    }
    if (expectedSeason && season && season !== expectedSeason) {
      return { results: [], meta: { reason: 'season_mismatch', eventId, season } };
    }
    const rows = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.results) ? payload.results : []);
    const results = buildResultsFromResultRows(rows);
    return { results, meta: { eventId, season } };
  } catch (error) {
    return { results: [], meta: { reason: 'parse_error', error: error.message } };
  }
}

function findPostEventResultsFile(postEventDir, slug, ext, exclude = []) {
  if (!postEventDir || !fs.existsSync(postEventDir)) return null;
  const desired = slug ? path.resolve(postEventDir, `${slug}_results.${ext}`) : null;
  if (desired && fs.existsSync(desired)) return desired;
  const entries = fs.readdirSync(postEventDir)
    .filter(name => name.toLowerCase().endsWith(`_results.${ext}`));
  const filtered = entries.filter(name => !exclude.some(token => name.toLowerCase().includes(token)));
  if (filtered.length === 0) return null;
  filtered.sort();
  return path.resolve(postEventDir, filtered[0]);
}

function blendCorrelationLists(baseList, blendList, blendWeight) {
  if (!Array.isArray(baseList) || baseList.length === 0) return baseList || [];
  if (!Array.isArray(blendList) || blendList.length === 0 || blendWeight <= 0) return baseList;
  const blendMap = new Map(blendList.map(entry => [entry.label, entry]));
  return baseList.map(entry => {
    const blendEntry = blendMap.get(entry.label);
    if (!blendEntry || typeof blendEntry.correlation !== 'number') return entry;
    const baseCorr = typeof entry.correlation === 'number' ? entry.correlation : 0;
    return {
      ...entry,
      correlation: baseCorr * (1 - blendWeight) + blendEntry.correlation * blendWeight
    };
  });
}

function blendSingleMetricCorrelation(baseList, blendList, targetLabel, blendWeight) {
  if (!Array.isArray(baseList) || baseList.length === 0) return baseList || [];
  if (!Array.isArray(blendList) || blendList.length === 0 || blendWeight <= 0) return baseList;
  const blendEntry = blendList.find(entry => entry.label === targetLabel);
  if (!blendEntry || typeof blendEntry.correlation !== 'number') return baseList;
  return baseList.map(entry => {
    if (entry.label !== targetLabel) return entry;
    const baseCorr = typeof entry.correlation === 'number' ? entry.correlation : 0;
    return {
      ...entry,
      correlation: baseCorr * (1 - blendWeight) + blendEntry.correlation * blendWeight
    };
  });
}

function computeMetricAlignmentScore(metricWeights, groupWeights, correlationMap) {
  if (!metricWeights || !correlationMap || correlationMap.size === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  Object.entries(metricWeights).forEach(([metricKey, weight]) => {
    if (typeof weight !== 'number') return;
    const [groupName, metricNameRaw] = metricKey.split('::');
    if (!groupName || !metricNameRaw) return;
    const metricName = normalizeGeneratedMetricLabel(metricNameRaw);
    const correlation = correlationMap.get(metricName);
    if (typeof correlation !== 'number') return;
    const groupWeight = typeof groupWeights?.[groupName] === 'number' ? groupWeights[groupName] : 1;
    const effectiveWeight = groupWeight * weight;
    weightedSum += effectiveWeight * correlation;
    totalWeight += Math.abs(effectiveWeight);
  });

  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

function buildAlignmentMapFromTop20Signal(top20Signal) {
  if (!Array.isArray(top20Signal)) return new Map();
  return new Map(top20Signal.map(entry => [normalizeGeneratedMetricLabel(entry.label), entry.correlation]));
}

function buildAlignmentMapFromTop20Logistic(metricLabels, top20Logistic) {
  if (!top20Logistic || !top20Logistic.success || !Array.isArray(top20Logistic.weights)) return new Map();
  const map = new Map();
  top20Logistic.weights.forEach((weight, idx) => {
    const label = metricLabels[idx] || `Metric ${idx}`;
    map.set(normalizeGeneratedMetricLabel(label), Math.abs(weight));
  });
  return map;
}

function blendAlignmentMaps(maps, weights) {
  const combined = new Map();
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  maps.forEach((map, idx) => {
    const weight = weights[idx] || 0;
    if (!map || weight === 0) return;
    map.forEach((value, key) => {
      const normalized = value * (weight / totalWeight);
      combined.set(key, (combined.get(key) || 0) + normalized);
    });
  });
  return combined;
}

function applyShotDistributionToMetricWeights(metricWeights = {}, courseSetupWeights = {}) {
  const normalized = { ...metricWeights };
  const under100 = typeof courseSetupWeights.under100 === 'number' ? courseSetupWeights.under100 : 0;
  const from100to150 = typeof courseSetupWeights.from100to150 === 'number' ? courseSetupWeights.from100to150 : 0;
  const from150to200 = typeof courseSetupWeights.from150to200 === 'number' ? courseSetupWeights.from150to200 : 0;
  const over200 = typeof courseSetupWeights.over200 === 'number' ? courseSetupWeights.over200 : 0;
  const total = under100 + from100to150 + from150to200 + over200;
  if (total <= 0) return normalized;

  const distribution = [under100, from100to150, from150to200, over200].map(value => value / total);

  const applyToGroup = (groupName, metricNames) => {
    const weights = metricNames.map(name => {
      const key = `${groupName}::${name}`;
      const value = normalized[key];
      return typeof value === 'number' ? value : 0;
    });
    const signs = weights.map(value => (Math.sign(value) || 1));
    const totalAbs = weights.reduce((sum, value) => sum + Math.abs(value), 0);
    if (totalAbs <= 0) return;

    const [distUnder100, dist100to150, dist150to200, distOver200] = distribution;

    const adjusted = [
      distUnder100 * totalAbs * signs[0],
      (dist100to150 * totalAbs / 2) * signs[1],
      (dist100to150 * totalAbs / 2) * signs[2],
      dist150to200 * totalAbs * signs[3],
      (distOver200 * totalAbs / 2) * signs[4],
      (distOver200 * totalAbs / 2) * signs[5]
    ];

    metricNames.forEach((name, index) => {
      const key = `${groupName}::${name}`;
      normalized[key] = adjusted[index];
    });
  };

  applyToGroup('Scoring', [
    'Scoring: Approach <100 SG',
    'Scoring: Approach <150 FW SG',
    'Scoring: Approach <150 Rough SG',
    'Scoring: Approach <200 FW SG',
    'Scoring: Approach >200 FW SG',
    'Scoring: Approach >150 Rough SG'
  ]);

  applyToGroup('Course Management', [
    'Course Management: Approach <100 Prox',
    'Course Management: Approach <150 FW Prox',
    'Course Management: Approach <150 Rough Prox',
    'Course Management: Approach <200 FW Prox',
    'Course Management: Approach >200 FW Prox',
    'Course Management: Approach >150 Rough Prox'
  ]);

  return normalized;
}

function buildTop20CompositeScore(evaluation) {
  if (!evaluation) return 0;
  const acc = typeof evaluation.top20 === 'number' ? evaluation.top20 / 100 : null;
  const weighted = typeof evaluation.top20WeightedScore === 'number' ? evaluation.top20WeightedScore / 100 : null;
  if (acc !== null && weighted !== null) return (acc + weighted) / 2;
  if (acc !== null) return acc;
  if (weighted !== null) return weighted;
  return 0;
}

function compareEvaluations(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const aWeighted = typeof a.top20WeightedScore === 'number' ? a.top20WeightedScore : -Infinity;
  const bWeighted = typeof b.top20WeightedScore === 'number' ? b.top20WeightedScore : -Infinity;
  if (aWeighted !== bWeighted) return aWeighted > bWeighted ? 1 : -1;

  const aCorr = typeof a.correlation === 'number' ? a.correlation : -Infinity;
  const bCorr = typeof b.correlation === 'number' ? b.correlation : -Infinity;
  if (aCorr !== bCorr) return aCorr > bCorr ? 1 : -1;

  const aTop20 = typeof a.top20 === 'number' ? a.top20 : -Infinity;
  const bTop20 = typeof b.top20 === 'number' ? b.top20 : -Infinity;
  if (aTop20 !== bTop20) return aTop20 > bTop20 ? 1 : -1;

  return 0;
}

function evaluateStressTest(evaluation, options = {}) {
  if (!evaluation) {
    return { status: 'n/a', reason: 'no evaluation' };
  }
  const {
    minPlayers = 20,
    minCorr = 0.1,
    minTop20Weighted = 60
  } = options;

  const matchedPlayers = typeof evaluation.matchedPlayers === 'number'
    ? evaluation.matchedPlayers
    : null;
  if (matchedPlayers !== null && matchedPlayers < minPlayers) {
    return {
      status: 'insufficient',
      reason: `players<${minPlayers}`,
      matchedPlayers
    };
  }

  const subsetEval = evaluation.adjusted?.subset || null;
  const correlation = typeof subsetEval?.correlation === 'number'
    ? subsetEval.correlation
    : evaluation.correlation;
  const top20Weighted = typeof subsetEval?.top20WeightedScore === 'number'
    ? subsetEval.top20WeightedScore
    : evaluation.top20WeightedScore;

  const reasons = [];
  if (typeof correlation === 'number' && correlation < minCorr) {
    reasons.push(`corr<${minCorr}`);
  }
  if (typeof top20Weighted === 'number' && top20Weighted < minTop20Weighted) {
    reasons.push(`top20W<${minTop20Weighted}%`);
  }

  return {
    status: reasons.length ? 'fail' : 'pass',
    reason: reasons.join(', '),
    matchedPlayers
  };
}

const TEMPLATE_METRIC_MAP = {
  'Driving Distance': 'drivingDistance',
  'Driving Accuracy': 'drivingAccuracy',
  'SG OTT': 'strokesGainedOTT',
  'SG Putting': 'strokesGainedPutt',
  'SG Around Green': 'strokesGainedArg',
  'SG T2G': 'strokesGainedT2G',
  'Scoring Average': 'scoringAverage',
  'Scrambling': 'scrambling',
  'Great Shots': 'greatShots',
  'Poor Shots': 'poorShots'
};

function computeTemplateCorrelationAlignment(metricWeights, historicalCorrelations) {
  let weightedCorrelation = 0;
  let matchedWeight = 0;
  let matchedMetrics = 0;

  Object.entries(metricWeights || {}).forEach(([metricKey, weight]) => {
    if (typeof weight !== 'number') return;
    const baseMetricName = metricKey.includes('::')
      ? metricKey.split('::')[1].trim()
      : metricKey;
    const historicalKey = TEMPLATE_METRIC_MAP[baseMetricName];
    if (!historicalKey) return;
    const correlationEntry = historicalCorrelations[historicalKey];
    if (!correlationEntry) return;
    weightedCorrelation += weight * correlationEntry.correlation;
    matchedWeight += weight;
    matchedMetrics += 1;
  });

  return {
    weightedCorrelation,
    matchedWeight,
    matchedMetrics,
    coveragePct: matchedWeight > 0 ? (matchedWeight / Object.values(metricWeights || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)) * 100 : 0
  };
}

function calculatePearsonCorrelation(xValues, yValues) {
  if (xValues.length === 0) return 0;
  const n = xValues.length;
  const meanX = xValues.reduce((a, b) => a + b, 0) / n;
  const meanY = yValues.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xValues[i] - meanX;
    const dy = yValues[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : numerator / denom;
}

function rankValues(values) {
  const entries = values.map((value, index) => ({ value, index }));
  entries.sort((a, b) => a.value - b.value);

  const ranks = Array(values.length);
  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].value === entries[i].value) {
      j += 1;
    }
    const avgRank = (i + j + 2) / 2; // 1-based rank average for ties
    for (let k = i; k <= j; k += 1) {
      ranks[entries[k].index] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

function calculateSpearmanCorrelation(xValues, yValues) {
  if (!Array.isArray(xValues) || !Array.isArray(yValues)) return 0;
  if (xValues.length === 0 || xValues.length !== yValues.length) return 0;
  const rankedX = rankValues(xValues);
  const rankedY = rankValues(yValues);
  return calculatePearsonCorrelation(rankedX, rankedY);
}

function calculateTopNAccuracy(predictions, actualResults, n) {
  if (predictions.length === 0) return 0;

  const hasRank = predictions.some(p => typeof p.rank === 'number');
  const topNPlayers = hasRank
    ? predictions.filter(p => typeof p.rank === 'number' && p.rank <= n)
    : predictions.slice(0, n);

  const topN = new Set(topNPlayers.map(p => String(p.dgId)));
  const matches = actualResults.filter(a => {
    if (!a || !topN.has(String(a.dgId))) return false;
    const finishPosition = a.finishPosition;
    return typeof finishPosition === 'number' && !Number.isNaN(finishPosition) && finishPosition <= n;
  }).length;
  const denominator = topN.size || n;
  return (matches / denominator) * 100;
}

function calculateTopNWeightedScore(predictions, actualResults, n) {
  if (predictions.length === 0 || actualResults.length === 0) return 0;

  const actualById = new Map();
  actualResults.forEach(result => {
    const dgId = String(result.dgId);
    if (result.finishPosition && !Number.isNaN(result.finishPosition)) {
      actualById.set(dgId, result.finishPosition);
    }
  });

  const hasRank = predictions.some(p => typeof p.rank === 'number');
  const sortedPredictions = hasRank
    ? [...predictions].sort((a, b) => (a.rank || 0) - (b.rank || 0))
    : [...predictions];

  const gain = finishPosition => {
    if (!finishPosition || Number.isNaN(finishPosition) || finishPosition > n) return 0;
    return (n - finishPosition + 1);
  };

  const topPredictions = sortedPredictions.filter(p => actualById.has(String(p.dgId))).slice(0, n);
  const dcg = topPredictions.reduce((sum, player, index) => {
    const finishPosition = actualById.get(String(player.dgId));
    const rel = gain(finishPosition);
    return sum + (rel / Math.log2(index + 2));
  }, 0);

  const idealResults = actualResults
    .filter(result => result.finishPosition && !Number.isNaN(result.finishPosition) && result.finishPosition <= n)
    .sort((a, b) => a.finishPosition - b.finishPosition)
    .slice(0, n);

  const idcg = idealResults.reduce((sum, result, index) => {
    const rel = gain(result.finishPosition);
    return sum + (rel / Math.log2(index + 2));
  }, 0);

  if (idcg === 0) return 0;
  return (dcg / idcg) * 100;
}

function calculateTopNAccuracyFromActualRanks(predictions, actualRankMap, n) {
  if (!predictions.length || !actualRankMap || actualRankMap.size === 0) return 0;
  const hasRank = predictions.some(p => typeof p.rank === 'number');
  const sortedPredictions = hasRank
    ? [...predictions].filter(p => typeof p.rank === 'number').sort((a, b) => (a.rank || 0) - (b.rank || 0))
    : [...predictions];
  const topPredicted = sortedPredictions.slice(0, n).map(p => String(p.dgId));
  const topActual = Array.from(actualRankMap.entries())
    .filter(([, rank]) => typeof rank === 'number' && rank <= n)
    .map(([dgId]) => String(dgId));
  const topActualSet = new Set(topActual);
  const overlap = topPredicted.filter(id => topActualSet.has(id));
  const denominator = topPredicted.length || n;
  return denominator === 0 ? 0 : (overlap.length / denominator) * 100;
}

function calculateTopNWeightedScoreFromActualRanks(predictions, actualRankMap, n) {
  if (!predictions.length || !actualRankMap || actualRankMap.size === 0) return 0;
  const hasRank = predictions.some(p => typeof p.rank === 'number');
  const sortedPredictions = hasRank
    ? [...predictions].filter(p => typeof p.rank === 'number').sort((a, b) => (a.rank || 0) - (b.rank || 0))
    : [...predictions];

  const gain = finishRank => {
    if (!finishRank || Number.isNaN(finishRank) || finishRank > n) return 0;
    return (n - finishRank + 1);
  };

  const topPredictions = sortedPredictions.filter(p => actualRankMap.has(String(p.dgId))).slice(0, n);
  const dcg = topPredictions.reduce((sum, player, index) => {
    const finishRank = actualRankMap.get(String(player.dgId));
    const rel = gain(finishRank);
    return sum + (rel / Math.log2(index + 2));
  }, 0);

  const ideal = Array.from(actualRankMap.entries())
    .filter(([, rank]) => typeof rank === 'number' && rank <= n)
    .sort((a, b) => a[1] - b[1])
    .slice(0, n);

  const idcg = ideal.reduce((sum, [, rank], index) => {
    const rel = gain(rank);
    return sum + (rel / Math.log2(index + 2));
  }, 0);

  if (idcg === 0) return 0;
  return (dcg / idcg) * 100;
}

function parseFinishStatus(posValue) {
  const posStr = String(posValue || '').trim().toUpperCase();
  if (!posStr) return { position: null, isCut: false, status: null };
  if (posStr.startsWith('T') && posStr.length > 1) {
    const tied = parseInt(posStr.substring(1), 10);
    if (Number.isFinite(tied)) return { position: tied, isCut: false, status: 'FINISHED' };
  }
  const parsed = parseInt(posStr, 10);
  if (Number.isFinite(parsed)) return { position: parsed, isCut: false, status: 'FINISHED' };
  if (['CUT', 'MC', 'WD', 'DQ'].includes(posStr)) {
    return { position: null, isCut: true, status: posStr };
  }
  return { position: null, isCut: false, status: 'UNKNOWN' };
}

function parseFinishPosition(posValue) {
  return parseFinishStatus(posValue).position;
}

function buildFinishPositionMap(results) {
  const positions = (results || [])
    .map(result => result?.finishPosition)
    .filter(value => typeof value === 'number' && !Number.isNaN(value));
  const fallback = positions.length ? Math.max(...positions) + 1 : null;
  const map = new Map();

  (results || []).forEach(result => {
    const dgId = String(result?.dgId || '').trim();
    if (!dgId) return;
    const rawValue = result?.finishPosition;
    const finishPosition = typeof rawValue === 'number' && !Number.isNaN(rawValue)
      ? rawValue
      : fallback;
    if (typeof finishPosition === 'number' && !Number.isNaN(finishPosition)) {
      map.set(dgId, finishPosition);
    }
  });

  return { map, fallback };
}

function evaluateRankings(predictions, actualResults, options = {}) {
  const { includeTopN = true, includeTopNDetails = false, includeAdjusted = true } = options;
  const { map: resultsById } = buildFinishPositionMap(actualResults);
  const scores = [];
  const positions = [];
  const errors = [];
  const matched = [];
  
  predictions.forEach((pred, idx) => {
    const actualFinish = resultsById.get(String(pred.dgId));
    if (typeof actualFinish === 'number' && !Number.isNaN(actualFinish)) {
      const rankValue = typeof pred.rank === 'number' ? pred.rank : (idx + 1);
      scores.push(rankValue);
      positions.push(actualFinish);
      errors.push(rankValue - actualFinish);
      matched.push({ dgId: String(pred.dgId), predRank: rankValue, actualFinish: actualFinish });
    }
  });
  
  if (scores.length === 0) {
    return {
      correlation: 0,
      rmse: 0,
      rSquared: 0,
      meanError: 0,
      stdDevError: 0,
      mae: 0,
      top10: includeTopN ? 0 : null,
      top20: includeTopN ? 0 : null,
      top20WeightedScore: includeTopN ? 0 : null,
      matchedPlayers: 0
    };
  }
  
  const correlation = calculateSpearmanCorrelation(scores, positions);
  const rmse = Math.sqrt(
    scores.reduce((sum, s, i) => sum + Math.pow(s - positions[i], 2), 0) / scores.length
  );
  
  const meanError = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const stdDevError = Math.sqrt(
    errors.reduce((sum, value) => sum + Math.pow(value - meanError, 2), 0) / errors.length
  );
  const mae = errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length;

  const evaluation = {
    correlation,
    rmse,
    rSquared: correlation * correlation,
    meanError,
    stdDevError,
    mae,
    top10: includeTopN ? calculateTopNAccuracy(predictions, actualResults, 10) : null,
    top20: includeTopN ? calculateTopNAccuracy(predictions, actualResults, 20) : null,
    top20WeightedScore: includeTopN ? calculateTopNWeightedScore(predictions, actualResults, 20) : null,
    matchedPlayers: scores.length
  };

  if (includeAdjusted && matched.length > 0) {
    const sortedByFinish = [...matched].sort((a, b) => a.actualFinish - b.actualFinish);
    const actualSubsetRankMap = new Map();
    sortedByFinish.forEach((entry, index) => {
      actualSubsetRankMap.set(entry.dgId, index + 1);
    });

    const subsetScores = [];
    const subsetPositions = [];
    const subsetErrors = [];
    matched.forEach(entry => {
      const actualRank = actualSubsetRankMap.get(entry.dgId);
      if (!actualRank) return;
      subsetScores.push(entry.predRank);
      subsetPositions.push(actualRank);
      subsetErrors.push(entry.predRank - actualRank);
    });

    const subsetCorrelation = calculateSpearmanCorrelation(subsetScores, subsetPositions);
    const subsetRmse = Math.sqrt(
      subsetScores.reduce((sum, s, i) => sum + Math.pow(s - subsetPositions[i], 2), 0) / subsetScores.length
    );
    const subsetMeanError = subsetErrors.reduce((sum, value) => sum + value, 0) / subsetErrors.length;
    const subsetStdDev = Math.sqrt(
      subsetErrors.reduce((sum, value) => sum + Math.pow(value - subsetMeanError, 2), 0) / subsetErrors.length
    );
    const subsetMae = subsetErrors.reduce((sum, value) => sum + Math.abs(value), 0) / subsetErrors.length;
    const subsetTop10 = includeTopN ? calculateTopNAccuracyFromActualRanks(predictions, actualSubsetRankMap, 10) : null;
    const subsetTop20 = includeTopN ? calculateTopNAccuracyFromActualRanks(predictions, actualSubsetRankMap, 20) : null;
    const subsetTop20Weighted = includeTopN ? calculateTopNWeightedScoreFromActualRanks(predictions, actualSubsetRankMap, 20) : null;

    const denom = subsetScores.length > 1 ? (subsetScores.length - 1) : 1;
    const predPercentiles = subsetScores.map(rank => (rank - 1) / denom);
    const actualPercentiles = subsetPositions.map(rank => (rank - 1) / denom);
    const pctErrors = predPercentiles.map((value, idx) => value - actualPercentiles[idx]);
    const pctCorrelation = calculateSpearmanCorrelation(predPercentiles, actualPercentiles);
    const pctRmse = Math.sqrt(
      predPercentiles.reduce((sum, value, idx) => sum + Math.pow(value - actualPercentiles[idx], 2), 0) / predPercentiles.length
    );
    const pctMeanError = pctErrors.reduce((sum, value) => sum + value, 0) / pctErrors.length;
    const pctStdDev = Math.sqrt(
      pctErrors.reduce((sum, value) => sum + Math.pow(value - pctMeanError, 2), 0) / pctErrors.length
    );
    const pctMae = pctErrors.reduce((sum, value) => sum + Math.abs(value), 0) / pctErrors.length;

    evaluation.adjusted = {
      subset: {
        correlation: subsetCorrelation,
        rmse: subsetRmse,
        rSquared: subsetCorrelation * subsetCorrelation,
        meanError: subsetMeanError,
        stdDevError: subsetStdDev,
        mae: subsetMae,
        top10: subsetTop10,
        top20: subsetTop20,
        top20WeightedScore: subsetTop20Weighted
      },
      percentile: {
        correlation: pctCorrelation,
        rmse: pctRmse,
        rSquared: pctCorrelation * pctCorrelation,
        meanError: pctMeanError,
        stdDevError: pctStdDev,
        mae: pctMae
      }
    };
  }

  if (includeTopN && includeTopNDetails) {
    const hasRank = predictions.some(p => typeof p.rank === 'number');
    const sortedPredictions = hasRank
      ? [...predictions].filter(p => typeof p.rank === 'number').sort((a, b) => (a.rank || 0) - (b.rank || 0))
      : [...predictions];
    const buildTopNDetails = n => {
      const predictedTopN = sortedPredictions.slice(0, n).map(p => String(p.dgId));
      const actualTopN = actualResults
        .filter(result => result.finishPosition && !Number.isNaN(result.finishPosition) && result.finishPosition <= n)
        .sort((a, b) => a.finishPosition - b.finishPosition)
        .map(result => String(result.dgId));
      const actualTopNSet = new Set(actualTopN);
      const overlap = predictedTopN.filter(id => actualTopNSet.has(id));
      return {
        predicted: predictedTopN,
        actual: actualTopN,
        overlap,
        overlapCount: overlap.length
      };
    };
    evaluation.top10Details = buildTopNDetails(10);
    evaluation.top20Details = buildTopNDetails(20);
  }

  return evaluation;
}

function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function buildRunFingerprint({
  eventId,
  season,
  tournament,
  optSeed,
  tests,
  dryRun,
  includeCurrentEventRounds,
  templateOverride,
  filePaths,
  validationPaths
}) {
  const fileHashes = {};
  (filePaths || []).forEach(entry => {
    if (!entry || !entry.label) return;
    fileHashes[entry.label] = {
      path: entry.path ? path.basename(entry.path) : null,
      sha256: hashFile(entry.path)
    };
  });
  (validationPaths || []).forEach(entry => {
    if (!entry || !entry.label) return;
    fileHashes[entry.label] = {
      path: entry.path ? path.basename(entry.path) : null,
      sha256: hashFile(entry.path)
    };
  });

  return {
    algorithm: 'sha256',
    createdAt: formatTimestamp(new Date()),
    eventId,
    season,
    tournament: tournament || null,
    optSeed: optSeed || null,
    tests: tests || null,
    dryRun: !!dryRun,
    includeCurrentEventRounds,
    templateOverride: templateOverride || null,
    files: fileHashes
  };
}

function ensureDirectory(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  if (!filePath) return;
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function loadCourseHistoryRegressionMap(options = {}) {
  const { outputDir = null } = options;
  const candidates = [];
  const addCandidate = value => {
    if (!value) return;
    const resolved = path.resolve(value);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };

  addCandidate(outputDir ? path.resolve(outputDir, 'course_history_regression.json') : null);
  addCandidate(OUTPUT_DIR ? path.resolve(OUTPUT_DIR, 'course_history_regression.json') : null);
  addCandidate(path.resolve(ROOT_DIR, 'output', 'course_history_regression.json'));

  const preTournamentOutputDir = String(process.env.PRE_TOURNAMENT_OUTPUT_DIR || '').trim();
  if (preTournamentOutputDir) {
    addCandidate(path.resolve(preTournamentOutputDir, 'course_history_regression.json'));
  }

  const addSiblingPreEvent = dirPath => {
    if (!dirPath) return;
    const normalized = path.resolve(dirPath);
    const base = path.basename(normalized);
    if (base !== 'post_event') return;
    const sibling = path.resolve(path.dirname(normalized), 'pre_event', 'course_history_regression.json');
    addCandidate(sibling);
  };
  addSiblingPreEvent(outputDir);
  addSiblingPreEvent(OUTPUT_DIR);

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const payload = readJsonFile(filePath);
    if (payload && typeof payload === 'object') {
      return { map: payload, source: 'json', path: filePath };
    }
  }

  try {
    const regressionUtil = require('../utilities/courseHistoryRegression');
    const fallbackMap = typeof regressionUtil.getCourseHistoryRegressionMap === 'function'
      ? regressionUtil.getCourseHistoryRegressionMap()
      : regressionUtil.COURSE_HISTORY_REGRESSION;
    if (fallbackMap && typeof fallbackMap === 'object') {
      return {
        map: fallbackMap,
        source: 'utility',
        path: path.resolve(ROOT_DIR, 'utilities', 'courseHistoryRegression.js')
      };
    }
  } catch (error) {
    return null;
  }

  return null;
}

function loadRampSummary(options = {}) {
  const { outputDir = null, metric = 'sg_total' } = options;
  const normalizedMetric = String(metric || 'sg_total').trim().toLowerCase() || 'sg_total';
  const fileName = `early_season_ramp_${normalizedMetric}.json`;
  const candidates = [];
  const addCandidate = value => {
    if (!value) return;
    const resolved = path.resolve(value);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };

  addCandidate(outputDir ? path.resolve(outputDir, fileName) : null);
  addCandidate(OUTPUT_DIR ? path.resolve(OUTPUT_DIR, fileName) : null);
  addCandidate(path.resolve(ROOT_DIR, 'output', fileName));

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const payload = readJsonFile(filePath);
    if (payload && typeof payload === 'object') {
      return { payload, path: filePath };
    }
  }

  return null;
}

function ensureEarlySeasonRampSummary(options = {}) {
  const { outputDir = null, metric = 'sg_total', dataDir = null, apiYears = null } = options;
  if (!outputDir) return loadRampSummary({ outputDir, metric });
  const existing = loadRampSummary({ outputDir, metric });
  if (existing) return existing;

  console.log(`ℹ️  Early-season ramp summary missing; generating (${metric}).`);
  const originalArgv = process.argv.slice();
  try {
    const scriptPath = path.resolve(__dirname, '..', 'scripts', 'analyze_early_season_ramp.js');
    const scriptArgs = [
      scriptPath,
      '--outputDir',
      outputDir,
      '--metric',
      String(metric || 'sg_total').trim().toLowerCase()
    ];
    if (apiYears) {
      scriptArgs.push('--apiYears', String(apiYears).trim());
    }
    if (dataDir) {
      scriptArgs.push('--dataDir', dataDir);
    }
    process.argv = ['node', ...scriptArgs];
    delete require.cache[require.resolve('../scripts/analyze_early_season_ramp')];
    require('../scripts/analyze_early_season_ramp');
  } catch (error) {
    console.warn(`ℹ️  Early-season ramp generation failed: ${error.message}`);
  } finally {
    process.argv = originalArgv;
  }

  return loadRampSummary({ outputDir, metric });
}

function computePastPerformanceWeightFromRegression(entry) {
  if (!entry) return null;
  const slope = Number(entry.slope);
  const pValue = Number(entry.pValue);
  if (!Number.isFinite(slope) || !Number.isFinite(pValue)) return null;
  if (slope >= 0 || pValue >= 0.2) return 0.10;
  if (pValue <= 0.01) {
    if (slope <= -3.0) return 0.40;
    if (slope <= -1.5) return 0.30;
    return 0.25;
  }
  if (pValue <= 0.05) {
    if (slope <= -2.0) return 0.30;
    if (slope <= -1.0) return 0.25;
    return 0.20;
  }
  if (pValue <= 0.10) {
    if (slope <= -1.0) return 0.20;
    return 0.15;
  }
  return 0.10;
}

function loadCourseContext(filePath) {
  const payload = readJsonFile(filePath);
  if (!payload || typeof payload !== 'object') return null;
  return payload;
}

function resolveCourseNumFromContextEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.courseNum !== undefined && entry.courseNum !== null) {
    return String(entry.courseNum).trim();
  }
  if (Array.isArray(entry.courseNums) && entry.courseNums.length > 0) {
    return String(entry.courseNums[0]).trim();
  }
  return null;
}

function upsertCourseContextPastPerformanceWeights(courseContext, regressionMap) {
  if (!courseContext || typeof courseContext !== 'object') {
    return { updated: false, updates: [], context: courseContext };
  }
  if (!regressionMap || typeof regressionMap !== 'object') {
    return { updated: false, updates: [], context: courseContext };
  }

  const updates = [];
  let updated = false;

  const applyWeight = (entry, location, courseNumOverride = null) => {
    if (!entry || typeof entry !== 'object') return;
    if (entry.pastPerformance === false) return;
    const courseNum = courseNumOverride || resolveCourseNumFromContextEntry(entry);
    if (!courseNum) return;
    const regressionEntry = regressionMap[courseNum];
    if (!regressionEntry) return;
    const weight = computePastPerformanceWeightFromRegression(regressionEntry);
    if (weight === null) return;
    const existingWeight = typeof entry.pastPerformanceWeight === 'number' ? entry.pastPerformanceWeight : null;
    if (existingWeight !== null && Math.abs(existingWeight - weight) < 1e-6) return;
    entry.pastPerformanceWeight = weight;
    updates.push({
      location,
      courseNum,
      weight,
      slope: regressionEntry.slope,
      pValue: regressionEntry.pValue
    });
    updated = true;
  };

  if (courseContext.byEventId && typeof courseContext.byEventId === 'object') {
    Object.entries(courseContext.byEventId).forEach(([eventId, entry]) => {
      applyWeight(entry, `event:${eventId}`);
    });
  }

  if (courseContext.byCourseNum && typeof courseContext.byCourseNum === 'object') {
    Object.entries(courseContext.byCourseNum).forEach(([courseNum, entry]) => {
      applyWeight(entry, `course:${courseNum}`, String(courseNum).trim());
    });
  }

  if (updated) {
    courseContext.updatedAt = formatTimestamp(new Date());
  }

  return { updated, updates, context: courseContext };
}

function resolveCourseContextEntry(context, options = {}) {
  if (!context || typeof context !== 'object') return null;
  const eventId = options.eventId ? String(options.eventId).trim() : null;
  const courseNum = options.courseNum ? String(options.courseNum).trim() : null;

  if (eventId && context.byEventId && context.byEventId[eventId]) {
    return { ...context.byEventId[eventId], source: 'eventId' };
  }
  if (courseNum && context.byCourseNum && context.byCourseNum[courseNum]) {
    return { ...context.byCourseNum[courseNum], source: 'courseNum' };
  }
  return null;
}

function applyCourseContextOverrides(sharedConfig, overrides) {
  if (!sharedConfig || !overrides) return false;
  let applied = false;

  if (Array.isArray(overrides.similarCourseIds) && overrides.similarCourseIds.length > 0) {
    sharedConfig.similarCourseIds = overrides.similarCourseIds;
    applied = true;
  }
  if (Array.isArray(overrides.puttingCourseIds) && overrides.puttingCourseIds.length > 0) {
    sharedConfig.puttingCourseIds = overrides.puttingCourseIds;
    applied = true;
  }
  if (typeof overrides.similarCoursesWeight === 'number' && Number.isFinite(overrides.similarCoursesWeight)) {
    sharedConfig.similarCoursesWeight = overrides.similarCoursesWeight;
    applied = true;
  }
  if (typeof overrides.puttingCoursesWeight === 'number' && Number.isFinite(overrides.puttingCoursesWeight)) {
    sharedConfig.puttingCoursesWeight = overrides.puttingCoursesWeight;
    applied = true;
  }

  if (overrides.shotDistribution && typeof overrides.shotDistribution === 'object') {
    sharedConfig.courseSetupWeights = {
      ...sharedConfig.courseSetupWeights,
      ...overrides.shotDistribution
    };
    applied = true;
  }

  return applied;
}

function buildSharedConfigFromCourseContext(entry, fallbackEventId) {
  if (!entry) return null;
  const defaultWeights = {
    under100: 0,
    from100to150: 0,
    from150to200: 0,
    over200: 0
  };
  const safeShotDistribution = entry.shotDistribution && typeof entry.shotDistribution === 'object'
    ? entry.shotDistribution
    : defaultWeights;

  return {
    cells: [],
    getCell: () => null,
    currentEventId: String(entry.eventId || fallbackEventId || ''),
    similarCourseIds: Array.isArray(entry.similarCourseIds) ? entry.similarCourseIds : [],
    puttingCourseIds: Array.isArray(entry.puttingCourseIds) ? entry.puttingCourseIds : [],
    similarCoursesWeight: typeof entry.similarCoursesWeight === 'number' ? entry.similarCoursesWeight : 0.7,
    puttingCoursesWeight: typeof entry.puttingCoursesWeight === 'number' ? entry.puttingCoursesWeight : 0.75,
    courseSetupWeights: safeShotDistribution,
    pastPerformanceEnabled: !!entry.pastPerformance,
    pastPerformanceWeight: typeof entry.pastPerformanceWeight === 'number' ? entry.pastPerformanceWeight : 0,
    courseNameRaw: entry.courseNameKey || null,
    courseNameKey: entry.courseNameKey || null,
    courseType: entry.courseType || null,
    courseNum: entry.courseNum || null
  };
}

function extractFieldRowsFromSnapshotPayload(payload) {
  if (!payload) return [];
  const candidates = Array.isArray(payload.field)
    ? payload.field
    : (Array.isArray(payload.players)
      ? payload.players
      : (Array.isArray(payload.data) ? payload.data : (Array.isArray(payload) ? payload : [])));
  return candidates;
}

function normalizeFieldRow(row) {
  if (!row || typeof row !== 'object') return null;
  const dgId = row.dg_id || row.dgId || row.player_id || row.playerId || row.id;
  if (!dgId) return null;
  return {
    ...row,
    dg_id: String(dgId).trim(),
    player_name: row.player_name || row.playerName || row.name || null
  };
}

function normalizeHistoricalRoundRow(row) {
  if (!row || typeof row !== 'object') return null;
  const dgId = row.dg_id || row.dgId || row.player_id || row.playerId || row.id;
  const eventId = row.event_id || row.eventId || row.tournament_id || row.tournamentId;
  if (!dgId || !eventId) return null;
  const yearValue = row.year ?? row.season ?? row.season_year ?? row.seasonYear;
  const roundNum = row.round_num ?? row.roundNum ?? row.round;
  const finText = row.fin_text ?? row.finish ?? row.finishPosition ?? row.fin;
  const eventCompleted = row.event_completed ?? row.eventCompleted ?? row.end_date ?? row.completed;
  return {
    ...row,
    dg_id: String(dgId).trim(),
    player_name: row.player_name || row.playerName || row.name || null,
    event_id: String(eventId).trim(),
    year: yearValue ?? row.year,
    season: row.season ?? row.year ?? yearValue,
    round_num: roundNum ?? row.round_num,
    fin_text: finText ?? row.fin_text,
    event_completed: eventCompleted ?? row.event_completed
  };
}

function hasHistoricalResultsInCache({ cacheDir, tour, eventId, season }) {
  if (!cacheDir || !eventId || !season) return false;
  const cachePaths = buildHistoricalCachePaths({
    cacheDir,
    tours: [tour || 'pga'],
    years: [season],
    eventId: 'all',
    fileFormat: 'json'
  });
  const cachePath = Array.isArray(cachePaths) && cachePaths.length > 0 ? cachePaths[0] : null;
  if (!cachePath || !fs.existsSync(cachePath)) return false;
  const payload = readJsonFile(cachePath);
  if (!payload) return false;
  const eventKey = String(eventId || '').trim();
  const directEvent = payload?.[eventKey] || null;
  const directScores = Array.isArray(directEvent?.scores) ? directEvent.scores : null;
  if (directScores && directScores.some(entry => entry && entry.fin_text)) return true;
  const rows = extractHistoricalRowsFromSnapshotPayload(payload)
    .map(normalizeHistoricalRoundRow)
    .filter(Boolean);
  return rows.some(row => {
    const rowEvent = String(row?.event_id || '').trim();
    if (rowEvent !== eventKey) return false;
    const rowSeason = String(row?.season || row?.year || '').trim();
    if (String(season).trim() && rowSeason !== String(season).trim()) return false;
    return !!normalizeFinishPosition(row?.fin_text);
  });
}

function resolveApproachOverrideEntry(rawPath, sourceLabel) {
  if (!rawPath) return null;
  const resolved = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(ROOT_DIR, rawPath);
  if (!fs.existsSync(resolved)) return null;
  let time = 0;
  try {
    time = fs.statSync(resolved).mtimeMs || 0;
  } catch (error) {
    time = 0;
  }
  return {
    path: resolved,
    time,
    date: null,
    source: sourceLabel || 'approach_override',
    priority: 9
  };
}

function resolveApproachCsvForEntry(entry, season) {
  if (!entry) return null;
  const tournamentDir = resolveTournamentDir(season, entry.tournamentName, entry.tournamentSlug);
  const inputsDir = tournamentDir ? path.resolve(tournamentDir, 'inputs') : null;
  const entryInputsDir = inputsDir && fs.existsSync(inputsDir) ? inputsDir : null;
  const entrySearchDir = entryInputsDir || (tournamentDir && fs.existsSync(tournamentDir) ? tournamentDir : null);
  let approachPath = resolveTournamentFile('Approach Skill', entry.tournamentName, season, entry.tournamentSlug);
  if (!approachPath || !fs.existsSync(approachPath)) {
    const slugFallback = resolveTournamentFile('Approach Skill', entry.tournamentSlug, season, null);
    if (slugFallback && fs.existsSync(slugFallback)) {
      approachPath = slugFallback;
    }
  }
  const normalizedApproachPath = approachPath ? path.resolve(approachPath) : null;
  const entryPathMismatch = normalizedApproachPath && entrySearchDir
    ? !normalizedApproachPath.startsWith(path.resolve(entrySearchDir) + path.sep)
    : false;
  if ((!approachPath || !fs.existsSync(approachPath)) || entryPathMismatch) {
    approachPath = null;
    if (entrySearchDir) {
      const candidates = fs.readdirSync(entrySearchDir)
        .filter(name => name.toLowerCase().endsWith('.csv') && name.toLowerCase().includes('approach skill'))
        .map(name => ({
          name,
          path: path.resolve(entrySearchDir, name),
          mtimeMs: (() => {
            try {
              return fs.statSync(path.resolve(entrySearchDir, name)).mtimeMs || 0;
            } catch (error) {
              return 0;
            }
          })()
        }))
        .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
      if (candidates.length > 0) {
        approachPath = candidates[0].path;
      }
    }
  }
  if (!approachPath || !fs.existsSync(approachPath)) return null;
  const time = parseDateToUtcMs(entry.date);
  if (Number.isNaN(time)) return null;
  return {
    path: approachPath,
    time,
    date: entry.date,
    source: 'approach_csv_manifest',
    priority: 1
  };
}

function buildManifestApproachCsvFallback({ dataRootDir, season, eventId, tournamentSlug, tournamentName }) {
  const entries = loadSeasonManifestEntries(dataRootDir, season);
  if (!entries.length) return { pre: null, post: null, currentEntry: null, nextEntry: null, entries };
  const currentEntry = resolveManifestEntryForEvent(entries, { eventId, tournamentSlug, tournamentName });
  if (!currentEntry) return { pre: null, post: null, currentEntry: null, nextEntry: null, entries };
  const nextEntry = resolveNextManifestEntry(entries, currentEntry);
  const previousEntry = resolvePreviousManifestEntry(entries, currentEntry);
  const pre = resolveApproachCsvForEntry(previousEntry, season);
  const post = resolveApproachCsvForEntry(currentEntry, season);
  const eventPre = resolveApproachCsvForEntry(currentEntry, season);
  const eventPost = resolveApproachCsvForEntry(nextEntry, season);
  return {
    pre,
    post,
    eventPre,
    eventPost,
    currentEntry,
    nextEntry,
    entries
  };
}

function hasSnapshotArchiveForDate(candidates, date) {
  if (!date) return false;
  return (candidates || []).some(entry => entry?.source === 'snapshot_archive' && entry?.date === date);
}

function listApproachSnapshotArchives() {
  if (!APPROACH_SNAPSHOT_DIR || !fs.existsSync(APPROACH_SNAPSHOT_DIR)) return [];
  const entries = [];
  const files = fs.readdirSync(APPROACH_SNAPSHOT_DIR);
  files.forEach(name => {
    if (!name.toLowerCase().endsWith('.json')) return;
    const lower = name.toLowerCase();
    if (lower === 'approach_l24.json' || lower === 'approach_l12.json' || lower === 'approach_ytd_latest.json') return;
    const match = name.match(/^approach_([a-z0-9]+)_(\d{4}-\d{2}-\d{2})\.json$/i);
    if (!match) return;
    const period = String(match[1] || '').toLowerCase();
    const dateStamp = match[2];
    const time = Date.parse(`${dateStamp}T00:00:00Z`);
    entries.push({
      period,
      name,
      path: path.resolve(APPROACH_SNAPSHOT_DIR, name),
      time: Number.isNaN(time) ? 0 : time
    });
  });
  entries.sort((a, b) => (b.time || 0) - (a.time || 0));
  return entries;
}

function buildApproachSnapshotCandidates({ dataRootDir, season, manifestEntries = null }) {
  const entries = Array.isArray(manifestEntries) && manifestEntries.length
    ? manifestEntries
    : loadSeasonManifestEntries(dataRootDir, season);
  const candidates = [];
  const seen = new Set();

  listApproachSnapshotArchives()
    .filter(entry => entry.period === 'ytd')
    .forEach(entry => {
      if (!entry?.path || seen.has(entry.path)) return;
      seen.add(entry.path);
      candidates.push({
        path: entry.path,
        time: entry.time || 0,
        date: entry.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || null,
        source: 'snapshot_archive',
        priority: 3
      });
    });

  if (APPROACH_SNAPSHOT_YTD_LATEST_PATH && fs.existsSync(APPROACH_SNAPSHOT_YTD_LATEST_PATH)) {
    const latestTime = resolveApproachSnapshotTimestamp(APPROACH_SNAPSHOT_YTD_LATEST_PATH);
    if (!seen.has(APPROACH_SNAPSHOT_YTD_LATEST_PATH)) {
      seen.add(APPROACH_SNAPSHOT_YTD_LATEST_PATH);
      candidates.push({
        path: APPROACH_SNAPSHOT_YTD_LATEST_PATH,
        time: latestTime || 0,
        date: null,
        source: 'snapshot_latest',
        priority: 2
      });
    }
  }

  entries.forEach(entry => {
    const eventTime = parseDateToUtcMs(entry.date);
    if (Number.isNaN(eventTime)) return;
    const approachPath = resolveTournamentFile('Approach Skill', entry.tournamentName, season, entry.tournamentSlug);
    if (!approachPath || !fs.existsSync(approachPath) || seen.has(approachPath)) return;
    seen.add(approachPath);
    candidates.push({
      path: approachPath,
      time: eventTime,
      date: entry.date,
      source: 'approach_csv',
      priority: 1
    });
  });

  return candidates.filter(entry => typeof entry.time === 'number' && entry.time > 0);
}

function selectApproachSnapshotsForEvent({ eventDateMs, candidates }) {
  if (!eventDateMs || Number.isNaN(eventDateMs)) return { pre: null, post: null };
  const valid = (candidates || []).filter(entry => typeof entry?.time === 'number' && entry.time > 0);
  const pre = valid
    .filter(entry => entry.time <= eventDateMs)
    .sort((a, b) => (b.time - a.time) || ((b.priority || 0) - (a.priority || 0)))[0] || null;
  const post = valid
    .filter(entry => entry.time > eventDateMs)
    .sort((a, b) => (a.time - b.time) || ((b.priority || 0) - (a.priority || 0)))[0] || null;
  return { pre, post };
}

function selectApproachArchiveForEvent({ eventDateMs, period = 'ytd' }) {
  if (!eventDateMs || Number.isNaN(eventDateMs)) return null;
  const archives = listApproachSnapshotArchives().filter(entry => entry.period === period);
  if (archives.length === 0) return null;
  const after = archives
    .filter(entry => (entry.time || 0) > eventDateMs)
    .sort((a, b) => (a.time || 0) - (b.time || 0));
  if (after.length > 0) return after[0];
  const before = archives
    .filter(entry => (entry.time || 0) <= eventDateMs)
    .sort((a, b) => (b.time || 0) - (a.time || 0));
  return before[0] || null;
}

function resolveLatestApproachArchiveYear(period) {
  const normalized = String(period || '').trim().toLowerCase();
  if (!normalized) return null;
  const entries = listApproachSnapshotArchives().filter(entry => entry.period === normalized);
  if (entries.length === 0) return null;
  const latest = entries[0];
  if (!latest?.time) return null;
  const year = new Date(latest.time).getUTCFullYear();
  return Number.isNaN(year) ? null : year;
}

function resolveLatestApproachSnapshotArchive(period) {
  const normalized = String(period || '').trim().toLowerCase();
  if (!normalized) return null;
  const entries = listApproachSnapshotArchives().filter(entry => entry.period === normalized);
  if (entries.length === 0) return null;
  const latest = entries[0];
  if (!latest?.path || !fs.existsSync(latest.path)) return null;
  const snapshot = loadApproachSnapshotFromDisk(latest.path);
  if (!snapshot?.payload) return null;
  return { ...snapshot, source: 'snapshot_archive', path: latest.path };
}

function pruneApproachSnapshotArchives() {
  const archives = listApproachSnapshotArchives();
  if (archives.length === 0) return { removed: 0, kept: 0 };

  const byPeriod = archives.reduce((acc, entry) => {
    if (!acc[entry.period]) acc[entry.period] = [];
    acc[entry.period].push(entry);
    return acc;
  }, {});

  let removed = 0;
  Object.entries(byPeriod).forEach(([period, entries]) => {
    const retentionCount = APPROACH_SNAPSHOT_RETENTION_COUNTS[period];
    if (!retentionCount) return;
    const sorted = entries.sort((a, b) => b.time - a.time);
    const keepSet = new Set(sorted.slice(0, retentionCount).map(entry => entry.path));
    sorted.forEach((entry, index) => {
      if (index < retentionCount || keepSet.has(entry.path)) return;
      try {
        fs.unlinkSync(entry.path);
        removed += 1;
      } catch (error) {
        console.warn(`⚠️  Unable to remove approach snapshot archive ${entry.name}: ${error.message}`);
      }
    });
  });

  const kept = Math.max(0, archives.length - removed);
  return { removed, kept };
}

function loadApproachSnapshotFromDisk(snapshotPath) {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) return { source: 'missing', path: snapshotPath, payload: null };
  const payload = readJsonFile(snapshotPath);
  if (!payload) return { source: 'invalid-json', path: snapshotPath, payload: null };
  return { source: 'snapshot', path: snapshotPath, payload };
}

async function getOrCreateApproachSnapshot({ period, snapshotPath, apiKey, cacheDir, ttlMs, season, eventId, isPostTournament }) {
  const loadSnapshot = (pathValue) => {
    if (typeof loadApproachSnapshotFromDisk === 'function') {
      return loadApproachSnapshotFromDisk(pathValue);
    }
    if (!pathValue || !fs.existsSync(pathValue)) return { source: 'missing', path: pathValue, payload: null };
    const payload = readJsonFile(pathValue);
    if (!payload) return { source: 'invalid-json', path: pathValue, payload: null };
    return { source: 'snapshot', path: pathValue, payload };
  };
  const normalizedPeriod = String(period || '').trim().toLowerCase();
  const useArchiveAsCurrent = normalizedPeriod === 'l12' || normalizedPeriod === 'l24';
  const latestArchive = useArchiveAsCurrent
    ? listApproachSnapshotArchives().find(entry => entry.period === normalizedPeriod)
    : null;

  if (!useArchiveAsCurrent && snapshotPath && fs.existsSync(snapshotPath)) {
    if (normalizedPeriod !== 'l12') {
      return loadSnapshot(snapshotPath);
    }

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const seasonValue = season ? parseInt(String(season).trim(), 10) : null;
    const eventIdValue = eventId ? String(eventId).trim() : null;
    const latestYear = resolveLatestApproachArchiveYear('l12');
    const forceRefresh = APPROACH_L12_FORCE_REFRESH === '1'
      || APPROACH_L12_FORCE_REFRESH === 'true'
      || (APPROACH_L12_REFRESH_SEASON && seasonValue && String(seasonValue) === APPROACH_L12_REFRESH_SEASON);
    const isTourChampEvent = eventIdValue && APPROACH_L12_REFRESH_EVENT_ID
      ? eventIdValue === APPROACH_L12_REFRESH_EVENT_ID
      : false;
    const allowRefresh = !!isPostTournament;
    const shouldRefresh = (forceRefresh && allowRefresh)
      || (allowRefresh && isTourChampEvent)
      || (allowRefresh && seasonValue && latestYear && seasonValue > latestYear && month >= APPROACH_L12_REFRESH_MONTH);

    if (!shouldRefresh) {
      return loadSnapshot(snapshotPath);
    }
    console.log('ℹ️  Refreshing L12 snapshot for end-of-season update.');
  }

  if (useArchiveAsCurrent && latestArchive?.path && fs.existsSync(latestArchive.path)) {
    return loadSnapshot(latestArchive.path);
  }

  const fetched = await getDataGolfApproachSkill({
    apiKey,
    cacheDir,
    ttlMs,
    allowStale: true,
    period,
    fileFormat: 'json'
  });

  if (fetched?.payload) {
    const archiveStamp = formatDateKey(new Date());
    if (normalizedPeriod === 'ytd') {
      if (snapshotPath) {
        writeJsonFile(snapshotPath, fetched.payload);
      }
      const archivePath = path.resolve(APPROACH_SNAPSHOT_DIR, `approach_${normalizedPeriod}_${archiveStamp}.json`);
      if (!fs.existsSync(archivePath)) {
        writeJsonFile(archivePath, fetched.payload);
      }
      pruneApproachSnapshotArchives();
      return { ...fetched, path: snapshotPath };
    }

    const archivePath = path.resolve(APPROACH_SNAPSHOT_DIR, `approach_${normalizedPeriod || 'snapshot'}_${archiveStamp}.json`);
    if (!fs.existsSync(archivePath)) {
      writeJsonFile(archivePath, fetched.payload);
    }
    return { ...fetched, path: archivePath };
  }

  if (!useArchiveAsCurrent && snapshotPath && fs.existsSync(snapshotPath)) {
    pruneApproachSnapshotArchives();
    return { source: 'snapshot-stale', path: snapshotPath, payload: readJsonFile(snapshotPath) };
  }

  if (useArchiveAsCurrent && latestArchive?.path && fs.existsSync(latestArchive.path)) {
    pruneApproachSnapshotArchives();
    return { source: 'snapshot-archive', path: latestArchive.path, payload: readJsonFile(latestArchive.path) };
  }

  return fetched;
}

async function refreshYtdApproachSnapshot({ apiKey, cacheDir, ttlMs }) {
  const fetched = await getDataGolfApproachSkill({
    apiKey,
    cacheDir,
    ttlMs,
    allowStale: true,
    period: 'ytd',
    fileFormat: 'json'
  });

  if (fetched?.payload) {
    writeJsonFile(APPROACH_SNAPSHOT_YTD_LATEST_PATH, fetched.payload);
    const archiveStamp = formatDateKey(new Date());
    const archivePath = path.resolve(APPROACH_SNAPSHOT_DIR, `approach_ytd_${archiveStamp}.json`);
    if (!fs.existsSync(archivePath)) {
      writeJsonFile(archivePath, fetched.payload);
    }
    pruneApproachSnapshotArchives();
    return { ...fetched, path: APPROACH_SNAPSHOT_YTD_LATEST_PATH, archivePath };
  }

  if (fs.existsSync(APPROACH_SNAPSHOT_YTD_LATEST_PATH)) {
    pruneApproachSnapshotArchives();
    return {
      source: 'snapshot',
      path: APPROACH_SNAPSHOT_YTD_LATEST_PATH,
      payload: readJsonFile(APPROACH_SNAPSHOT_YTD_LATEST_PATH)
    };
  }

  return fetched;
}

function deleteArchiveBackups(outputDir) {
  if (!outputDir) return 0;
  const archiveDir = path.resolve(outputDir, 'archive');
  if (!fs.existsSync(archiveDir)) return 0;
  const files = fs.readdirSync(archiveDir)
    .filter(name => name.toLowerCase().endsWith('.bak'))
    .map(name => path.resolve(archiveDir, name));
  let removed = 0;
  files.forEach(filePath => {
    try {
      fs.unlinkSync(filePath);
      removed += 1;
    } catch (error) {
      console.warn(`⚠️  Unable to delete backup file ${filePath}: ${error.message}`);
    }
  });
  return removed;
}

function buildBackupPath(filePath) {
  const archiveDir = path.resolve(OUTPUT_DIR, 'archive');
  ensureDirectory(archiveDir);
  const timestamp = formatTimestampForFilename(new Date());
  const baseName = path.basename(filePath);
  return path.resolve(archiveDir, `${baseName}.${timestamp}.bak`);
}

function backupIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const backupPath = buildBackupPath(filePath);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function buildModifiedGroups(groups, groupWeights, metricWeights) {
  return groups.map(group => ({
    ...group,
    weight: groupWeights[group.name] || group.weight,
    metrics: group.metrics.map(metric => ({
      ...metric,
      weight: metricWeights[`${group.name}::${metric.name}`] || metric.weight
    }))
  }));
}

function flattenMetricWeights(metricWeights) {
  if (!metricWeights || typeof metricWeights !== 'object') return {};

  const flatWeights = {};
  const keys = Object.keys(metricWeights);
  const hasFlat = keys.some(key => key.includes('::') && typeof metricWeights[key] === 'number');

  if (hasFlat) {
    keys.forEach(key => {
      if (typeof metricWeights[key] === 'number') {
        flatWeights[key] = metricWeights[key];
      }
    });
    return flatWeights;
  }

  keys.forEach(groupName => {
    const groupMetrics = metricWeights[groupName];
    if (!groupMetrics || typeof groupMetrics !== 'object') return;
    Object.entries(groupMetrics).forEach(([metricName, metricConfig]) => {
      if (metricConfig && typeof metricConfig.weight === 'number') {
        flatWeights[`${groupName}::${metricName}`] = metricConfig.weight;
      }
    });
  });

  return flatWeights;
}

function nestMetricWeights(metricWeights) {
  if (!metricWeights || typeof metricWeights !== 'object') return {};

  const keys = Object.keys(metricWeights);
  const hasFlat = keys.some(key => key.includes('::'));

  const normalizeMetricNameForTemplate = (groupName, metricName) => {
    if (groupName === 'Course Management' && metricName === 'Poor Shots') {
      return 'Poor Shot Avoidance';
    }
    return metricName;
  };

  if (hasFlat) {
    const nested = {};
    keys.forEach(key => {
      if (typeof metricWeights[key] !== 'number') return;
      const [groupName, metricName] = key.split('::');
      if (!groupName || !metricName) return;
      const normalizedMetricName = normalizeMetricNameForTemplate(groupName, metricName);
      if (!nested[groupName]) nested[groupName] = {};
      if (!nested[groupName][normalizedMetricName]) {
        nested[groupName][normalizedMetricName] = { weight: 0 };
      }
      nested[groupName][normalizedMetricName].weight += metricWeights[key];
    });
    return nested;
  }

  const nested = {};
  keys.forEach(groupName => {
    const groupMetrics = metricWeights[groupName];
    if (!groupMetrics || typeof groupMetrics !== 'object') return;
    nested[groupName] = {};
    Object.entries(groupMetrics).forEach(([metricName, metricConfig]) => {
      if (metricConfig && typeof metricConfig.weight === 'number') {
        const normalizedMetricName = normalizeMetricNameForTemplate(groupName, metricName);
        if (!nested[groupName][normalizedMetricName]) {
          nested[groupName][normalizedMetricName] = { weight: 0 };
        }
        nested[groupName][normalizedMetricName].weight += metricConfig.weight;
      }
    });
  });

  return nested;
}

function normalizeTemplateWeights(template, baseMetricConfig) {
  const groupWeights = { ...(template.groupWeights || {}) };
  const metricWeights = flattenMetricWeights(template.metricWeights);

  baseMetricConfig.groups.forEach(group => {
    if (typeof groupWeights[group.name] !== 'number') {
      groupWeights[group.name] = group.weight;
    }
    group.metrics.forEach(metric => {
      const key = `${group.name}::${metric.name}`;
      if (typeof metricWeights[key] !== 'number') {
        metricWeights[key] = metric.weight;
      }
    });
  });

  return { groupWeights, metricWeights };
}

function buildGroupWeightsMap(groupWeightsArray) {
  const map = {};
  (groupWeightsArray || []).forEach(entry => {
    if (!entry || !entry.groupName) return;
    map[entry.groupName] = entry.weight;
  });
  return map;
}

function formatRankingPlayers(players, groups = null, groupStats = null) {
  if (!Array.isArray(players)) return [];
  return players.map(player => {
    const notes = (groups && groupStats)
      ? generateSheetLikePlayerNotes(player, groups, groupStats)
      : null;
    return {
      rank: typeof player.rank === 'number' ? player.rank : null,
      dgId: String(player.dgId || '').trim(),
      name: String(player.name || player.playerName || '').trim(),
      refinedWeightedScore: typeof player.refinedWeightedScore === 'number' ? player.refinedWeightedScore : null,
      weightedScore: typeof player.weightedScore === 'number' ? player.weightedScore : null,
      compositeScore: typeof player.compositeScore === 'number' ? player.compositeScore : null,
      war: typeof player.war === 'number' ? player.war : null,
      dataCoverage: typeof player.dataCoverage === 'number' ? player.dataCoverage : null,
      confidenceFactor: typeof player.confidenceFactor === 'number' ? player.confidenceFactor : null,
      teeTimeMultiplier: typeof player.teeTimeMultiplier === 'number' ? player.teeTimeMultiplier : null,
      teeTimeMinutes: typeof player.teeTimeMinutes === 'number' ? player.teeTimeMinutes : null,
      waveRound1: player.waveRound1 ?? null,
      waveRound2: player.waveRound2 ?? null,
      weatherWavePenaltyR1: typeof player.weatherWavePenaltyR1 === 'number' ? player.weatherWavePenaltyR1 : null,
      weatherWavePenaltyR2: typeof player.weatherWavePenaltyR2 === 'number' ? player.weatherWavePenaltyR2 : null,
      notes
    };
  });
}

function buildSignalContributionReport(players, groups, options = {}) {
  if (!Array.isArray(players) || !Array.isArray(groups)) return null;
  const limit = Math.max(1, Math.min(300, parseInt(options.limit || '50', 10) || 50));

  const groupWeights = groups.reduce((acc, group) => {
    acc[group.name] = typeof group.weight === 'number' ? group.weight : 0;
    return acc;
  }, {});

  const reportPlayers = players.slice(0, limit).map(player => {
    const contributions = Object.entries(player.groupScores || {})
      .map(([groupName, score]) => {
        const weight = groupWeights[groupName] || 0;
        const contribution = (typeof score === 'number' && !Number.isNaN(score))
          ? score * weight
          : 0;
        return { group: groupName, score, weight, contribution };
      })
      .filter(entry => typeof entry.contribution === 'number' && entry.contribution !== 0);

    const totalAbs = contributions.reduce((sum, entry) => sum + Math.abs(entry.contribution), 0) || 0;
    const topGroups = contributions
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 5)
      .map(entry => ({
        ...entry,
        share: totalAbs > 0 ? Math.abs(entry.contribution) / totalAbs : 0
      }));

    return {
      rank: player.rank ?? null,
      dgId: String(player.dgId || '').trim(),
      name: String(player.name || '').trim(),
      totalContribution: totalAbs > 0 ? contributions.reduce((sum, entry) => sum + entry.contribution, 0) : 0,
      topGroups
    };
  });

  return {
    generatedAt: formatTimestamp(new Date()),
    playerCount: players.length,
    reportCount: reportPlayers.length,
    players: reportPlayers
  };
}

function buildMetricStatsDiagnostics(groupStats, options = {}) {
  const {
    stdDevThreshold = 0.05,
    minCount = 10
  } = options;

  if (!groupStats || typeof groupStats !== 'object') {
    return {
      thresholds: { stdDevThreshold, minCount },
      flagged: [],
      groupStats: {}
    };
  }

  const flagged = [];
  Object.entries(groupStats).forEach(([groupName, metrics]) => {
    if (!metrics || typeof metrics !== 'object') return;
    Object.entries(metrics).forEach(([metricName, stats]) => {
      if (!stats || typeof stats !== 'object') return;
      const stdDev = typeof stats.stdDev === 'number' ? stats.stdDev : null;
      const count = typeof stats.count === 'number' ? stats.count : null;
      const reasons = [];
      if (stdDev !== null && stdDev <= stdDevThreshold) reasons.push(`stdDev<=${stdDevThreshold}`);
      if (count !== null && count < minCount) reasons.push(`count<${minCount}`);
      if (reasons.length === 0) return;
      flagged.push({
        group: groupName,
        metric: metricName,
        mean: typeof stats.mean === 'number' ? stats.mean : null,
        stdDev,
        count,
        min: typeof stats.min === 'number' ? stats.min : null,
        max: typeof stats.max === 'number' ? stats.max : null,
        reasons
      });
    });
  });

  return {
    thresholds: { stdDevThreshold, minCount },
    flagged: flagged.sort((a, b) => (a.stdDev ?? 0) - (b.stdDev ?? 0)),
    groupStats
  };
}

function selectOptimizableGroups(groupWeightsArray, minFixedCount = 3) {
  const sorted = [...(groupWeightsArray || [])].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const fixed = new Set(sorted.slice(0, minFixedCount).map(entry => entry.groupName));
  return sorted.filter(entry => !fixed.has(entry.groupName)).map(entry => entry.groupName);
}

function deriveResultsFromHistory(rawHistoryData, eventId, season = null, nameLookup = {}) {
  const numericResults = new Map();
  const cutPlayers = new Map();
  let maxFinish = 0;
  const eventIdStr = String(eventId || '').trim();

  rawHistoryData.forEach(row => {
    const dgId = String(row['dg_id'] || '').trim();
    const rowSeason = parseInt(String(row['season'] || row['year'] || '').trim());
    const rowYear = parseInt(String(row['year'] || '').trim());
    const rowEventId = String(row['event_id'] || '').trim();
    if (!dgId || !rowEventId) return;
    if (eventIdStr && rowEventId !== eventIdStr) return;
    if (season && !Number.isNaN(season)) {
      if (rowSeason !== season && rowYear !== season) return;
    }

    const finishInfo = parseFinishStatus(row['fin_text']);
    if (typeof finishInfo.position === 'number' && !Number.isNaN(finishInfo.position)) {
      const existing = numericResults.get(dgId);
      if (!existing || finishInfo.position < existing.finishPosition) {
        const playerName = String(row['player_name'] || '').trim() || nameLookup[dgId] || 'Unknown';
        numericResults.set(dgId, { finishPosition: finishInfo.position, playerName });
      }
      if (finishInfo.position > maxFinish) maxFinish = finishInfo.position;
      return;
    }

    if (finishInfo.isCut && !numericResults.has(dgId)) {
      const playerName = String(row['player_name'] || '').trim() || nameLookup[dgId] || 'Unknown';
      cutPlayers.set(dgId, playerName);
    }
  });

  const fallback = Number.isFinite(maxFinish) && maxFinish > 0 ? maxFinish + 1 : null;
  if (Number.isFinite(fallback)) {
    cutPlayers.forEach((playerName, dgId) => {
      if (!numericResults.has(dgId)) {
        numericResults.set(dgId, { finishPosition: fallback, playerName });
      }
    });
  }

  return Array.from(numericResults.entries()).map(([dgId, entry]) => ({
    dgId,
    finishPosition: entry.finishPosition,
    playerName: entry.playerName
  }));
}

function buildResultsByYear(rawHistoryData, eventId) {
  const numericByYear = new Map();
  const cutByYear = new Map();
  const maxByYear = new Map();

  rawHistoryData.forEach(row => {
    const year = parseInt(String(row['year'] || row['season'] || '').trim());
    if (Number.isNaN(year)) return;
    const eventIdStr = String(eventId || '').trim();
    const rowEventId = String(row['event_id'] || '').trim();
    if (eventIdStr && rowEventId !== eventIdStr) return;
    const dgId = String(row['dg_id'] || '').trim();
    if (!dgId) return;

    const finishInfo = parseFinishStatus(row['fin_text']);
    if (typeof finishInfo.position === 'number' && !Number.isNaN(finishInfo.position)) {
      if (!numericByYear.has(year)) numericByYear.set(year, new Map());
      const yearMap = numericByYear.get(year);
      const existing = yearMap.get(dgId);
      if (!existing || finishInfo.position < existing) {
        yearMap.set(dgId, finishInfo.position);
      }
      const currentMax = maxByYear.get(year) || 0;
      if (finishInfo.position > currentMax) maxByYear.set(year, finishInfo.position);
      return;
    }

    if (finishInfo.isCut) {
      if (!cutByYear.has(year)) cutByYear.set(year, new Set());
      cutByYear.get(year).add(dgId);
    }
  });

  const resultsByYear = {};
  const allYears = new Set([...numericByYear.keys(), ...cutByYear.keys()]);
  Array.from(allYears).forEach(year => {
    const yearMap = numericByYear.get(year) || new Map();
    const positions = Array.from(yearMap.values());
    const fallback = positions.length ? Math.max(...positions) + 1 : null;
    const results = Array.from(yearMap.entries()).map(([dgId, finishPosition]) => ({ dgId, finishPosition }));
    if (Number.isFinite(fallback)) {
      const cutSet = cutByYear.get(year) || new Set();
      cutSet.forEach(dgId => {
        if (!yearMap.has(dgId)) results.push({ dgId, finishPosition: fallback });
      });
    }
    resultsByYear[year] = results;
  });

  return resultsByYear;
}

function aggregateYearlyEvaluations(resultsByYear) {
  const years = Object.keys(resultsByYear);
  const totals = years.reduce(
    (acc, year) => {
      const evalResult = resultsByYear[year];
      acc.matchedPlayers += evalResult.matchedPlayers || 0;
      acc.correlation += (evalResult.correlation || 0) * (evalResult.matchedPlayers || 0);
      acc.rmse += (evalResult.rmse || 0) * (evalResult.matchedPlayers || 0);
      acc.rSquared += (evalResult.rSquared || 0) * (evalResult.matchedPlayers || 0);
      acc.meanError += (evalResult.meanError || 0) * (evalResult.matchedPlayers || 0);
      acc.stdDevError += (evalResult.stdDevError || 0) * (evalResult.matchedPlayers || 0);
      acc.mae += (evalResult.mae || 0) * (evalResult.matchedPlayers || 0);
      if (typeof evalResult.top10 === 'number') {
        acc.top10 += evalResult.top10 * (evalResult.matchedPlayers || 0);
      }
      if (typeof evalResult.top20 === 'number') {
        acc.top20 += evalResult.top20 * (evalResult.matchedPlayers || 0);
        acc.top20WeightedScore += (evalResult.top20WeightedScore || 0) * (evalResult.matchedPlayers || 0);
      }
      return acc;
    },
    {
      correlation: 0,
      rmse: 0,
      rSquared: 0,
      meanError: 0,
      stdDevError: 0,
      mae: 0,
      top10: 0,
      top20: 0,
      top20WeightedScore: 0,
      matchedPlayers: 0
    }
  );

  if (totals.matchedPlayers === 0) {
    return {
      correlation: 0,
      rmse: 0,
      rSquared: 0,
      meanError: 0,
      stdDevError: 0,
      mae: 0,
      top10: null,
      top20: null,
      top20WeightedScore: null,
      matchedPlayers: 0
    };
  }

  return {
    correlation: totals.correlation / totals.matchedPlayers,
    rmse: totals.rmse / totals.matchedPlayers,
    rSquared: totals.rSquared / totals.matchedPlayers,
    meanError: totals.meanError / totals.matchedPlayers,
    stdDevError: totals.stdDevError / totals.matchedPlayers,
    mae: totals.mae / totals.matchedPlayers,
    top10: totals.top10 > 0 ? totals.top10 / totals.matchedPlayers : null,
    top20: totals.top20 > 0 ? totals.top20 / totals.matchedPlayers : null,
    top20WeightedScore: totals.top20WeightedScore > 0 ? totals.top20WeightedScore / totals.matchedPlayers : null,
    matchedPlayers: totals.matchedPlayers
  };
}

function adjustMetricWeights(metricWeights, metricConfig, maxAdjustment) {
  const adjusted = { ...metricWeights };
  metricConfig.groups.forEach(group => {
    const keys = group.metrics.map(metric => `${group.name}::${metric.name}`);
    const groupWeights = keys.map(key => ({
      key,
      weight: adjusted[key] || 0
    }));

    const updated = groupWeights.map(({ key, weight }) => {
      const adjustment = (rand() * 2 - 1) * maxAdjustment;
      return { key, weight: Math.max(0.0001, weight * (1 + adjustment)) };
    });

    const total = updated.reduce((sum, metric) => sum + metric.weight, 0);
    updated.forEach(metric => {
      adjusted[metric.key] = total > 0 ? metric.weight / total : metric.weight;
    });
  });

  return adjusted;
}

function computeWeightDeltas(baselineWeights, optimizedWeights) {
  const deltas = {};
  Object.keys(baselineWeights || {}).forEach(groupName => {
    const base = baselineWeights[groupName] || 0;
    const opt = optimizedWeights[groupName] || 0;
    deltas[groupName] = {
      baseline: base,
      optimized: opt,
      delta: opt - base,
      deltaPct: base === 0 ? null : ((opt - base) / base)
    };
  });
  return deltas;
}

function resolveDataFile(fileName) {
  const primary = path.resolve(DATA_DIR, fileName);
  if (fs.existsSync(primary)) return primary;
  const fallback = path.resolve(DEFAULT_DATA_DIR, fileName);
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}

function normalizeTournamentSlug(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Defensive cleanup: some historical runs accidentally carried an `optimizer_` prefix.
  // We never want that to leak into folder names or artifact names.
  return normalized.replace(/^optimizer-+/, '');
}

function listSeasonInputDirs(season) {
  const dirs = [];
  if (!season) return dirs;
  const seasonDir = path.resolve(DATA_ROOT_DIR, String(season));
  if (!fs.existsSync(seasonDir)) return dirs;
  const entries = fs.readdirSync(seasonDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'validation_outputs')
    .map(entry => entry.name);
  entries.forEach(name => {
    const inputDir = path.resolve(seasonDir, name, 'inputs');
    if (fs.existsSync(inputDir)) dirs.push(inputDir);
  });
  return dirs;
}

function resolveTournamentDir(season, tournamentName, fallbackName) {
  const seasonDir = path.resolve(DATA_ROOT_DIR, String(season));
  const normalized = normalizeTournamentSlug(tournamentName || fallbackName);
  if (!fs.existsSync(seasonDir)) {
    return path.resolve(seasonDir, normalized || `event-${OVERRIDE_EVENT_ID || 'unknown'}`);
  }

  const entries = fs.readdirSync(seasonDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'validation_outputs')
    .map(entry => entry.name);

  if (normalized && entries.includes(normalized)) {
    return path.resolve(seasonDir, normalized);
  }

  if (normalized) {
    const tokens = normalized.split('-').filter(Boolean);
    if (tokens.length > 0) {
      let best = null;
      entries.forEach(name => {
        const dirTokens = name.split('-').filter(Boolean);
        const overlap = tokens.filter(token => dirTokens.includes(token)).length;
        if (!best || overlap > best.overlap) {
          best = { name, overlap };
        }
      });
      if (best && best.overlap > 0) {
        return path.resolve(seasonDir, best.name);
      }
    }
  }

  return path.resolve(seasonDir, normalized || `event-${OVERRIDE_EVENT_ID || 'unknown'}`);
}

function resolveTournamentFile(suffix, tournamentName, season, fallbackName) {
  const baseName = String(tournamentName || fallbackName || '').trim();
  const seasonTag = season ? `(${season})` : '';
  const exactName = baseName ? `${baseName} ${seasonTag} - ${suffix}.csv`.replace(/\s+/g, ' ').trim() : '';
  const altName = baseName ? `${baseName} - ${suffix}.csv` : '';
  const normalizeMatchToken = (value) => String(value || '')
    .toLowerCase()
    .replace(/\.csv$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\d+\)/g, '')
    .replace(/\s*-\s*/g, ' - ')
    .trim()
    .replace(/^the\s+/, '')
    .trim();

  const seasonInputDirs = listSeasonInputDirs(season);
  const dirs = [
    ...(TOURNAMENT_INPUT_DIRS || []),
    ...seasonInputDirs,
    DATA_DIR,
    DEFAULT_DATA_DIR
  ].filter(Boolean);
  const candidates = [];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
      if (!file.toLowerCase().endsWith('.csv')) return;
      const lower = file.toLowerCase();
      if (!lower.includes(suffix.toLowerCase())) return;
      candidates.push({
        file,
        path: path.resolve(dir, file)
      });
    });
  });

  if (exactName) {
    const match = candidates.find(c => normalizeMatchToken(c.file) === normalizeMatchToken(exactName));
    if (match) return match.path;
  }

  if (altName) {
    const match = candidates.find(c => normalizeMatchToken(c.file) === normalizeMatchToken(altName));
    if (match) return match.path;
  }

  if (baseName) {
    const baseToken = normalizeMatchToken(baseName);
    const match = candidates.find(c => {
      const fileToken = normalizeMatchToken(c.file);
      return fileToken.includes(baseToken) && fileToken.includes(suffix.toLowerCase());
    });
    if (match) return match.path;
  }

  if (candidates.length > 0) {
    return candidates[0].path;
  }

  if (candidates.length > 0 && !baseName) {
    const sorted = candidates.sort((a, b) => a.file.localeCompare(b.file));
    return sorted[0].path;
  }

  if (exactName) return resolveDataFile(exactName);
  if (altName) return resolveDataFile(altName);
  return resolveDataFile(`${suffix}.csv`);
}

function ensureTournamentScaffolding(tournamentDir) {
  if (!tournamentDir) return;
  ensureDirectory(tournamentDir);
  ensureDirectory(path.resolve(tournamentDir, 'inputs'));
  const preEventDir = path.resolve(tournamentDir, 'pre_event');
  const postEventDir = path.resolve(tournamentDir, 'post_event');
  ensureDirectory(preEventDir);
  ensureDirectory(postEventDir);
  ensureDirectory(path.resolve(preEventDir, 'analysis'));
  ensureDirectory(path.resolve(preEventDir, 'course_history_regression'));
  ensureDirectory(path.resolve(preEventDir, 'dryrun'));
  ensureDirectory(path.resolve(postEventDir, 'dryrun'));
}

function listApproachCsvCandidates(season, excludePath = null) {
  const seasonInputDirs = listSeasonInputDirs(season);
  const dirs = [
    ...(TOURNAMENT_INPUT_DIRS || []),
    ...seasonInputDirs,
    DATA_DIR,
    DEFAULT_DATA_DIR
  ].filter(Boolean);
  const normalizedExclude = excludePath ? path.resolve(excludePath) : null;
  const candidates = [];

  dirs.forEach(dir => {
    if (!dir || !fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
      if (!file.toLowerCase().endsWith('.csv')) return;
      if (!file.toLowerCase().includes('approach skill')) return;
      const filePath = path.resolve(dir, file);
      if (normalizedExclude && path.resolve(filePath) === normalizedExclude) return;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(filePath).mtimeMs || 0;
      } catch (error) {
        mtimeMs = 0;
      }
      candidates.push({ file: file, path: filePath, mtimeMs });
    });
  });

  return candidates;
}

function resolvePreviousApproachCsv(season, currentPath) {
  const candidates = listApproachCsvCandidates(season, currentPath);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  return candidates[0].path;
}

function detectPostTournamentFromHistory(historyPath, eventId, season) {
  if (!historyPath || !fs.existsSync(historyPath)) return false;
  try {
    const rows = loadCsv(historyPath, { skipFirstColumn: true });
    if (!Array.isArray(rows) || rows.length === 0) return false;
    const eventIdStr = String(eventId || '').trim();
    const seasonStr = String(season || '').trim();
    return rows.some(row => {
      const rowEvent = String(row?.event_id || '').trim();
      if (eventIdStr && rowEvent !== eventIdStr) return false;
      const rowSeason = String(row?.season || row?.year || '').trim();
      if (seasonStr && rowSeason !== seasonStr) return false;
      return !!String(row?.fin_text || row?.finish || row?.finishPosition || '').trim();
    });
  } catch (error) {
    return false;
  }
}

function upsertTemplateInFile(filePath, template, options = {}) {
  const { replaceByEventId = false, dryRun = false } = options;
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const marker = 'const WEIGHT_TEMPLATES = {';
    const markerIndex = fileContent.indexOf(marker);
    if (markerIndex === -1) return { updated: false, content: null };

    const findTemplateBlocks = (content) => {
      const blocks = [];
      let i = markerIndex + marker.length;
      let depth = 1;
      let inString = false;
      let stringChar = '';
      let keyStart = null;
      let keyEnd = null;
      let key = null;
      let entryStart = null;

      while (i < fileContent.length) {
        const char = fileContent[i];

        if (inString) {
          if (char === stringChar && fileContent[i - 1] !== '\\') {
            inString = false;
          }
          i += 1;
          continue;
        }

        if (char === '"' || char === "'") {
          if (depth === 1 && key === null) {
            const quoteChar = char;
            const start = i;
            let j = i + 1;
            while (j < content.length) {
              if (content[j] === quoteChar && content[j - 1] !== '\\') break;
              j += 1;
            }
            if (j < content.length) {
              const possibleKey = content.slice(start + 1, j);
              const afterKey = content.slice(j + 1).trimStart();
              if (afterKey.startsWith(':')) {
                key = possibleKey;
                keyStart = start;
                keyEnd = j + 1;
                i = j + 1;
                continue;
              }
            }
          }
          inString = true;
          stringChar = char;
          i += 1;
          continue;
        }

        if (char === '{') {
          depth += 1;
          if (depth === 2 && entryStart === null && key) {
            entryStart = i;
          }
        } else if (char === '}') {
          if (depth === 2 && entryStart !== null) {
            const entryEnd = i + 1;
            blocks.push({ key, keyStart, keyEnd, start: entryStart, end: entryEnd });
            key = null;
            entryStart = null;
            keyStart = null;
            keyEnd = null;
          }
          depth -= 1;
          if (depth === 0) break;
        } else if (depth === 1 && key === null) {
          if (char === '\n' || char === ' ') {
            i += 1;
            continue;
          }
          if (/[A-Za-z0-9_]/.test(char)) {
            keyStart = i;
            let j = i;
            while (j < content.length && /[A-Za-z0-9_]/.test(content[j])) j += 1;
            const possibleKey = content.slice(keyStart, j);
            const afterKey = content.slice(j).trimStart();
            if (afterKey.startsWith(':')) {
              key = possibleKey;
              keyEnd = j;
            }
          }
        }

        i += 1;
      }

      return blocks;
    };

    const blocks = findTemplateBlocks(fileContent);
    let targetKey = template.name;
    let targetBlock = null;
    let eventMatches = [];

    const removeBlockWithLeadingComma = (content, block) => {
      if (!block) return content;
      let start = block.keyStart ?? block.start;
      const end = block.end;
      if (start === null || start === undefined) return content;
      let cursor = start - 1;
      while (cursor >= 0 && /\s/.test(content[cursor])) {
        cursor -= 1;
      }
      if (cursor >= 0 && content[cursor] === ',') {
        start = cursor;
      }
      return content.slice(0, start) + content.slice(end);
    };

    if (replaceByEventId) {
      const eventIdValue = String(template.eventId);
      const eventIdRegex = new RegExp(`eventId\\s*:\\s*['\"]?${eventIdValue}['\"]?`);
      eventMatches = blocks.filter(block => eventIdRegex.test(fileContent.slice(block.start, block.end)));
      if (eventMatches.length > 0) {
        targetKey = eventMatches[0].key;
        targetBlock = eventMatches[0];
      }
    } else {
      targetBlock = blocks.find(block => block.key === targetKey) || null;
    }

    const templateForWrite = { ...template, name: template.name || targetKey };
    const templateString = JSON.stringify({ __KEY__: templateForWrite }, null, 2)
      .replace(/^\{\n|\n\}$/g, '')
      .replace(/\n  /g, '\n  ')
      .replace(/"name":/g, 'name:')
      .replace(/"eventId":/g, 'eventId:')
      .replace(/"description":/g, 'description:')
      .replace(/"groupWeights":/g, 'groupWeights:')
      .replace(/"metricWeights":/g, 'metricWeights:')
      .replace(/"weight":/g, 'weight:')
      .replace(/\{\s*weight:\s*([0-9.\-eE]+)\s*\}/g, '{ weight: $1 }');

    const isIdentifierKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(templateForWrite.name);
    const keyToken = isIdentifierKey
      ? `${templateForWrite.name}:`
      : `"${templateForWrite.name}":`;
    const templateWithKey = templateString.replace(/"__KEY__":/, keyToken).trim();
    let updatedContent;

    if (targetBlock) {
      const wantsKeyUpdate = templateForWrite.name && templateForWrite.name !== targetBlock.key && targetBlock.keyStart !== null;
      if (wantsKeyUpdate) {
        updatedContent = fileContent.slice(0, targetBlock.keyStart) + templateWithKey + fileContent.slice(targetBlock.end);
      } else {
        const objectOnly = templateWithKey.slice(templateWithKey.indexOf('{'));
        updatedContent = fileContent.slice(0, targetBlock.start) + objectOnly + fileContent.slice(targetBlock.end);
      }
    } else {
      const insertAt = fileContent.indexOf('};', markerIndex);
      if (insertAt === -1) return { updated: false, content: null };
      updatedContent = fileContent.slice(0, insertAt) + `,\n  ${templateWithKey}` + fileContent.slice(insertAt);
    }

    if (replaceByEventId && eventMatches.length > 1) {
      const eventIdValue = String(template.eventId);
      const eventIdRegex = new RegExp(`eventId\\s*:\\s*['\"]?${eventIdValue}['\"]?`);
      const refreshedBlocks = findTemplateBlocks(updatedContent)
        .filter(block => eventIdRegex.test(updatedContent.slice(block.start, block.end)));

      if (refreshedBlocks.length > 1) {
        const blocksToRemove = refreshedBlocks.slice(1).sort((a, b) => b.start - a.start);
        blocksToRemove.forEach(block => {
          updatedContent = removeBlockWithLeadingComma(updatedContent, block);
        });
      }
    }

    if (targetKey) {
      const refreshedBlocks = findTemplateBlocks(updatedContent)
        .filter(block => block.key === targetKey);
      if (refreshedBlocks.length > 1) {
        const blocksToRemove = refreshedBlocks.slice(1).sort((a, b) => b.start - a.start);
        blocksToRemove.forEach(block => {
          updatedContent = removeBlockWithLeadingComma(updatedContent, block);
        });
      }
    }

    if (!dryRun) {
      fs.writeFileSync(filePath, updatedContent, 'utf8');
    }

    return { updated: true, content: updatedContent };
  } catch (error) {
    console.error(`Failed to update template file: ${filePath}`, error.message);
    return { updated: false, content: null };
  }
}

function buildDeltaPlayerScoresEntry(eventId, season, playerSummary) {
  if (!playerSummary) return null;
  const trendScores = Array.isArray(playerSummary.trendWeightedAll) ? playerSummary.trendWeightedAll : [];
  const predictiveScores = Array.isArray(playerSummary.predictiveWeightedAll) ? playerSummary.predictiveWeightedAll : [];
  if (!trendScores.length && !predictiveScores.length) return null;

  const players = new Map();
  const upsert = (entry, scoreKey, bucketKey) => {
    const dgId = String(entry?.dgId || entry?.dg_id || '').trim();
    if (!dgId) return;
    const name = entry?.playerName || entry?.player_name || null;
    const score = typeof entry?.score === 'number' && !Number.isNaN(entry.score) ? entry.score : null;
    if (score === null) return;
    const current = players.get(dgId) || {};
    if (name && !current.name) current.name = name;
    current[scoreKey] = score;
    if (entry?.bucketScores && typeof entry.bucketScores === 'object') {
      current[bucketKey] = entry.bucketScores;
    }
    players.set(dgId, current);
  };

  trendScores.forEach(entry => upsert(entry, 'deltaTrendScore', 'deltaTrendBuckets'));
  predictiveScores.forEach(entry => upsert(entry, 'deltaPredictiveScore', 'deltaPredictiveBuckets'));

  if (players.size === 0) return null;

  const seasonValue = typeof season === 'number' && !Number.isNaN(season)
    ? season
    : parseInt(String(season || '').trim(), 10);

  const sortedIds = Array.from(players.keys()).sort((a, b) => Number(a) - Number(b));
  const playersObject = {};
  sortedIds.forEach(id => {
    const entry = players.get(id);
    playersObject[id] = {
      name: entry?.name || null,
      deltaTrendScore: typeof entry?.deltaTrendScore === 'number' ? entry.deltaTrendScore : null,
      deltaPredictiveScore: typeof entry?.deltaPredictiveScore === 'number' ? entry.deltaPredictiveScore : null,
      deltaTrendBuckets: entry?.deltaTrendBuckets || null,
      deltaPredictiveBuckets: entry?.deltaPredictiveBuckets || null
    };
  });

  return {
    [String(eventId)]: {
      season: Number.isNaN(seasonValue) ? null : seasonValue,
      players: playersObject
    }
  };
}

function buildDeltaScoresByIdFromScores(trendScores = [], predictiveScores = []) {
  const players = new Map();
  const upsert = (entry, scoreKey, bucketKey) => {
    const dgId = String(entry?.dgId || entry?.dg_id || '').trim();
    if (!dgId) return;
    const score = typeof entry?.score === 'number' && !Number.isNaN(entry.score) ? entry.score : null;
    if (score === null) return;
    const current = players.get(dgId) || {};
    current[scoreKey] = score;
    if (entry?.bucketScores && typeof entry.bucketScores === 'object') {
      current[bucketKey] = entry.bucketScores;
    }
    players.set(dgId, current);
  };

  trendScores.forEach(entry => upsert(entry, 'deltaTrendScore', 'deltaTrendBuckets'));
  predictiveScores.forEach(entry => upsert(entry, 'deltaPredictiveScore', 'deltaPredictiveBuckets'));

  const output = {};
  players.forEach((entry, dgId) => {
    output[dgId] = {
      deltaTrendScore: typeof entry?.deltaTrendScore === 'number' ? entry.deltaTrendScore : null,
      deltaPredictiveScore: typeof entry?.deltaPredictiveScore === 'number' ? entry.deltaPredictiveScore : null,
      deltaTrendBuckets: entry?.deltaTrendBuckets || null,
      deltaPredictiveBuckets: entry?.deltaPredictiveBuckets || null
    };
  });

  return output;
}

function buildDeltaPlayerScoresFileContent(deltaScoresByEvent, options = {}) {
  const { includeModuleExports = false } = options;
  const content = `const DELTA_PLAYER_SCORES = ${JSON.stringify(deltaScoresByEvent, null, 2)};\n\n`;
  let output = `${content}` +
    `function getDeltaPlayerScoresForEvent(eventId, season) {\n` +
    `  const key = eventId !== null && eventId !== undefined ? String(eventId).trim() : '';\n` +
    `  const entry = DELTA_PLAYER_SCORES[key];\n` +
    `  if (!entry) return {};\n` +
    `  if (season !== null && season !== undefined) {\n` +
    `    const seasonValue = parseInt(String(season).trim(), 10);\n` +
    `    if (!Number.isNaN(seasonValue) && entry.season && entry.season !== seasonValue) {\n` +
    `      return {};\n` +
    `    }\n` +
    `  }\n` +
    `  return entry.players || {};\n` +
    `}\n\n` +
    `function getDeltaPlayerScores() {\n` +
    `  return DELTA_PLAYER_SCORES;\n` +
    `}\n`;

  if (includeModuleExports) {
    output += `\nmodule.exports = { DELTA_PLAYER_SCORES, getDeltaPlayerScoresForEvent, getDeltaPlayerScores };\n`;
  }
  return output;
}

function writeDeltaPlayerScoresFiles(targets, deltaScoresByEvent, options = {}) {
  const { dryRun = false, outputDir = null } = options;
  if (!deltaScoresByEvent || Object.keys(deltaScoresByEvent).length === 0) return [];
  const outputs = [];
  const nodeTarget = path.resolve(ROOT_DIR, 'utilities', 'deltaPlayerScores.js');

  (targets || []).forEach(filePath => {
    if (!filePath) return;
    const includeModuleExports = path.resolve(filePath) === nodeTarget;
    const content = buildDeltaPlayerScoresFileContent(deltaScoresByEvent, { includeModuleExports });
    if (dryRun) {
      const suffix = includeModuleExports ? 'node' : 'gas';
      const baseName = path.basename(filePath, path.extname(filePath));
      const dryRunName = `dryrun_${baseName}.${suffix}${path.extname(filePath) || '.js'}`;
      const dryRunPath = outputDir
        ? path.resolve(outputDir, dryRunName)
        : `${filePath}.dryrun`;
      fs.writeFileSync(dryRunPath, content, 'utf8');
      outputs.push({ action: 'dryRun', target: dryRunPath });
    } else {
      fs.writeFileSync(filePath, content, 'utf8');
      outputs.push({ action: 'write', target: filePath });
    }
  });

  return outputs;
}

async function runAdaptiveOptimizer() {
  const requiredFiles = [
    { name: 'Configuration Sheet', path: null },
    { name: 'Tournament Field', path: null },
    { name: 'Historical Data', path: null },
    { name: 'Approach Skill', path: null }
  ];

  const CURRENT_EVENT_ID = OVERRIDE_EVENT_ID;
  const CURRENT_SEASON = OVERRIDE_SEASON ?? 2026;
  const tournamentNameFallback = TOURNAMENT_NAME;
  let resultsJsonPath = null;
  let resultsTextPath = null;
  let preEventRankingPath = null;
  let preEventRankingCsvPath = null;
  let signalReportPath = null;
  let dryRunTemplatePath = null;
  let dryRunDeltaScoresPath = null;
  let validationRunSummary = null;
  let optimizationObjectiveWeights = null;
  let summaryOutputBaseName = null;
  let summaryTournamentSlug = null;
  let seedRunsParentDir = null;
  const emitCleanSummaryLog = (extraOptions = {}) => writeCleanRunSummaryLog({
    summaryOutputBaseName,
    summaryTournamentSlug,
    isPostRun: IS_POST_TOURNAMENT_RUN,
    outputDir: seedRunsParentDir || OUTPUT_DIR,
    tournamentName: TOURNAMENT_NAME,
    tournamentNameFallback,
    canonicalTournamentName,
    currentEventId: CURRENT_EVENT_ID,
    currentSeason: CURRENT_SEASON,
    runContext,
    courseContextEntryFinal,
    sharedConfig,
    courseTemplateKey,
    shouldRunPreEventArtifacts: SHOULD_RUN_PRE_EVENT_ARTIFACTS,
    regressionSnapshot,
    rampSummary,
    rampPlayers,
    rampMaxEvents,
    validationData,
    validationOutputsDir,
    validationTemplateName,
    applyValidationOutputs,
    rankingsSnapshot,
    approachSkillSnapshot,
    playerDecompositionsSnapshot,
    skillRatingsValueSnapshot,
    skillRatingsRankSnapshot,
    datagolfApproachPeriod: DATAGOLF_APPROACH_PERIOD,
    approachDataCurrentSource,
    approachDataCurrentCount: Array.isArray(approachDataCurrent) ? approachDataCurrent.length : null,
    approachSnapshotYtd,
    approachSnapshotL12,
    approachSnapshotL24,
    approachBlendWeights,
    approachBlendWeightsRaw: APPROACH_BLEND_WEIGHTS_RAW,
    approachEventOnlyMeta,
    approachYtdUpdatedThisRun,
    fieldUpdatesSnapshot,
    fieldUpdatesUpdatedThisRun,
    fieldDataLength: fieldData?.length || 0,
    weatherEnabled: WEATHER_ENABLED,
    weatherWaveSummary,
    lastFiveYears,
    effectiveSeason,
    tours,
    datagolfHistoricalEventId: DATAGOLF_HISTORICAL_EVENT_ID,
    datagolfCacheDir: DATAGOLF_CACHE_DIR,
    step1cUsedRounds,
    historyData,
    allEventRounds,
    roundsByYear,
    hasCurrentResults: HAS_CURRENT_RESULTS,
    trainingMetricNotes,
    validationYears,
    approachDeltaPriorMode,
    approachDeltaPriorFiles,
    approachDeltaPriorMeta,
    approachDeltaRowsUsed: Array.isArray(approachDeltaRows) ? approachDeltaRows.length : null,
    approachDeltaRowsTotal: Array.isArray(approachDeltaRowsAll) ? approachDeltaRowsAll.length : null,
    approachDeltaPriorWeight: APPROACH_DELTA_PRIOR_WEIGHT,
    approachDeltaPriorLabel: APPROACH_DELTA_PRIOR_LABEL,
    optimizationObjectiveWeights,
    optimizationApproachCap: APPROACH_GROUP_CAP,
    optimizationLoeoPenalty: OPT_LOEO_PENALTY,
    optimizationLoeoTopN: OPT_LOEO_TOP_N,
    validationRunSummary,
    resultsJsonPath,
    resultsTextPath,
    preEventRankingPath,
    preEventRankingCsvPath,
    signalReportPath,
    dryRunTemplatePath,
    dryRunDeltaScoresPath,
    resolveFileTimestamp,
    resolveCourseNumFromHistoryRow,
    formatSnapshotUsageLine,
    resolveSnapshotUpdatedAt,
    buildHistoricalCachePaths,
    courseContextPath: COURSE_CONTEXT_PATH,
    templateFilePath: path.resolve(ROOT_DIR, 'utilities', 'weightTemplates.js'),
    ...extraOptions
  });
  const shouldUpsertManifest = !!TOURNAMENT_NAME;
  const manifestUpsert = shouldUpsertManifest
    ? ensureManifestEntry({
      dataRootDir: DATA_ROOT_DIR,
      season: CURRENT_SEASON,
      eventId: CURRENT_EVENT_ID,
      tournamentName: TOURNAMENT_NAME,
      tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME),
      logger: console
    })
    : null;
  const manifestEntries = manifestUpsert?.entries?.length
    ? manifestUpsert.entries
    : loadSeasonManifestEntries(DATA_ROOT_DIR, CURRENT_SEASON);
  const manifestEntry = resolveManifestEntryForEvent(manifestEntries, {
    eventId: CURRENT_EVENT_ID,
    tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
    tournamentName: TOURNAMENT_NAME || tournamentNameFallback
  });
  const manifestTournamentSlug = manifestEntry?.tournamentSlug
    ? normalizeTournamentSlug(manifestEntry.tournamentSlug)
    : null;
  const manifestTournamentName = manifestEntry?.tournamentName || null;
  const canonicalTournamentName = manifestTournamentName || TOURNAMENT_NAME || tournamentNameFallback;
  const canonicalTournamentSlug = manifestTournamentSlug
    || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback);
  const manifestEventDateInfo = resolveEventStartDateFromManifest({
    dataRootDir: DATA_ROOT_DIR,
    season: CURRENT_SEASON,
    eventId: CURRENT_EVENT_ID,
    tournamentSlug: canonicalTournamentSlug,
    tournamentName: canonicalTournamentName
  });
  const seasonDir = path.resolve(DATA_ROOT_DIR, String(CURRENT_SEASON));
  const tournamentDir = RUN_SEASON_VALIDATION
    ? null
    : (manifestTournamentSlug
        ? path.resolve(seasonDir, manifestTournamentSlug)
        : resolveTournamentDir(
            CURRENT_SEASON,
            canonicalTournamentSlug || TOURNAMENT_NAME,
            tournamentNameFallback
          ));
  const shouldScaffold = !RUN_RESULTS_ONLY && !RUN_SEASON_VALIDATION;
  if (tournamentDir && shouldScaffold) {
    ensureTournamentScaffolding(tournamentDir);
  }
  const tournamentInputsDir = tournamentDir ? path.resolve(tournamentDir, 'inputs') : null;
  const preEventOutputDir = RUN_SEASON_VALIDATION
    ? null
    : resolveModeRoot({
      tournamentRoot: tournamentDir,
      mode: 'pre_event',
      outputDirOverride: OVERRIDE_OUTPUT_DIR
    });
  const postEventOutputDir = RUN_SEASON_VALIDATION
    ? null
    : resolveModeRoot({
      tournamentRoot: tournamentDir,
      mode: 'post_event',
      outputDirOverride: OVERRIDE_OUTPUT_DIR
    });
  const validationOutputsDir = resolveValidationRoot({
    dataRoot: DATA_ROOT_DIR,
    season: CURRENT_SEASON,
    workspaceRoot: ROOT_DIR
  });

  TOURNAMENT_INPUT_DIRS = tournamentInputsDir ? [tournamentInputsDir] : [];
  VALIDATION_OUTPUT_DIRS = [validationOutputsDir];
  if (tournamentInputsDir) {
    DATA_DIR = tournamentInputsDir;
    DEFAULT_DATA_DIR = tournamentInputsDir;
  }
  if (preEventOutputDir) {
    OUTPUT_DIR = preEventOutputDir;
  }

  if (shouldScaffold) {
    if (preEventOutputDir) ensureDirectory(preEventOutputDir);
    if (postEventOutputDir) ensureDirectory(postEventOutputDir);
    if (validationOutputsDir) ensureDirectory(validationOutputsDir);
  }

  if (RUN_VALIDATION_ONLY) {
    try {
      const { runValidation, runSeasonValidation } = require('./validationRunner');
      if (RUN_SEASON_VALIDATION && typeof runSeasonValidation === 'function') {
        console.log('🧪 Running validation runner for all season tournaments...');
        const validationResult = await runSeasonValidation({
          season: CURRENT_SEASON,
          dataRootDir: DATA_ROOT_DIR,
          logger: console,
          writeTemplates: WRITE_TEMPLATES,
          dryRun: DRY_RUN,
          dryRunDir: null
        });
        console.log(`✅ Validation outputs written to: ${validationResult.outputDir}`);
        return;
      }
      if (typeof runValidation !== 'function') {
        throw new Error('validationRunner is unavailable');
      }
      console.log('🧪 Running validation runner (standalone mode)...');
      const validationResult = await runValidation({
        season: CURRENT_SEASON,
        dataRootDir: DATA_ROOT_DIR,
        tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
        tournamentSlug: null,
        tournamentDir,
        eventId: CURRENT_EVENT_ID,
        writeTemplates: WRITE_TEMPLATES,
        dryRun: DRY_RUN,
        dryRunDir: null
      });
      console.log(`✅ Validation outputs written to: ${validationResult.outputDir}`);
      return;
    } catch (error) {
      console.error(`\n❌ Validation runner failed: ${error.message}`);
      process.exit(1);
    }
  }

  let APPROACH_DELTA_PATH = findApproachDeltaFile([
    APPROACH_DELTA_DIR,
    OUTPUT_DIR,
    DATA_DIR,
    DEFAULT_DATA_DIR
  ], TOURNAMENT_NAME, tournamentNameFallback);
  if (RUN_DELTA_ONLY) {
    APPROACH_DELTA_PATH = null;
    console.log('ℹ️  Delta-only mode: forcing approach delta auto-generation.');
  }
  if (OVERRIDE_APPROACH_DELTA_CURRENT || OVERRIDE_APPROACH_DELTA_PREVIOUS) {
    APPROACH_DELTA_PATH = null;
    console.log('ℹ️  Approach delta overrides provided; will auto-generate delta JSON.');
  }
  let CONFIG_PATH = resolveTournamentFile('Configuration Sheet', TOURNAMENT_NAME, CURRENT_SEASON, tournamentNameFallback);
  if (CONFIG_PATH && tournamentInputsDir) {
    const normalizedInputsDir = path.resolve(tournamentInputsDir);
    const normalizedConfigPath = path.resolve(CONFIG_PATH);
    if (!normalizedConfigPath.startsWith(normalizedInputsDir + path.sep)) {
      CONFIG_PATH = null;
    }
  }
  let FIELD_PATH = resolveTournamentFile('Tournament Field', TOURNAMENT_NAME, CURRENT_SEASON, tournamentNameFallback);
  if (FIELD_PATH && tournamentInputsDir) {
    const normalizedInputsDir = path.resolve(tournamentInputsDir) + path.sep;
    const normalizedFieldPath = path.resolve(FIELD_PATH);
    if (!normalizedFieldPath.startsWith(normalizedInputsDir)) {
      FIELD_PATH = null;
    }
  }
  const HISTORY_PATH = resolveTournamentFile('Historical Data', TOURNAMENT_NAME, CURRENT_SEASON, tournamentNameFallback);
  let APPROACH_PATH = resolveTournamentFile('Approach Skill', TOURNAMENT_NAME, CURRENT_SEASON, tournamentNameFallback);
  const manifestApproach = manifestEntry
    ? resolveApproachCsvForEntry(manifestEntry, CURRENT_SEASON)
    : null;
  if (manifestApproach?.path && fs.existsSync(manifestApproach.path)) {
    APPROACH_PATH = manifestApproach.path;
  }
  if (APPROACH_PATH && tournamentInputsDir) {
    const normalizedInputsDir = path.resolve(tournamentInputsDir) + path.sep;
    const normalizedApproachPath = path.resolve(APPROACH_PATH);
    if (!normalizedApproachPath.startsWith(normalizedInputsDir)) {
      APPROACH_PATH = null;
    }
  }
  const POST_TOURNAMENT_HINT = FORCE_RUN_MODE === 'post'
    ? true
    : (FORCE_RUN_MODE === 'pre'
      ? false
      : detectPostTournamentFromHistory(
          HISTORY_PATH,
          CURRENT_EVENT_ID,
          CURRENT_SEASON
        ));
  const normalizedTournamentName = String(TOURNAMENT_NAME || '').trim();
  const isSeasonValidationName = normalizedTournamentName.toLowerCase() === 'all';
  const requireTournamentName = FORCE_RUN_MODE === 'pre'
    || FORCE_RUN_MODE === 'post'
    || RUN_RESULTS_ONLY
    || RUN_VALIDATION_ONLY
    || (!FORCE_RUN_MODE && !POST_TOURNAMENT_HINT);
  if (requireTournamentName && !normalizedTournamentName) {
    console.error('\n❌ Run requires --name (tournament name).');
    console.error('   Required for pre, post, results-only, and validation runs.');
    console.error('   Use --name "all" only for season validation runs.');
    console.error('   Example: node core/optimizer.js --event 9 --season 2026 --name "Arnold Palmer Invitational" --pre');
    process.exit(1);
  }
  if (RUN_SEASON_VALIDATION && !isSeasonValidationName) {
    console.error('\n❌ Season validation requires --name "all" to indicate full-season scope.');
    console.error('   Example: node core/optimizer.js --season 2026 --name "all" --validation --season');
    process.exit(1);
  }
  if (RUN_VALIDATION_ONLY && !RUN_SEASON_VALIDATION && isSeasonValidationName) {
    console.error('\n❌ "all" is reserved for season validation runs.');
    console.error('   Use --name "<tournament name>" for single-tournament validation.');
    process.exit(1);
  }
  const currentEventRoundsDefaults = { ...CURRENT_EVENT_ROUNDS_DEFAULTS };
  if (POST_TOURNAMENT_HINT) {
    currentEventRoundsDefaults.currentSeasonBaseline = true;
    currentEventRoundsDefaults.currentSeasonOptimization = true;
  }
  if (FORCE_RUN_MODE === 'pre') {
    console.log('ℹ️  Forced pre-tournament mode (--pre).');
  } else if (FORCE_RUN_MODE === 'post') {
    console.log('ℹ️  Forced post-tournament mode (--post).');
  }

  const preferPostEventOutputDir = FORCE_RUN_MODE === 'post'
    || (!FORCE_RUN_MODE && POST_TOURNAMENT_HINT);
  const preferredOutputDir = preferPostEventOutputDir
    ? postEventOutputDir
    : preEventOutputDir;
  if (preferredOutputDir) {
    OUTPUT_DIR = preferredOutputDir;
  }

  const seedRunsDir = (!OVERRIDE_OUTPUT_DIR && OPT_SEED_RAW && preferPostEventOutputDir && postEventOutputDir)
    ? resolveSeedRunRoot({
      modeRoot: postEventOutputDir,
      mode: 'post_event',
      isSeeded: true
    })
    : null;
  if (seedRunsDir) {
    ensureDirectory(seedRunsDir);
    OUTPUT_DIR = seedRunsDir;
  }

  requiredFiles[0].path = CONFIG_PATH;
  requiredFiles[1].path = FIELD_PATH;
  requiredFiles[2].path = HISTORY_PATH;
  requiredFiles[3].path = APPROACH_PATH;

  const missingFiles = requiredFiles.filter(file => !file.path || !fs.existsSync(file.path));
  const missingCoreCsv = missingFiles.filter(file => ['Tournament Field', 'Historical Data', 'Approach Skill'].includes(file.name));
  const missingConfigCsv = missingFiles.filter(file => file.name === 'Configuration Sheet');
  if (missingFiles.length > 0) {
    console.log('\n⚠️  Missing input CSVs (these were migration-only; API/cache is primary):');
    missingFiles.forEach(file => {
      const fileExists = file.path ? fs.existsSync(file.path) : false;
      const fileLabel = file.path
        ? `${file.path}${fileExists ? '' : ' (missing)'}`
        : 'n/a';
      console.log(`   - ${file.name}: ${fileLabel}`);
    });
    console.warn('\nExpected locations:');
    console.warn(`   - ${tournamentInputsDir}`);
    console.warn(`   - ${seasonDir}`);
    console.warn(`   - ${DATA_DIR}`);
    console.warn(`   - ${DEFAULT_DATA_DIR}`);
  }

  const shouldFetchApi = missingCoreCsv.length > 0;
  const optionalApiFlag = String(process.env.DATAGOLF_FETCH_OPTIONAL || '').trim().toLowerCase();
  const shouldFetchOptionalApi = optionalApiFlag
    ? !['false', '0', 'no', 'off'].includes(optionalApiFlag)
    : true;
  if (!shouldFetchApi) {
    console.log('ℹ️  CSV inputs present: ; skipping DataGolf core fetches (API fallback mode).');
  }
  if (!shouldFetchOptionalApi) {
    console.log('ℹ️  Optional DataGolf snapshots disabled (skill ratings / decompositions).');
  }

  const fallbackDirName = CONFIG_PATH ? path.basename(path.dirname(CONFIG_PATH)) : null;
  const outputDir = OUTPUT_DIR
    || preEventOutputDir
    || (fallbackDirName ? path.resolve(ROOT_DIR, 'data', fallbackDirName) : null);
  if (LOGGING_ENABLED && !LOGGING_INITIALIZED) {
    const loggingDir = typeof OVERRIDE_OUTPUT_DIR === 'string' && OVERRIDE_OUTPUT_DIR.length > 0
      ? OVERRIDE_OUTPUT_DIR
      : outputDir;
    if (loggingDir) {
      const outputTagRaw = String(process.env.OUTPUT_TAG || '').trim();
      const outputTagSuffix = outputTagRaw
        ? `_${outputTagRaw.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, '')}`
        : '';
      const seedSuffix = OPT_SEED_RAW
        ? `_seed-${String(OPT_SEED_RAW).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, '')}`
        : '';
      const kfoldTag = resolveKFoldTag(process.env.EVENT_KFOLD_K);
      const kfoldTagSuffix = runContext === 'post_event'
        ? `_${String(kfoldTag.tag || 'LOEO')}`
        : '';
      const logContext = `${runContext}${seedSuffix}${kfoldTagSuffix}${outputTagSuffix}`;
      LOGGING_HANDLE = setupLogging(
        loggingDir,
        canonicalTournamentSlug || TOURNAMENT_NAME || OVERRIDE_EVENT_ID || 'event',
        logContext
      );
      LOGGING_INITIALIZED = true;

      // Ensure we always restore stdio overrides even if the script exits early.
      if (LOGGING_HANDLE && typeof LOGGING_HANDLE.teardown === 'function') {
        process.once('exit', () => {
          try {
            LOGGING_HANDLE.teardown();
          } catch (error) {
            // Ignore
          }
        });
      }
    }
  }
  const isSeedRunDir = outputDir && path.basename(outputDir) === 'seed_runs';
  seedRunsParentDir = isSeedRunDir ? path.dirname(outputDir) : null;
  const parentAnalysisDir = seedRunsParentDir ? path.resolve(seedRunsParentDir, 'analysis') : null;
  const parentRegressionDir = seedRunsParentDir ? path.resolve(seedRunsParentDir, 'course_history_regression') : null;
  const parentHasRamp = parentAnalysisDir && fs.existsSync(path.resolve(parentAnalysisDir, 'early_season_ramp_sg_total.json'));
  const parentHasRegression = parentRegressionDir && fs.existsSync(path.resolve(parentRegressionDir, 'course_history_regression.json'));
  const SHOULD_RUN_PRE_EVENT_ARTIFACTS = FORCE_RUN_MODE === 'pre'
    || (!FORCE_RUN_MODE && !POST_TOURNAMENT_HINT);
  const analysisOutputDir = (tournamentDir && SHOULD_RUN_PRE_EVENT_ARTIFACTS)
    ? resolveAnalysisRoot({ tournamentRoot: tournamentDir, mode: 'pre_event' })
    : null;
  const regressionOutputDir = (tournamentDir && SHOULD_RUN_PRE_EVENT_ARTIFACTS)
    ? resolveRegressionRoot({ tournamentRoot: tournamentDir, mode: 'pre_event' })
    : null;
  const dryRunBaseDir = preferPostEventOutputDir ? postEventOutputDir : preEventOutputDir;
  const dryRunOutputDir = dryRunBaseDir
    ? resolveDryRunRoot({ modeRoot: dryRunBaseDir })
    : null;
  if (analysisOutputDir) ensureDirectory(analysisOutputDir);
  if (regressionOutputDir) ensureDirectory(regressionOutputDir);
  if (dryRunOutputDir) ensureDirectory(dryRunOutputDir);
  if (regressionOutputDir) {
    process.env.PRE_TOURNAMENT_OUTPUT_DIR = regressionOutputDir;
  } else if (outputDir) {
    process.env.PRE_TOURNAMENT_OUTPUT_DIR = outputDir;
  }
  if (WRITE_TEMPLATES) {
    process.env.WRITE_TEMPLATES = 'true';
  }
  process.env.PRE_TOURNAMENT_EVENT_ID = String(CURRENT_EVENT_ID || '');
  process.env.PRE_TOURNAMENT_SEASON = String(CURRENT_SEASON || '');

  if (SHOULD_RUN_PRE_EVENT_ARTIFACTS) {
    if (isSeedRunDir && parentHasRegression) {
      console.log('ℹ️  Using existing course history regression outputs from parent post_event directory.');
    } else {
      console.log('🔄 Generating course history regression inputs...');
      try {
        const scriptPath = path.resolve(__dirname, '..', 'scripts', 'analyze_course_history_impact.js');
        const result = spawnSync(process.execPath, [scriptPath], {
          env: process.env,
          stdio: 'inherit'
        });
        if (result.error) {
          console.warn(`ℹ️  Course history regression generation skipped: ${result.error.message}`);
        } else if (result.status === 0) {
          console.log('✓ Course history regression inputs generated.');
        } else {
          console.warn(`ℹ️  Course history regression generation skipped (exit ${result.status}).`);
        }
      } catch (error) {
        console.warn(`ℹ️  Course history regression generation skipped: ${error.message}`);
      }
    }
  } else {
    console.log('ℹ️  Skipping course history regression (post-tournament mode).');
  }

  const rampSummary = SHOULD_RUN_PRE_EVENT_ARTIFACTS
    ? ensureEarlySeasonRampSummary({
        outputDir: analysisOutputDir || outputDir,
        metric: 'sg_total',
        dataDir: DATA_DIR || DATA_ROOT_DIR,
        apiYears: OVERRIDE_API_YEARS
      })
    : null;
  const rampPlayers = Array.isArray(rampSummary?.payload?.players)
    ? rampSummary.payload.players
    : [];
  const rampById = rampPlayers.reduce((acc, entry) => {
    const dgId = String(entry?.dgId || '').trim();
    if (!dgId) return acc;
    acc[dgId] = entry;
    return acc;
  }, {});
  const rampWindow = rampSummary?.payload?.meta?.window || {};
  const rampMaxEvents = Number.isFinite(rampWindow.maxEvents) ? rampWindow.maxEvents : 6;
  const rampBaselineSeasons = Number.isFinite(rampWindow.baselineSeasons) ? rampWindow.baselineSeasons : null;
  if (rampPlayers.length > 0) {
    console.log(`✓ Loaded player ramp summary (${rampPlayers.length} players, maxEvents=${rampMaxEvents})`);
  } else if (SHOULD_RUN_PRE_EVENT_ARTIFACTS) {
    console.log('ℹ️  Player ramp summary unavailable (no ramp file found).');
  } else {
    console.log('ℹ️  Skipping early-season ramp summary (post-tournament mode).');
  }
  const regressionSnapshot = SHOULD_RUN_PRE_EVENT_ARTIFACTS
    ? loadCourseHistoryRegressionMap({
        outputDir: regressionOutputDir || outputDir
      })
    : null;
  let courseContext = loadCourseContext(COURSE_CONTEXT_PATH);
  let courseContextUpdateSummary = null;
  if (courseContext && regressionSnapshot?.map) {
    const upsertResult = upsertCourseContextPastPerformanceWeights(courseContext, regressionSnapshot.map);
    courseContextUpdateSummary = {
      source: regressionSnapshot.source || null,
      path: regressionSnapshot.path || null,
      updated: upsertResult.updated,
      updatedCount: upsertResult.updates.length,
      updates: upsertResult.updates
    };
    if (upsertResult.updated) {
      writeJsonFile(COURSE_CONTEXT_PATH, courseContext);
      console.log(`✓ Updated course_context past performance weights (${upsertResult.updates.length} entries, source=${regressionSnapshot.source}).`);
    } else {
      console.log('ℹ️  Course history regression loaded; no course_context updates needed.');
    }
  } else if (!courseContext) {
    courseContextUpdateSummary = {
      source: regressionSnapshot?.source || null,
      path: regressionSnapshot?.path || null,
      updated: false,
      updatedCount: 0,
      updates: [],
      reason: 'course_context_missing'
    };
    console.warn('ℹ️  Course context not available for regression upsert.');
  } else if (!regressionSnapshot?.map) {
    courseContextUpdateSummary = {
      source: regressionSnapshot?.source || null,
      path: regressionSnapshot?.path || null,
      updated: false,
      updatedCount: 0,
      updates: [],
      reason: 'regression_unavailable'
    };
    if (SHOULD_RUN_PRE_EVENT_ARTIFACTS) {
      console.warn('ℹ️  Course history regression unavailable; skipping course_context upsert.');
    }
  }

  console.log('\n🔄 Loading configuration...');
  if (!courseContext) {
    courseContext = loadCourseContext(COURSE_CONTEXT_PATH);
  }
  const courseContextEntry = resolveCourseContextEntry(courseContext, {
    eventId: CURRENT_EVENT_ID
  });
  // NOTE: We do not rely on configuration-sheet CSVs going forward.
  // `course_context.json.sourcePath` is treated as metadata only.

  let sharedConfig = null;
  if (courseContextEntry) {
    sharedConfig = buildSharedConfigFromCourseContext(courseContextEntry, CURRENT_EVENT_ID);
    console.log('ℹ️  Using course_context.json as primary configuration source.');
  }
  if (!sharedConfig && CONFIG_PATH && fs.existsSync(CONFIG_PATH)) {
    sharedConfig = getSharedConfig(CONFIG_PATH);
    console.log('ℹ️  Using Configuration Sheet as fallback configuration source.');
  }
  if (!sharedConfig) {
    console.error('\n❌ Configuration unavailable: course_context.json entry missing and Configuration Sheet not found.');
    console.error('   Fix: add a course_context entry for this event or provide a Configuration Sheet CSV in the inputs folder.');
    process.exit(1);
  }
  console.log('✓ Configuration loaded');
  const courseContextEntryWithCourse = courseContextEntry || resolveCourseContextEntry(courseContext, {
    eventId: CURRENT_EVENT_ID,
    courseNum: sharedConfig.courseNum
  });
  const courseContextEntryFinal = courseContextEntryWithCourse;
  if (courseContextEntry && applyCourseContextOverrides(sharedConfig, courseContextEntry)) {
    console.log(`✓ Applied course context overrides (${courseContextEntry.source})`);
  } else if (courseContextEntryWithCourse && applyCourseContextOverrides(sharedConfig, courseContextEntryWithCourse)) {
    console.log(`✓ Applied course context overrides (${courseContextEntryWithCourse.source})`);
  }
  const pastPerformanceCourseNum = courseContextEntryFinal?.courseNum
    || sharedConfig.courseNum
    || null;
  const pastPerformanceRegressionEntry = regressionSnapshot?.map && pastPerformanceCourseNum
    ? regressionSnapshot.map[String(pastPerformanceCourseNum).trim()]
    : null;
  const pastPerformanceComputedWeight = computePastPerformanceWeightFromRegression(pastPerformanceRegressionEntry);
  const pastPerformanceWeightSummary = {
    enabled: !!sharedConfig.pastPerformanceEnabled,
    courseNum: pastPerformanceCourseNum,
    computedWeight: pastPerformanceComputedWeight,
    usedWeight: typeof sharedConfig.pastPerformanceWeight === 'number' ? sharedConfig.pastPerformanceWeight : null,
    regression: pastPerformanceRegressionEntry
      ? {
          slope: pastPerformanceRegressionEntry.slope,
          pValue: pastPerformanceRegressionEntry.pValue
        }
      : null,
    source: regressionSnapshot?.source || null,
    path: regressionSnapshot?.path || null,
    courseContextUpdated: courseContextUpdateSummary?.updated || false,
    playerRamp: {
      weight: PAST_PERF_RAMP_WEIGHT,
      sourcePath: rampSummary?.path || null,
      players: rampPlayers.length,
      maxEvents: rampMaxEvents,
      baselineSeasons: rampBaselineSeasons
    }
  };
  const resolvedSeason = parseInt(sharedConfig.currentSeason || sharedConfig.currentYear || CURRENT_SEASON);
  const effectiveSeason = Number.isNaN(resolvedSeason) ? CURRENT_SEASON : resolvedSeason;

  const historicalYear = (() => {
    const parsed = parseInt(DATAGOLF_HISTORICAL_YEAR_RAW, 10);
    return Number.isNaN(parsed) ? effectiveSeason : parsed;
  })();
  let courseTemplateKey = null;

  const currentEventRoundsPolicy = INCLUDE_CURRENT_EVENT_ROUNDS === null
    ? 'default'
    : (INCLUDE_CURRENT_EVENT_ROUNDS ? 'include' : 'exclude');
  console.log(`ℹ️  Current-event rounds policy: ${currentEventRoundsPolicy}`);
  console.log(`   Defaults: metrics=${currentEventRoundsDefaults.currentSeasonMetrics ? 'include' : 'exclude'}, baseline=${currentEventRoundsDefaults.currentSeasonBaseline ? 'include' : 'exclude'}, optimization=${currentEventRoundsDefaults.currentSeasonOptimization ? 'include' : 'exclude'}, historical=${currentEventRoundsDefaults.historicalEvaluation ? 'include' : 'exclude'}`);
  
  // Load base metricConfig structure
  console.log('🔄 Building metric config...');
  const baseMetricConfig = buildMetricGroupsFromConfig({
    getCell: sharedConfig.getCell,
    pastPerformanceEnabled: sharedConfig.pastPerformanceEnabled,
    pastPerformanceWeight: sharedConfig.pastPerformanceWeight,
    currentEventId: CURRENT_EVENT_ID
  });
  console.log('✓ Metric config built');
  
  // Load templates
  const templateConfigs = {};
  
  console.log('\n--- LOADING ALL AVAILABLE TEMPLATES ---');
  Object.entries(WEIGHT_TEMPLATES).forEach(([templateName, template]) => {
    if (!template) return;
    const normalized = normalizeTemplateWeights(template, baseMetricConfig);
    templateConfigs[templateName] = normalized;
    console.log(`✓ Loaded ${templateName} template`);
  });

  if (TEMPLATE) {
    if (!templateConfigs[TEMPLATE]) {
      console.error(`\n❌ Template not found or not available for event ${CURRENT_EVENT_ID}: ${TEMPLATE}`);
      console.error(`   Available: ${Object.keys(templateConfigs).join(', ') || 'none'}`);
      process.exit(1);
    }
    Object.keys(templateConfigs).forEach(name => {
      if (name !== TEMPLATE) delete templateConfigs[name];
    });
    console.log(`✓ Using template override: ${TEMPLATE}`);
  }

  if (!templateConfigs[CURRENT_EVENT_ID]) {
    // Prefer course_context-derived defaults rather than zeroed baseMetricConfig weights.
    const templateKeyRaw = courseContextEntry?.templateKey || courseContextEntry?.courseType || null;
    const templateKey = templateKeyRaw ? String(templateKeyRaw).trim() : null;
    const fallbackTemplateKey = templateKey && templateConfigs[templateKey]
      ? templateKey
      : (templateConfigs.BALANCED ? 'BALANCED' : (templateConfigs.POWER ? 'POWER' : (templateConfigs.TECHNICAL ? 'TECHNICAL' : null)));

    if (fallbackTemplateKey) {
      templateConfigs[CURRENT_EVENT_ID] = {
        groupWeights: { ...templateConfigs[fallbackTemplateKey].groupWeights },
        metricWeights: { ...templateConfigs[fallbackTemplateKey].metricWeights }
      };
      console.log(`✓ Loaded event-specific weights (eventId: ${CURRENT_EVENT_ID}) from template: ${fallbackTemplateKey}`);
    } else {
      const groupWeights = {};
      const metricWeights = {};
      baseMetricConfig.groups.forEach(group => {
        groupWeights[group.name] = group.weight;
        group.metrics.forEach(metric => {
          metricWeights[`${group.name}::${metric.name}`] = metric.weight;
        });
      });
      templateConfigs[CURRENT_EVENT_ID] = { groupWeights, metricWeights };
      console.warn(`⚠️  Loaded event-specific weights (eventId: ${CURRENT_EVENT_ID}) from base metric config (no templateKey/courseType found in course_context).`);
    }
  }

  const metricConfig = baseMetricConfig;

  const shouldAutoRunValidation = !RUN_VALIDATION_ONLY
    && !RUN_RESULTS_ONLY
    && (FORCE_RUN_MODE === 'post' || (!FORCE_RUN_MODE && POST_TOURNAMENT_HINT));
  const normalizedValidationSlug = normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback) || baseName;
  const shouldRefreshValidationOutputs = (() => {
    if (!shouldAutoRunValidation || !validationOutputsDir) return false;
    const classificationPath = path.resolve(validationOutputsDir, `${OUTPUT_NAMES.courseTypeClassification}.json`);
    const classificationPayload = readJsonFile(classificationPath);
    const entries = Array.isArray(classificationPayload?.entries) ? classificationPayload.entries : [];
    const matchesEntry = entries.some(entry => {
      const entryEventId = entry?.eventId !== undefined && entry?.eventId !== null
        ? String(entry.eventId).trim()
        : '';
      const entrySlug = normalizeTournamentSlug(entry?.tournament || '');
      return (entryEventId && entryEventId === String(CURRENT_EVENT_ID || '').trim())
        || (entrySlug && normalizedValidationSlug && entrySlug === normalizedValidationSlug);
    });
    if (!matchesEntry) return true;

    const summariesDir = path.resolve(validationOutputsDir, 'template_correlation_summaries');
    const summaryFiles = ['POWER_Correlation_Summary.json', 'TECHNICAL_Correlation_Summary.json', 'BALANCED_Correlation_Summary.json']
      .map(name => path.resolve(summariesDir, name));
    const summariesMissing = summaryFiles.some(filePath => !fs.existsSync(filePath));
    if (summariesMissing) return true;
    return false;
  })();

  if (shouldRefreshValidationOutputs) {
    try {
      const { runValidation } = require('./validationRunner');
      if (typeof runValidation === 'function') {
        console.log(`🔄 Auto-running validation (post-tournament, slug=${normalizedValidationSlug})...`);
        await runValidation({
          season: CURRENT_SEASON,
          dataRootDir: DATA_ROOT_DIR,
          tournamentName: TOURNAMENT_NAME,
          tournamentSlug: normalizedValidationSlug,
          tournamentDir,
          eventId: CURRENT_EVENT_ID,
          writeTemplates: WRITE_TEMPLATES,
          dryRun: DRY_RUN,
          dryRunDir: null
        });
      }
    } catch (error) {
      console.warn(`⚠️  Auto-validation skipped: ${error.message}`);
    }
  }

  let validationData = loadValidationOutputs(metricConfig, [
    validationOutputsDir,
    path.resolve(DATA_ROOT_DIR, 'validation_outputs'),
    ...VALIDATION_OUTPUT_DIRS,
    DATA_DIR,
    DEFAULT_DATA_DIR
  ]);
  const skipValidationOutputs = RUN_RESULTS_ONLY
    || ['1', 'true', 'yes'].includes(String(process.env.SKIP_VALIDATION_OUTPUTS || '').trim().toLowerCase());
  if (!validationData?.weightTemplatesPath || !validationData?.deltaTrendsPath) {
    const missing = [];
    if (!validationData?.weightTemplatesPath) missing.push('validation weight templates CSV');
    if (!validationData?.deltaTrendsPath) missing.push('validation delta trends CSV');
    if (!skipValidationOutputs && !RUN_RESULTS_ONLY) {
      console.error('\n❌ Validation outputs missing:');
      missing.forEach(item => console.error(`   - ${item}`));
      console.error('\nThis optimizer run requires the Algo Validation outputs (weight templates + delta trends).');
      console.error('Run the GAS validation workflow first, then place the resulting CSVs in:');
      console.error(`   - ${validationOutputsDir}`);
      console.error(`   - ${path.resolve(DATA_ROOT_DIR, 'validation_outputs')}`);
      console.error(`   - ${DATA_DIR}`);
      console.error(`   - ${DEFAULT_DATA_DIR}`);
      console.error('\nFix: re-run validation and copy the CSVs into one of those folders, or update filenames in optimizer.js.');
      process.exit(1);
    }
    console.warn('\n⚠️  Validation outputs missing, but SKIP_VALIDATION_OUTPUTS is enabled. Proceeding without validation priors.');
  }

  const validationDataSafe = validationData || {
    courseType: null,
    weightTemplates: { POWER: [], TECHNICAL: [], BALANCED: [] },
    typeSummaries: { POWER: [], TECHNICAL: [], BALANCED: [] },
    deltaTrends: [],
    deltaTrendsPath: null,
    weightTemplatesPath: null
  };
  validationData = validationDataSafe;

  let rankingsSnapshot = { source: 'csv_primary', path: null, payload: null };
  const SHOULD_REFRESH_YTD = (() => {
    const isPre = FORCE_RUN_MODE === 'pre' || (!FORCE_RUN_MODE && !POST_TOURNAMENT_HINT);
    if (!manifestEventDateInfo?.time) return isPre;
    const entries = Array.isArray(manifestEntries) ? manifestEntries : [];
    const currentEntry = resolveManifestEntryForEvent(entries, {
      eventId: CURRENT_EVENT_ID,
      tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback
    });
    const previousEntry = currentEntry ? resolvePreviousManifestEntry(entries, currentEntry) : null;
    const currentTime = manifestEventDateInfo.time;
    const previousTime = previousEntry?.date ? parseDateToUtcMs(previousEntry.date) : NaN;
    const ytdCandidates = buildApproachSnapshotCandidates({
      dataRootDir: DATA_ROOT_DIR,
      season: CURRENT_SEASON,
      manifestEntries: entries
    }).filter(entry => entry?.source === 'snapshot_archive' || entry?.source === 'snapshot_latest');

    if (isPre) {
      const hasWindowSnapshot = ytdCandidates.some(entry => {
        if (Number.isNaN(currentTime)) return false;
        if (!Number.isNaN(previousTime)) {
          return entry.time > previousTime && entry.time <= currentTime;
        }
        return entry.time <= currentTime;
      });
      return !hasWindowSnapshot;
    }

    const hasPostSnapshot = ytdCandidates.some(entry => entry.time > currentTime);
    return !hasPostSnapshot;
  })();
  const IS_POST_TOURNAMENT_RUN = FORCE_RUN_MODE === 'post' || (!FORCE_RUN_MODE && POST_TOURNAMENT_HINT);
  const IS_PRE_TOURNAMENT_RUN = !IS_POST_TOURNAMENT_RUN;
  const SHOULD_FETCH_APPROACH_ARCHIVES = (() => {
    if (!IS_POST_TOURNAMENT_RUN) return false;
    const seasonValue = parseInt(String(effectiveSeason || '').trim(), 10);
    const eventIdValue = String(CURRENT_EVENT_ID || '').trim();
    const forceRefresh = APPROACH_L12_FORCE_REFRESH === '1' || APPROACH_L12_FORCE_REFRESH === 'true';
    const matchesRefreshSeason = APPROACH_L12_REFRESH_SEASON && seasonValue
      ? String(seasonValue) === APPROACH_L12_REFRESH_SEASON
      : false;
    const matchesRefreshEvent = APPROACH_L12_REFRESH_EVENT_ID && eventIdValue
      ? eventIdValue === APPROACH_L12_REFRESH_EVENT_ID
      : false;
    return forceRefresh || matchesRefreshSeason || matchesRefreshEvent;
  })();
  if (shouldFetchApi) {
    rankingsSnapshot = { source: 'unavailable', path: null, payload: null };
    try {
      rankingsSnapshot = await getDataGolfRankings({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: null,
        ttlMs: DATAGOLF_RANKINGS_TTL_HOURS * 60 * 60 * 1000,
        allowStale: false
      });

      if (rankingsSnapshot?.payload?.last_updated) {
        console.log(`✓ DataGolf rankings loaded (${rankingsSnapshot.source}, updated ${rankingsSnapshot.payload.last_updated})`);
      } else if (rankingsSnapshot.source === 'missing-key') {
        console.warn('ℹ️  DataGolf rankings skipped (DATAGOLF_API_KEY not set).');
      } else if (rankingsSnapshot.source === 'cache-stale') {
        console.warn('ℹ️  DataGolf rankings using stale cache (API unavailable).');
      } else if (!rankingsSnapshot.payload) {
        console.warn('ℹ️  DataGolf rankings unavailable (no cache + API failed).');
      }
    } catch (error) {
      console.warn(`ℹ️  DataGolf rankings fetch failed: ${error.message}`);
    }
  }
  logSnapshotFreshness({ label: 'DataGolf rankings', snapshot: rankingsSnapshot, ttlHours: DATAGOLF_RANKINGS_TTL_HOURS });

  let approachSkillSnapshot = { source: 'skipped', path: null, payload: null };
  const hasApproachCsvFile = !!(APPROACH_PATH && fs.existsSync(APPROACH_PATH));
  const hasYtdSnapshotFile = !!(APPROACH_SNAPSHOT_YTD_LATEST_PATH && fs.existsSync(APPROACH_SNAPSHOT_YTD_LATEST_PATH));
  const shouldFetchApproachSkill = shouldFetchApi && !hasApproachCsvFile && !hasYtdSnapshotFile;
  if (shouldFetchApproachSkill) {
    approachSkillSnapshot = { source: 'unavailable', path: null, payload: null };
    try {
      approachSkillSnapshot = await getDataGolfApproachSkill({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: null,
        ttlMs: DATAGOLF_APPROACH_TTL_HOURS * 60 * 60 * 1000,
        allowStale: true,
        period: DATAGOLF_APPROACH_PERIOD,
        fileFormat: 'json'
      });

      if (approachSkillSnapshot?.payload?.last_updated) {
        const timePeriod = approachSkillSnapshot.payload.time_period || DATAGOLF_APPROACH_PERIOD;
        console.log(`✓ DataGolf approach skill loaded (${approachSkillSnapshot.source}, ${timePeriod}, updated ${approachSkillSnapshot.payload.last_updated})`);
      } else if (approachSkillSnapshot.source === 'missing-key') {
        console.warn('ℹ️  DataGolf approach skill skipped (DATAGOLF_API_KEY not set).');
      } else if (approachSkillSnapshot.source === 'cache-stale') {
        console.warn('ℹ️  DataGolf approach skill using stale cache (API unavailable).');
      } else if (!approachSkillSnapshot.payload) {
        console.warn('ℹ️  DataGolf approach skill unavailable (no cache + API failed).');
      }
    } catch (error) {
      console.warn(`ℹ️  DataGolf approach skill fetch failed: ${error.message}`);
    }
  }
  if (approachSkillSnapshot?.payload) {
    logSnapshotFreshness({ label: 'DataGolf approach skill', snapshot: approachSkillSnapshot, ttlHours: DATAGOLF_APPROACH_TTL_HOURS });
  }

  ensureDirectory(APPROACH_SNAPSHOT_DIR);
  let approachSnapshotL24 = loadApproachSnapshotFromDisk(APPROACH_SNAPSHOT_L24_PATH);
  let approachSnapshotL12 = loadApproachSnapshotFromDisk(APPROACH_SNAPSHOT_L12_PATH);
  let approachSnapshotYtd = loadApproachSnapshotFromDisk(APPROACH_SNAPSHOT_YTD_LATEST_PATH);
  let approachYtdUpdatedThisRun = false;
  let fieldUpdatesUpdatedThisRun = false;

  if (!approachSnapshotL12?.payload) {
    const latestL12Archive = listApproachSnapshotArchives().find(entry => entry.period === 'l12');
    if (latestL12Archive?.path && fs.existsSync(latestL12Archive.path)) {
      approachSnapshotL12 = loadApproachSnapshotFromDisk(latestL12Archive.path);
      if (approachSnapshotL12?.payload) {
        console.log(`ℹ️  Loaded L12 approach snapshot from archive (${path.basename(latestL12Archive.path)}).`);
      }
    }
  }

  if (shouldFetchApi) {
    if (!approachSnapshotL24?.payload) {
      try {
        approachSnapshotL24 = await getOrCreateApproachSnapshot({
          period: 'l24',
          snapshotPath: APPROACH_SNAPSHOT_L24_PATH,
          apiKey: DATAGOLF_API_KEY,
          cacheDir: null,
          ttlMs: DATAGOLF_APPROACH_TTL_HOURS * 60 * 60 * 1000,
          season: CURRENT_SEASON,
          eventId: CURRENT_EVENT_ID,
          isPostTournament: POST_TOURNAMENT_HINT
        });
        if (approachSnapshotL24?.payload?.last_updated) {
          console.log(`✓ Approach snapshot l24 ready (${approachSnapshotL24.source}, updated ${approachSnapshotL24.payload.last_updated})`);
        }
      } catch (error) {
        console.warn(`ℹ️  Approach snapshot l24 fetch failed: ${error.message}`);
      }
    }

    if (SHOULD_FETCH_APPROACH_ARCHIVES) {
      try {
        approachSnapshotL12 = await getOrCreateApproachSnapshot({
          period: 'l12',
          snapshotPath: APPROACH_SNAPSHOT_L12_PATH,
          apiKey: DATAGOLF_API_KEY,
          cacheDir: null,
          ttlMs: DATAGOLF_APPROACH_TTL_HOURS * 60 * 60 * 1000,
          season: CURRENT_SEASON,
          eventId: CURRENT_EVENT_ID,
          isPostTournament: POST_TOURNAMENT_HINT
        });
        if (approachSnapshotL12?.payload?.last_updated) {
          console.log(`✓ Approach snapshot l12 ready (${approachSnapshotL12.source}, updated ${approachSnapshotL12.payload.last_updated})`);
        }
      } catch (error) {
        console.warn(`ℹ️  Approach snapshot l12 fetch failed: ${error.message}`);
      }
    } else {
      if (approachSnapshotL12?.payload) {
        console.log('ℹ️  Skipping L12 approach snapshot refresh (not end-of-season post-tournament run; cached snapshot found).');
      } else {
        console.log('ℹ️  Skipping L12 approach snapshot (not end-of-season post-tournament run).');
      }
    }

    if (SHOULD_REFRESH_YTD) {
      try {
        approachSnapshotYtd = await refreshYtdApproachSnapshot({
          apiKey: DATAGOLF_API_KEY,
          cacheDir: null,
          ttlMs: DATAGOLF_APPROACH_TTL_HOURS * 60 * 60 * 1000
        });
        if (approachSnapshotYtd?.payload?.last_updated) {
          console.log(`✓ Approach snapshot ytd ready (${approachSnapshotYtd.source}, updated ${approachSnapshotYtd.payload.last_updated})`);
        }
        if (approachSnapshotYtd?.payload && approachSnapshotYtd?.source === 'api') {
          approachYtdUpdatedThisRun = true;
        }
      } catch (error) {
        console.warn(`ℹ️  Approach snapshot ytd fetch failed: ${error.message}`);
      }
    } else {
      if (approachSnapshotYtd?.payload) {
        console.log('ℹ️  Skipping YTD approach snapshot refresh (post-tournament run; cached snapshot found).');
      } else {
        console.log('ℹ️  Skipping YTD approach snapshot refresh (post-tournament run).');
      }
    }
  }

  logSnapshotFreshness({ label: 'Approach snapshot L24', snapshot: approachSnapshotL24, ttlHours: DATAGOLF_APPROACH_TTL_HOURS });
  logSnapshotFreshness({ label: 'Approach snapshot L12', snapshot: approachSnapshotL12, ttlHours: DATAGOLF_APPROACH_TTL_HOURS });
  logSnapshotFreshness({ label: 'Approach snapshot YTD', snapshot: approachSnapshotYtd, ttlHours: DATAGOLF_APPROACH_TTL_HOURS });

  if (IS_POST_TOURNAMENT_RUN && manifestEventDateInfo?.time) {
    const ytdArchive = selectApproachArchiveForEvent({
      eventDateMs: manifestEventDateInfo.time,
      period: 'ytd'
    });
    if (ytdArchive?.path && fs.existsSync(ytdArchive.path)) {
      const snapshot = loadApproachSnapshotFromDisk(ytdArchive.path);
      if (snapshot?.payload) {
        approachSnapshotYtd = { ...snapshot, source: 'snapshot_archive', path: ytdArchive.path };
        console.log(`ℹ️  Using event-aligned YTD snapshot for post-tournament run: ${path.basename(ytdArchive.path)}.`);
      }
    }
  }
  if (IS_PRE_TOURNAMENT_RUN && manifestEventDateInfo?.time) {
    const preArchives = listApproachSnapshotArchives()
      .filter(entry => entry.period === 'ytd' && (entry.time || 0) <= manifestEventDateInfo.time)
      .sort((a, b) => (b.time || 0) - (a.time || 0));
    const preArchive = preArchives[0] || null;
    if (preArchive?.path && fs.existsSync(preArchive.path)) {
      const snapshot = loadApproachSnapshotFromDisk(preArchive.path);
      if (snapshot?.payload) {
        approachSnapshotYtd = { ...snapshot, source: 'snapshot_archive', path: preArchive.path };
        console.log(`ℹ️  Using event-aligned YTD snapshot for pre-tournament run: ${path.basename(preArchive.path)}.`);
      }
    }
  }
  let fieldUpdatesSnapshot = { source: 'csv_primary', path: null, payload: null };
  if (shouldFetchApi) {
    fieldUpdatesSnapshot = { source: 'unavailable', path: null, payload: null };
    try {
      const fieldTtlMs = IS_POST_TOURNAMENT_RUN
        ? DATAGOLF_FIELD_TTL_HOURS * 60 * 60 * 1000
        : 0;
      const fieldCacheSlug = canonicalTournamentSlug;
      fieldUpdatesSnapshot = await getDataGolfFieldUpdates({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: DATAGOLF_CACHE_DIR,
        ttlMs: fieldTtlMs,
        allowStale: true,
        preferCache: true,
        tour: DATAGOLF_FIELD_TOUR,
        cacheSlug: fieldCacheSlug,
        fileFormat: 'json',
        expectedEventId: CURRENT_EVENT_ID,
        expectedEventName: canonicalTournamentName
      });

      if (fieldUpdatesSnapshot?.payload?.event_name) {
        console.log(`✓ DataGolf field updates loaded (${fieldUpdatesSnapshot.source}, ${fieldUpdatesSnapshot.payload.event_name})`);
      } else if (fieldUpdatesSnapshot.source === 'missing-key') {
        console.warn('ℹ️  DataGolf field updates skipped (DATAGOLF_API_KEY not set).');
      } else if (fieldUpdatesSnapshot.source === 'cache-stale') {
        console.warn('ℹ️  DataGolf field updates using stale cache (API unavailable).');
      } else if (!fieldUpdatesSnapshot.payload) {
        console.warn('ℹ️  DataGolf field updates unavailable (no cache + API failed).');
      }
    } catch (error) {
      console.warn(`ℹ️  DataGolf field updates fetch failed: ${error.message}`);
    }
  }

  let fieldUpdatesMismatch = false;
  if (fieldUpdatesSnapshot?.payload?.event_id && CURRENT_EVENT_ID) {
    const expectedId = String(CURRENT_EVENT_ID).trim();
    const actualId = String(fieldUpdatesSnapshot.payload.event_id).trim();
    if (expectedId && actualId && expectedId !== actualId) {
      fieldUpdatesMismatch = true;
      console.warn(`⚠️  Field updates event_id mismatch: expected ${expectedId}, got ${actualId}`);
    }
  }
  if (!fieldUpdatesMismatch && fieldUpdatesSnapshot?.payload?.event_name && TOURNAMENT_NAME) {
    const expected = normalizeNameForMatch(TOURNAMENT_NAME);
    const actual = normalizeNameForMatch(fieldUpdatesSnapshot.payload.event_name);
    if (expected && actual && expected !== actual) {
      console.warn(`ℹ️  Field updates name differs but event_id matches: expected ${TOURNAMENT_NAME}, got ${fieldUpdatesSnapshot.payload.event_name}`);
    }
  }
  if (fieldUpdatesMismatch && shouldFetchApi && DATAGOLF_API_KEY) {
    console.warn('⚠️  Field updates cache mismatch; retrying DataGolf API for expected event.');
    try {
      const fieldCacheSlug = canonicalTournamentSlug;
      const refreshed = await getDataGolfFieldUpdates({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: DATAGOLF_CACHE_DIR,
        ttlMs: 0,
        allowStale: false,
        preferCache: false,
        tour: DATAGOLF_FIELD_TOUR,
        cacheSlug: fieldCacheSlug,
        fileFormat: 'json',
        expectedEventId: CURRENT_EVENT_ID,
        expectedEventName: canonicalTournamentName
      });
      if (refreshed?.payload?.event_name) {
        fieldUpdatesSnapshot = refreshed;
        fieldUpdatesMismatch = false;
        if (TOURNAMENT_NAME) {
          const expected = normalizeNameForMatch(TOURNAMENT_NAME);
          const actual = normalizeNameForMatch(refreshed.payload.event_name);
          if (expected && actual && expected !== actual) fieldUpdatesMismatch = true;
        }
        if (refreshed?.payload?.event_id && CURRENT_EVENT_ID) {
          const expectedId = String(CURRENT_EVENT_ID).trim();
          const actualId = String(refreshed.payload.event_id).trim();
          if (expectedId && actualId && expectedId !== actualId) fieldUpdatesMismatch = true;
        }
      }
    } catch (error) {
      console.warn(`ℹ️  Field updates API retry failed: ${error.message}`);
    }
  }
  if (!fieldUpdatesMismatch && fieldUpdatesSnapshot?.source === 'api' && fieldUpdatesSnapshot?.path) {
    fieldUpdatesUpdatedThisRun = true;
  }
  if (fieldUpdatesMismatch && (FORCE_RUN_MODE === 'pre' || !POST_TOURNAMENT_HINT)) {
    console.warn('⚠️  Field updates mismatch during pre-tournament run; ignoring field updates payload for weather calculations.');
    fieldUpdatesSnapshot = { ...fieldUpdatesSnapshot, payload: null };
  }

  logSnapshotFreshness({ label: 'DataGolf field updates', snapshot: fieldUpdatesSnapshot, ttlHours: DATAGOLF_FIELD_TTL_HOURS });

  const SHOULD_FETCH_VALIDATION_SNAPSHOTS = shouldFetchOptionalApi && IS_POST_TOURNAMENT_RUN;
  let playerDecompositionsSnapshot = { source: 'skipped', path: null, payload: null };
  if (SHOULD_FETCH_VALIDATION_SNAPSHOTS) {
    playerDecompositionsSnapshot = { source: 'unavailable', path: null, payload: null };
    try {
      playerDecompositionsSnapshot = await getDataGolfPlayerDecompositions({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: null,
        ttlMs: DATAGOLF_DECOMP_TTL_HOURS * 60 * 60 * 1000,
        allowStale: false,
        tour: DATAGOLF_DECOMP_TOUR,
        fileFormat: 'json'
      });

      if (playerDecompositionsSnapshot?.payload?.last_updated) {
        console.log(`✓ DataGolf player decompositions loaded (${playerDecompositionsSnapshot.source}, updated ${playerDecompositionsSnapshot.payload.last_updated})`);
      } else if (playerDecompositionsSnapshot.source === 'missing-key') {
        console.warn('ℹ️  DataGolf player decompositions skipped (DATAGOLF_API_KEY not set).');
      } else if (playerDecompositionsSnapshot.source === 'cache-stale') {
        console.warn('ℹ️  DataGolf player decompositions using stale cache (API unavailable).');
      } else if (!playerDecompositionsSnapshot.payload) {
        console.warn('ℹ️  DataGolf player decompositions unavailable (no cache + API failed).');
      }
    } catch (error) {
      console.warn(`ℹ️  DataGolf player decompositions fetch failed: ${error.message}`);
    }
  }

  let skillRatingsValueSnapshot = { source: 'skipped', path: null, payload: null };
  if (SHOULD_FETCH_VALIDATION_SNAPSHOTS) {
    skillRatingsValueSnapshot = { source: 'unavailable', path: null, payload: null };
    try {
      skillRatingsValueSnapshot = await getDataGolfSkillRatings({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: null,
        ttlMs: DATAGOLF_SKILL_TTL_HOURS * 60 * 60 * 1000,
        allowStale: false,
        display: DATAGOLF_SKILL_DISPLAY_VALUE,
        fileFormat: 'json'
      });

      if (skillRatingsValueSnapshot?.payload?.last_updated) {
        console.log(`✓ DataGolf skill ratings loaded (${skillRatingsValueSnapshot.source}, display ${DATAGOLF_SKILL_DISPLAY_VALUE}, updated ${skillRatingsValueSnapshot.payload.last_updated})`);
      } else if (skillRatingsValueSnapshot.source === 'missing-key') {
        console.warn('ℹ️  DataGolf skill ratings skipped (DATAGOLF_API_KEY not set).');
      } else if (skillRatingsValueSnapshot.source === 'cache-stale') {
        console.warn('ℹ️  DataGolf skill ratings using stale cache (API unavailable).');
      } else if (!skillRatingsValueSnapshot.payload) {
        console.warn('ℹ️  DataGolf skill ratings unavailable (no cache + API failed).');
      }
    } catch (error) {
      console.warn(`ℹ️  DataGolf skill ratings fetch failed: ${error.message}`);
    }
  }

  let skillRatingsRankSnapshot = { source: 'skipped', path: null, payload: null };
  if (SHOULD_FETCH_VALIDATION_SNAPSHOTS) {
    skillRatingsRankSnapshot = { source: 'unavailable', path: null, payload: null };
    try {
      skillRatingsRankSnapshot = await getDataGolfSkillRatings({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: null,
        ttlMs: DATAGOLF_SKILL_TTL_HOURS * 60 * 60 * 1000,
        allowStale: false,
        display: DATAGOLF_SKILL_DISPLAY_RANK,
        fileFormat: 'json'
      });

      if (skillRatingsRankSnapshot?.payload?.last_updated) {
        console.log(`✓ DataGolf skill ratings loaded (${skillRatingsRankSnapshot.source}, display ${DATAGOLF_SKILL_DISPLAY_RANK}, updated ${skillRatingsRankSnapshot.payload.last_updated})`);
      } else if (skillRatingsRankSnapshot.source === 'missing-key') {
        console.warn('ℹ️  DataGolf skill ratings skipped (DATAGOLF_API_KEY not set).');
      } else if (skillRatingsRankSnapshot.source === 'cache-stale') {
        console.warn('ℹ️  DataGolf skill ratings using stale cache (API unavailable).');
      } else if (!skillRatingsRankSnapshot.payload) {
        console.warn('ℹ️  DataGolf skill ratings unavailable (no cache + API failed).');
      }
    } catch (error) {
      console.warn(`ℹ️  DataGolf skill ratings (rank) fetch failed: ${error.message}`);
    }
  }

  let historicalRoundsSnapshot = { source: 'csv_primary', path: null, payload: null };
  if (shouldFetchApi) {
    historicalRoundsSnapshot = { source: 'unavailable', path: null, payload: null };
    try {
      historicalRoundsSnapshot = await getDataGolfHistoricalRounds({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: DATAGOLF_CACHE_DIR,
        ttlMs: DATAGOLF_HISTORICAL_TTL_HOURS * 60 * 60 * 1000,
        allowStale: true,
        tour: DATAGOLF_HISTORICAL_TOUR,
        eventId: DATAGOLF_HISTORICAL_EVENT_ID,
        year: historicalYear,
        fileFormat: 'json'
      });

      if (historicalRoundsSnapshot?.payload) {
        console.log(`✓ DataGolf historical rounds loaded (${historicalRoundsSnapshot.source}, ${DATAGOLF_HISTORICAL_TOUR} ${historicalYear})`);
      } else if (historicalRoundsSnapshot.source === 'missing-key') {
        console.warn('ℹ️  DataGolf historical rounds skipped (DATAGOLF_API_KEY not set).');
      } else if (historicalRoundsSnapshot.source === 'missing-year') {
        console.warn('ℹ️  DataGolf historical rounds skipped (year not set).');
      } else if (historicalRoundsSnapshot.source === 'cache-stale') {
        console.warn('ℹ️  DataGolf historical rounds using stale cache (API unavailable).');
      } else if (!historicalRoundsSnapshot.payload) {
        console.warn('ℹ️  DataGolf historical rounds unavailable (no cache + API failed).');
      }
    } catch (error) {
      console.warn(`ℹ️  DataGolf historical rounds fetch failed: ${error.message}`);
    }
  }
  const applyValidationOutputs = ['1', 'true', 'yes'].includes(
    String(process.env.APPLY_VALIDATION_OUTPUTS || '').trim().toLowerCase()
  );
  let validationCourseType = validationData.courseType;
  let validationTemplateConfig = null;
  let validationMetricConstraints = null;
  let validationAlignmentMap = new Map();
  let deltaTrendAlignmentMap = new Map();
  let deltaTrends = [];
  let deltaTrendSummary = null;
  let validationGroupWeights = null;
  let validationMetricWeights = null;
  let validationTemplateName = null;

  if (validationCourseType) {
    const validationWeightsForType = validationData.weightTemplates[validationCourseType] || [];
    const validationSummaryForType = validationData.typeSummaries[validationCourseType] || [];
    const fallbackValidationTemplate = templateConfigs[validationCourseType]
      || templateConfigs[CURRENT_EVENT_ID]
      || Object.values(templateConfigs)[0];
    validationGroupWeights = buildValidationGroupWeights(metricConfig, validationSummaryForType, fallbackValidationTemplate?.groupWeights || {});
    validationMetricWeights = buildValidationMetricWeights(metricConfig, validationWeightsForType, fallbackValidationTemplate?.metricWeights || {});
    validationTemplateConfig = {
      groupWeights: validationGroupWeights || fallbackValidationTemplate?.groupWeights || {},
      metricWeights: validationMetricWeights || fallbackValidationTemplate?.metricWeights || {}
    };
    validationTemplateName = `VALIDATION_${validationCourseType}`;
    templateConfigs[validationTemplateName] = validationTemplateConfig;
    console.log(`✓ Loaded validation template: ${validationTemplateName}`);
    console.log('ℹ️  Validation template is included in Step 1d template testing.');

    if (!applyValidationOutputs) {
      console.log('ℹ️  Validation outputs loaded for reporting only (no template/constraint influence).');
      console.log('   To apply validation templates/constraints, set APPLY_VALIDATION_OUTPUTS=true.');
    } else {
      validationMetricConstraints = buildValidationMetricConstraints(metricConfig, validationWeightsForType, VALIDATION_RANGE_PCT);
      validationAlignmentMap = buildValidationAlignmentMap(metricConfig, validationSummaryForType);
      deltaTrends = validationData.deltaTrends || [];
      deltaTrendAlignmentMap = buildDeltaTrendMap(metricConfig, deltaTrends);
      if (deltaTrends.length > 0) {
        validationMetricConstraints = adjustConstraintsByDeltaTrends(metricConfig, validationMetricConstraints, deltaTrends);
        deltaTrendSummary = summarizeDeltaTrendGuardrails(metricConfig, validationMetricConstraints, deltaTrends);
        console.log(`✓ Applied delta trend guardrails (${deltaTrends.length} metrics)`);
      }
    }
  }

  const resolvedTestsForFingerprint = (() => {
    const parsedTests = parseInt(OPT_TESTS_RAW, 10);
    if (!Number.isNaN(parsedTests)) return parsedTests;
    return typeof MAX_TESTS_OVERRIDE === 'number' ? MAX_TESTS_OVERRIDE : null;
  })();
  const runFingerprint = buildRunFingerprint({
    eventId: CURRENT_EVENT_ID,
    season: effectiveSeason,
    tournament: TOURNAMENT_NAME || tournamentNameFallback,
    optSeed: OPT_SEED_RAW,
    tests: resolvedTestsForFingerprint,
    dryRun: DRY_RUN,
    includeCurrentEventRounds: INCLUDE_CURRENT_EVENT_ROUNDS,
    templateOverride: TEMPLATE,
    filePaths: [
      { label: 'configurationSheet', path: CONFIG_PATH },
      { label: 'tournamentField', path: FIELD_PATH },
      { label: 'historicalData', path: HISTORY_PATH },
      { label: 'approachSkill', path: APPROACH_PATH },
      { label: APPROACH_DELTA_PRIOR_LABEL, path: APPROACH_DELTA_PATH },
      { label: 'weightTemplatesJs', path: path.resolve(ROOT_DIR, 'utilities', 'weightTemplates.js') }
    ],
    validationPaths: [
      { label: 'validationWeightTemplates', path: validationData?.weightTemplatesPath || null },
      { label: 'validationDeltaTrends', path: validationData?.deltaTrendsPath || null }
    ]
  });

  console.log('\n🔄 Loading data...');
  const fieldCsvRows = (FIELD_PATH && fs.existsSync(FIELD_PATH))
    ? loadCsv(FIELD_PATH, { skipFirstColumn: true })
    : [];
  const fieldApiRows = extractFieldRowsFromSnapshotPayload(fieldUpdatesSnapshot?.payload)
    .map(normalizeFieldRow)
    .filter(Boolean);
  const fieldDataRaw = fieldApiRows.length > 0 ? fieldApiRows : fieldCsvRows;
  const fieldData = fieldDataRaw.filter(row => {
    const dgId = row && (row['dg_id'] || row.dg_id || row.dgId || row['DG ID']);
    return String(dgId || '').trim().length > 0;
  });
  if (fieldApiRows.length === 0 && fieldCsvRows.length > 0) {
    const normalizedCsvField = fieldCsvRows
      .map(normalizeFieldRow)
      .filter(Boolean);
    const retainsFieldUpdatesPayload = !!(
      fieldUpdatesSnapshot?.payload
      && (fieldUpdatesSnapshot.payload.date_start
        || fieldUpdatesSnapshot.payload.course_name
        || fieldUpdatesSnapshot.payload.event_name)
    );
    if (retainsFieldUpdatesPayload) {
      console.log(`✓ Field list loaded from Tournament Field CSV (${normalizedCsvField.length} players).`);
      console.log('ℹ️  Retaining DataGolf field updates payload for weather calculations.');
    } else {
      fieldUpdatesSnapshot = {
        source: 'csv_field',
        path: FIELD_PATH,
        payload: {
          event_id: CURRENT_EVENT_ID ? String(CURRENT_EVENT_ID).trim() : null,
          event_name: TOURNAMENT_NAME || tournamentNameFallback || null,
          tour: DATAGOLF_FIELD_TOUR || null,
          field: normalizedCsvField
        }
      };
      console.log(`✓ Field updates sourced from Tournament Field CSV (${normalizedCsvField.length} players).`);
    }
    fieldUpdatesMismatch = false;
  }
  if (fieldApiRows.length > 0) {
    console.log(`✓ Loaded field (cache/API): ${fieldData.length} players`);
  } else if (fieldCsvRows.length > 0) {
    console.log(`✓ Loaded field (CSV): ${fieldData.length} players`);
  } else {
    console.error('❌ Unable to load tournament field (CSV missing and API fallback empty).');
    process.exit(1);
  }

  let weatherWaveSummary = null;
  const weatherPenaltyCachePath = preEventOutputDir
    ? path.resolve(preEventOutputDir, WEATHER_PENALTY_CACHE_FILENAME)
    : null;
  const applyCachedWeatherPenalties = (payload, sourceLabel) => {
    if (!payload || typeof payload !== 'object') return false;
    if (!payload.penalties || typeof payload.penalties !== 'object') return false;
    const penalties = payload.penalties || {};
    const r1Am = penalties.R1_AM?.total ?? 0;
    const r1Pm = penalties.R1_PM?.total ?? 0;
    const r2Am = penalties.R2_AM?.total ?? 0;
    const r2Pm = penalties.R2_PM?.total ?? 0;

    const basePenalties = getBaselineWavePenaltyAdjustments();
    const weatherAdjustments = getNetWeatherWaveAdjustments({ r1Am, r1Pm, r2Am, r2Pm });
    const combinedPenalties = {
      R1_AM: (basePenalties.R1_AM || 0) + (weatherAdjustments.adjustments.R1_AM || 0),
      R1_PM: (basePenalties.R1_PM || 0) + (weatherAdjustments.adjustments.R1_PM || 0),
      R2_AM: (basePenalties.R2_AM || 0) + (weatherAdjustments.adjustments.R2_AM || 0),
      R2_PM: (basePenalties.R2_PM || 0) + (weatherAdjustments.adjustments.R2_PM || 0)
    };

    process.env.MODEL_WEATHER_WAVE_ENABLED = '1';
    process.env.MODEL_WEATHER_WAVE_R1_EARLY_PENALTY = String(combinedPenalties.R1_AM);
    process.env.MODEL_WEATHER_WAVE_R1_LATE_PENALTY = String(combinedPenalties.R1_PM);
    process.env.MODEL_WEATHER_WAVE_R2_EARLY_PENALTY = String(combinedPenalties.R2_AM);
    process.env.MODEL_WEATHER_WAVE_R2_LATE_PENALTY = String(combinedPenalties.R2_PM);

    weatherWaveSummary = {
      ...payload,
      enabled: true,
      source: sourceLabel || payload.source || 'cache',
      cachePath: weatherPenaltyCachePath || payload.cachePath || null,
      basePenalties,
      weatherAdjustments,
      combinedPenalties
    };
    console.log(`ℹ️  Weather adjustments loaded from cache (weather-only: R1 AM=${r1Am}, R1 PM=${r1Pm}, R2 AM=${r2Am}, R2 PM=${r2Pm}; net: R1 AM=${weatherAdjustments.adjustments.R1_AM}, R1 PM=${weatherAdjustments.adjustments.R1_PM}, R2 AM=${weatherAdjustments.adjustments.R2_AM}, R2 PM=${weatherAdjustments.adjustments.R2_PM}; combined: R1 AM=${combinedPenalties.R1_AM}, R1 PM=${combinedPenalties.R1_PM}, R2 AM=${combinedPenalties.R2_AM}, R2 PM=${combinedPenalties.R2_PM}).`);
    return true;
  };

  if (WEATHER_ENABLED) {
    process.env.MODEL_WEATHER_WAVE_ENABLED = '0';
    process.env.MODEL_WEATHER_WAVE_R1_EARLY_PENALTY = '0';
    process.env.MODEL_WEATHER_WAVE_R1_LATE_PENALTY = '0';
    process.env.MODEL_WEATHER_WAVE_R2_EARLY_PENALTY = '0';
    process.env.MODEL_WEATHER_WAVE_R2_LATE_PENALTY = '0';

    if (IS_POST_TOURNAMENT_RUN) {
      const cached = loadWeatherPenaltyCache(weatherPenaltyCachePath);
      if (!applyCachedWeatherPenalties(cached, weatherPenaltyCachePath ? `cache:${path.basename(weatherPenaltyCachePath)}` : 'cache')) {
        console.log('ℹ️  Weather penalties skipped for post-tournament run (no cached penalties found).');
      }
    } else {
      try {
        const weatherResult = await computeWeatherWavePenalties({
          fieldUpdatesPayload: fieldUpdatesSnapshot?.payload,
          courseContextEntry: courseContextEntryFinal,
          cacheDir: DATAGOLF_CACHE_DIR,
          apiKey: WEATHER_API_KEY,
          eventId: CURRENT_EVENT_ID
        });
        if (weatherResult?.enabled) {
          weatherWaveSummary = weatherResult;
          const penalties = weatherResult.penalties || {};
          const r1Am = penalties.R1_AM?.total ?? 0;
          const r1Pm = penalties.R1_PM?.total ?? 0;
          const r2Am = penalties.R2_AM?.total ?? 0;
          const r2Pm = penalties.R2_PM?.total ?? 0;

          const basePenalties = getBaselineWavePenaltyAdjustments();
          const weatherAdjustments = getNetWeatherWaveAdjustments({ r1Am, r1Pm, r2Am, r2Pm });
          const combinedPenalties = {
            R1_AM: (basePenalties.R1_AM || 0) + (weatherAdjustments.adjustments.R1_AM || 0),
            R1_PM: (basePenalties.R1_PM || 0) + (weatherAdjustments.adjustments.R1_PM || 0),
            R2_AM: (basePenalties.R2_AM || 0) + (weatherAdjustments.adjustments.R2_AM || 0),
            R2_PM: (basePenalties.R2_PM || 0) + (weatherAdjustments.adjustments.R2_PM || 0)
          };

          process.env.MODEL_WEATHER_WAVE_ENABLED = '1';
          process.env.MODEL_WEATHER_WAVE_R1_EARLY_PENALTY = String(combinedPenalties.R1_AM);
          process.env.MODEL_WEATHER_WAVE_R1_LATE_PENALTY = String(combinedPenalties.R1_PM);
          process.env.MODEL_WEATHER_WAVE_R2_EARLY_PENALTY = String(combinedPenalties.R2_AM);
          process.env.MODEL_WEATHER_WAVE_R2_LATE_PENALTY = String(combinedPenalties.R2_PM);

          weatherWaveSummary = {
            ...weatherResult,
            basePenalties,
            weatherAdjustments,
            combinedPenalties
          };

          const cachePayload = {
            ...weatherResult,
            generatedAt: formatTimestamp(new Date()),
            eventId: CURRENT_EVENT_ID || null,
            season: effectiveSeason || null,
            tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback || null,
            cachePath: weatherPenaltyCachePath || null,
            basePenalties,
            weatherAdjustments,
            combinedPenalties
          };
          writeWeatherPenaltyCache(weatherPenaltyCachePath, cachePayload);

          console.log(`✓ Weather adjustments computed (weather-only: R1 AM=${r1Am}, R1 PM=${r1Pm}, R2 AM=${r2Am}, R2 PM=${r2Pm}; net: R1 AM=${weatherAdjustments.adjustments.R1_AM}, R1 PM=${weatherAdjustments.adjustments.R1_PM}, R2 AM=${weatherAdjustments.adjustments.R2_AM}, R2 PM=${weatherAdjustments.adjustments.R2_PM}; combined: R1 AM=${combinedPenalties.R1_AM}, R1 PM=${combinedPenalties.R1_PM}, R2 AM=${combinedPenalties.R2_AM}, R2 PM=${combinedPenalties.R2_PM}).`);
        } else {
          console.warn(`ℹ️  Weather penalties unavailable (${weatherResult?.reason || 'unknown'}).`);
        }
      } catch (error) {
        console.warn(`ℹ️  Weather penalty computation failed: ${error.message}`);
      }
    }
  }
  const fieldIdSetForDelta = new Set(
    fieldData
      .map(row => normalizeDgIdValue(row?.['dg_id'] ?? row?.dg_id ?? row?.dgId ?? row?.['DG ID']))
      .filter(Boolean)
  );
  const countApproachRowsInField = rows => (rows || []).reduce((count, row) => {
    const dgId = normalizeDgIdValue(row?.dg_id ?? row?.['dg_id'] ?? row?.dgId);
    if (!dgId) return count;
    return fieldIdSetForDelta.has(dgId) ? count + 1 : count;
  }, 0);

    const formatApproachSourceDetail = (sourceKey, rows) => {
      const rowCount = Array.isArray(rows) ? rows.length : 0;
      if (sourceKey === 'event_only') {
        const preName = approachEventOnlyMeta?.pre?.path ? path.basename(approachEventOnlyMeta.pre.path) : 'n/a';
        const postName = approachEventOnlyMeta?.post?.path ? path.basename(approachEventOnlyMeta.post.path) : 'n/a';
        const overlapPct = typeof approachEventOnlyMeta?.fieldOverlapPct === 'number'
          ? `${(approachEventOnlyMeta.fieldOverlapPct * 100).toFixed(1)}%`
          : 'n/a';
        return `event_only (rows=${rowCount}, pre=${preName}, post=${postName}, overlap=${overlapPct})`;
      }
      if (sourceKey === 'snapshot_ytd') {
        const ytdLabel = approachSnapshotYtd?.path ? path.basename(approachSnapshotYtd.path) : 'approach_ytd_latest.json';
        return `snapshot_ytd (rows=${rowCount}, file=${ytdLabel})`;
      }
      if (sourceKey === 'api_fallback') {
        const period = String(approachSkillSnapshot?.payload?.time_period || DATAGOLF_APPROACH_PERIOD || '').trim().toLowerCase() || 'unknown';
        return `approach_skill_api (rows=${rowCount}, period=${period})`;
      }
      if (sourceKey === 'csv_primary') {
        const csvName = APPROACH_PATH ? path.basename(APPROACH_PATH) : 'approach.csv';
        return `csv_primary (rows=${rowCount}, file=${csvName})`;
      }
      return `${sourceKey || 'none'} (rows=${rowCount})`;
    };

    const formatHistorySourceDetail = meta => {
      if (!meta) return 'unknown';
      const api = meta.api || {};
      const csv = meta.csv || {};
      return `refreshPolicy=${meta.refreshPolicy}, api(cache=${api.cache || 0}, stale=${api.cacheStale || 0}, api=${api.api || 0}, missingKey=${api.missingKey || 0}, missingYear=${api.missingYear || 0}, errors=${api.errors || 0}), csv(files=${csv.files || 0}, rows=${csv.rows || 0})`;
    };
  

  // Use robust, merged-source loader for historical rounds
  const historyAnchorSeason = IS_PRE_TOURNAMENT_RUN ? (effectiveSeason - 1) : effectiveSeason;
  const historyYears = buildRecentYears(historyAnchorSeason, 5);
  if (IS_PRE_TOURNAMENT_RUN && !historyYears.includes(effectiveSeason)) {
    historyYears.push(effectiveSeason);
  }
  const lastFiveYears = historyYears.sort((a, b) => a - b);
  // Dynamically determine tours from course context (event-specific or default)
  const context = loadCourseContext(COURSE_CONTEXT_PATH);
  const contextEntry = resolveCourseContextEntry(context, CURRENT_EVENT_ID);
  // Robustly determine tours: check event, then course, then default
  let tours = [];
  if (contextEntry && Array.isArray(contextEntry.tours) && contextEntry.tours.length > 0) {
    tours = contextEntry.tours.map(t => t.toLowerCase());
  } else if (contextEntry && contextEntry.courseNum && context.byCourseNum && context.byCourseNum[contextEntry.courseNum] && Array.isArray(context.byCourseNum[contextEntry.courseNum].tours) && context.byCourseNum[contextEntry.courseNum].tours.length > 0) {
    tours = context.byCourseNum[contextEntry.courseNum].tours.map(t => t.toLowerCase());
  } else if (Array.isArray(context.defaultTours) && context.defaultTours.length > 0) {
    tours = context.defaultTours.map(t => t.toLowerCase());
  } else {
    tours = ['pga'];
  }
  const historyPreferCache = true;
  let skipHistoricalApiRefresh = hasHistoricalResultsInCache({
    cacheDir: DATAGOLF_CACHE_DIR,
    tour: DATAGOLF_HISTORICAL_TOUR,
    eventId: CURRENT_EVENT_ID,
    season: effectiveSeason
  });
  if (IS_PRE_TOURNAMENT_RUN) {
    const manifestEntriesForHistory = loadSeasonManifestEntries(DATA_ROOT_DIR, effectiveSeason);
    const currentManifestEntry = resolveManifestEntryForEvent(manifestEntriesForHistory, {
      eventId: CURRENT_EVENT_ID,
      tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback
    });
    const previousManifestEntry = currentManifestEntry
      ? resolvePreviousManifestEntry(manifestEntriesForHistory, currentManifestEntry)
      : null;
    const previousEventId = previousManifestEntry?.eventId || null;
    if (!previousManifestEntry?.date || !previousEventId) {
      console.error('❌ Pre-tournament requires prior event in manifest to validate cache-based historical rounds.');
      console.error('   Fix: add the previous event to manifest.json (with date + eventId).');
      process.exit(1);
    }
    const hasPriorEventCache = hasHistoricalResultsInCache({
      cacheDir: DATAGOLF_CACHE_DIR,
      tour: DATAGOLF_HISTORICAL_TOUR,
      eventId: previousEventId,
      season: effectiveSeason
    });
    if (hasPriorEventCache) {
      skipHistoricalApiRefresh = true;
      console.log(`ℹ️  Pre-tournament: confirmed cached historical rounds for prior event ${previousEventId} (${previousManifestEntry.date}).`);
    } else {
      let apiHasPriorEvent = false;
      if (!DATAGOLF_API_KEY) {
        console.error(`❌ Pre-tournament requires prior event ${previousEventId} in cache or API, but DATAGOLF_API_KEY is not set.`);
        process.exit(1);
      }
      try {
        const snapshot = await getDataGolfHistoricalRounds({
          apiKey: DATAGOLF_API_KEY,
          cacheDir: DATAGOLF_CACHE_DIR,
          ttlMs: 0,
          allowStale: true,
          preferCache: false,
          tour: DATAGOLF_HISTORICAL_TOUR,
          eventId: 'all',
          year: effectiveSeason,
          fileFormat: 'json'
        });
        const apiRows = extractHistoricalRowsFromSnapshotPayload(snapshot?.payload)
          .map(normalizeHistoricalRoundRow)
          .filter(Boolean);
        apiHasPriorEvent = apiRows.some(row => String(row?.event_id || '').trim() === String(previousEventId));
      } catch (error) {
        console.error(`❌ Pre-tournament historical rounds API fetch failed: ${error.message}`);
        process.exit(1);
      }
      if (!apiHasPriorEvent) {
        console.error(`❌ Pre-tournament requires prior event ${previousEventId} (${previousManifestEntry.date}) in API/cache, but it was not found.`);
        process.exit(1);
      }
      console.log(`ℹ️  Pre-tournament: prior event ${previousEventId} found via API; cache updated.`);
      skipHistoricalApiRefresh = true;
    }
  } else if (skipHistoricalApiRefresh) {
    console.log('ℹ️  Historical rounds refresh skipped (results already present in cache).');
  }
  const historyTtlMs = IS_POST_TOURNAMENT_RUN
    ? 0
    : DATAGOLF_HISTORICAL_TTL_HOURS * 60 * 60 * 1000;
  const historyCollection = await collectRecords({
    years: lastFiveYears,
    tours,
    dataDir: DATA_DIR || DATA_ROOT_DIR,
    datagolfApiKey: DATAGOLF_API_KEY,
    datagolfCacheDir: DATAGOLF_CACHE_DIR,
    datagolfHistoricalTtlMs: historyTtlMs,
    getDataGolfHistoricalRounds,
    preferApi: !skipHistoricalApiRefresh,
    preferCache: historyPreferCache,
    returnMeta: true
  });
  let historyData = extractHistoricalRowsFromSnapshotPayload(historyCollection?.rows || historyCollection);
  const historyMeta = historyCollection?.meta || null;
  if (!historyData || historyData.length === 0) {
    console.error('❌ Unable to load historical rounds (no data found in JSON, CSV, or API).');
    process.exit(1);
  }
  console.log(`✓ Loaded history (robust merged-source): ${historyData.length} rounds`);
  if (historyMeta) {
    console.log(`ℹ️  History source: refreshPolicy=${historyMeta.refreshPolicy}, api(cache=${historyMeta.api.cache}, stale=${historyMeta.api.cacheStale}, api=${historyMeta.api.api}, missingKey=${historyMeta.api.missingKey}, missingYear=${historyMeta.api.missingYear}, errors=${historyMeta.api.errors}), csv(files=${historyMeta.csv.files}, rows=${historyMeta.csv.rows})`);
  }

  const eventIdStr = String(CURRENT_EVENT_ID);
  const seasonStr = String(effectiveSeason);
  let historyEventCount = historyData.filter(row => String(row['event_id'] || '').trim() === eventIdStr).length;
  let historyEventSeasonCount = historyData.filter(row => {
    const eventMatch = String(row['event_id'] || '').trim() === eventIdStr;
    if (!eventMatch) return false;
    const seasonValue = String(row['season'] || row['year'] || '').trim();
    return seasonValue === seasonStr;
  }).length;

  if (historyEventSeasonCount === 0 && !skipHistoricalApiRefresh) {
    try {
      const fetchEventYearRows = async preferCache => {
        const snapshot = await getDataGolfHistoricalRounds({
          apiKey: DATAGOLF_API_KEY,
          cacheDir: DATAGOLF_CACHE_DIR,
          ttlMs: preferCache ? (DATAGOLF_HISTORICAL_TTL_HOURS * 60 * 60 * 1000) : 0,
          allowStale: true,
          preferCache,
          tour: DATAGOLF_HISTORICAL_TOUR,
          eventId: CURRENT_EVENT_ID,
          year: effectiveSeason,
          fileFormat: 'json'
        });

        return extractHistoricalRowsFromSnapshotPayload(snapshot?.payload)
          .map(normalizeHistoricalRoundRow)
          .filter(Boolean)
          .filter(row => String(row['event_id'] || '').trim() === eventIdStr);
      };

      let eventYearRows = await fetchEventYearRows(true);
      if (eventYearRows.length === 0) {
        eventYearRows = await fetchEventYearRows(false);
      }

      if (eventYearRows.length > 0) {
        const existingKeys = new Set(
          historyData.map(row => [
            String(row['dg_id'] || '').trim(),
            String(row['event_id'] || '').trim(),
            String(row['year'] || row['season'] || '').trim(),
            String(row['round_num'] || row['round'] || '').trim()
          ].join('|'))
        );

        eventYearRows.forEach(row => {
          const key = [
            String(row['dg_id'] || '').trim(),
            String(row['event_id'] || '').trim(),
            String(row['year'] || row['season'] || '').trim(),
            String(row['round_num'] || row['round'] || '').trim()
          ].join('|');
          if (!existingKeys.has(key)) {
            historyData.push(row);
            existingKeys.add(key);
          }
        });

        historyEventCount = historyData.filter(row => String(row['event_id'] || '').trim() === eventIdStr).length;
        historyEventSeasonCount = historyData.filter(row => {
          const eventMatch = String(row['event_id'] || '').trim() === eventIdStr;
          if (!eventMatch) return false;
          const seasonValue = String(row['season'] || row['year'] || '').trim();
          return seasonValue === seasonStr;
        }).length;
        console.log(`✓ Loaded ${eventYearRows.length} rounds for event ${eventIdStr} (${seasonStr}) via cache/API fallback.`);
      } else {
        console.warn(`ℹ️  Historical rounds missing for event ${eventIdStr} (${seasonStr}) after cache/API fallback.`);
      }
    } catch (error) {
      console.warn(`ℹ️  Historical rounds lookup failed: ${error.message}`);
    }
  } else if (historyEventSeasonCount === 0 && skipHistoricalApiRefresh) {
    console.warn(`ℹ️  Skipping event-year historical rounds API fetch (results cached for event ${eventIdStr}, season ${seasonStr}).`);
  }

  if (!IS_PRE_TOURNAMENT_RUN && historyEventSeasonCount === 0) {
    console.error('\n❌ Post/results/validation mode requires current-event historical rounds, but none were found.');
    console.error(`   Event: ${eventIdStr} | Season: ${seasonStr}`);
    console.error('   Fix: ensure the historical rounds cache/API includes current-event results before running post/results/validation.');
    process.exit(1);
  }

  console.log(`ℹ️  History rows for event ${eventIdStr}: ${historyEventCount} (season ${seasonStr}: ${historyEventSeasonCount})`);
  
  const approachCsvRows = (APPROACH_PATH && fs.existsSync(APPROACH_PATH))
    ? loadCsv(APPROACH_PATH, { skipFirstColumn: true })
    : [];
  const approachSkillRows = approachCsvRows.length === 0
    ? extractApproachRowsFromJson(approachSkillSnapshot?.payload)
    : [];
  const approachData = approachCsvRows.length > 0 ? approachCsvRows : approachSkillRows;
  const approachSourceLabel = approachCsvRows.length > 0
    ? `CSV ${path.basename(APPROACH_PATH || 'approach.csv')}`
    : (() => {
        const period = String(approachSkillSnapshot?.payload?.time_period || DATAGOLF_APPROACH_PERIOD || '').trim().toLowerCase();
        const periodLabel = period ? `${period}` : 'unknown';
        return `DataGolf approach skill (${approachSkillSnapshot?.source || 'unknown'}, ${periodLabel})`;
      })();
  console.log(`✓ Loaded approach: ${approachData.length} rows (source: ${approachSourceLabel})`);

  const hasApproachCsv = approachCsvRows.length > 0;
  const approachSnapshotRows = {
    l24: extractApproachRowsFromJson(approachSnapshotL24?.payload),
    l12: extractApproachRowsFromJson(approachSnapshotL12?.payload),
    ytd: extractApproachRowsFromJson(approachSnapshotYtd?.payload)
  };
  const approachSkillPeriod = String(approachSkillSnapshot?.payload?.time_period || '').trim().toLowerCase();

  const parseApproachBlendWeights = raw => {
    if (!raw) return null;
    const parts = String(raw)
      .split(/[\s,/]+/)
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => parseFloat(value));
    if (parts.length < 2 || parts.some(value => Number.isNaN(value))) return null;
    const [ytd, l12, l24] = parts;
    return {
      ytd: ytd ?? 0,
      l12: l12 ?? 0,
      l24: l24 ?? 0
    };
  };

  const blendApproachSnapshotRows = ({ ytdRows, l12Rows, l24Rows, weights }) => {
    const sourceList = [
      { key: 'ytd', rows: ytdRows || [], weight: weights.ytd || 0 },
      { key: 'l12', rows: l12Rows || [], weight: weights.l12 || 0 },
      { key: 'l24', rows: l24Rows || [], weight: weights.l24 || 0 }
    ];
    const idKeys = new Set(['dg_id', 'dgId', 'dgID', 'player_name', 'playerName', 'name', 'rank']);
    const maps = sourceList.map(source => {
      const map = new Map();
      (source.rows || []).forEach(row => {
        const dgId = String(row?.dg_id ?? row?.dgId ?? row?.dgID ?? '').trim();
        if (!dgId) return;
        map.set(dgId, row);
      });
      return map;
    });
    const allIds = new Set();
    maps.forEach(map => map.forEach((_, key) => allIds.add(key)));
    const output = [];

    allIds.forEach(dgId => {
      const rowsForId = sourceList.map((source, idx) => ({
        key: source.key,
        weight: source.weight,
        row: maps[idx].get(dgId) || null
      })).filter(entry => entry.row);
      if (!rowsForId.length) return;
      const availableWeight = rowsForId.reduce((sum, entry) => sum + entry.weight, 0);
      if (availableWeight <= 0) return;

      const baseRow = rowsForId.find(entry => entry.key === 'ytd')?.row
        || rowsForId[0].row;
      const merged = { ...baseRow };
      const keySet = new Set();
      rowsForId.forEach(entry => {
        Object.keys(entry.row || {}).forEach(key => keySet.add(key));
      });

      keySet.forEach(key => {
        if (idKeys.has(key)) return;
        const values = rowsForId
          .map(entry => ({
            weight: entry.weight,
            value: entry.row?.[key]
          }))
          .filter(entry => typeof entry.value === 'number' && Number.isFinite(entry.value));
        if (values.length === 0) return;
        const weightSum = values.reduce((sum, entry) => sum + entry.weight, 0);
        if (weightSum <= 0) return;
        const blended = values.reduce((sum, entry) => sum + entry.value * (entry.weight / weightSum), 0);
        merged[key] = blended;
      });

      output.push(merged);
    });

    return output;
  };

  if (approachSnapshotRows.l12.length === 0) {
    const latestL12 = resolveLatestApproachSnapshotArchive('l12');
    if (latestL12?.payload) {
      approachSnapshotRows.l12 = extractApproachRowsFromJson(latestL12.payload);
      if (approachSnapshotRows.l12.length > 0) {
        approachSnapshotL12 = latestL12;
        console.log(`ℹ️  Loaded L12 approach snapshot from archive for validation (${path.basename(latestL12.path)}).`);
      }
    }
  }

  if (approachSkillRows.length > 0) {
    if (approachSkillPeriod === 'l12' && approachSnapshotRows.l12.length === 0) {
      approachSnapshotRows.l12 = approachSkillRows;
    } else if (approachSkillPeriod === 'l24' && approachSnapshotRows.l24.length === 0) {
      approachSnapshotRows.l24 = approachSkillRows;
    } else if (approachSkillPeriod === 'ytd' && approachSnapshotRows.ytd.length === 0) {
      approachSnapshotRows.ytd = approachSkillRows;
    }
  }

  const approachBlendWeightsRaw = parseApproachBlendWeights(APPROACH_BLEND_WEIGHTS_RAW);
  const approachBlendWeights = approachBlendWeightsRaw
    ? (() => {
        const total = (approachBlendWeightsRaw.ytd || 0)
          + (approachBlendWeightsRaw.l12 || 0)
          + (approachBlendWeightsRaw.l24 || 0);
        if (!Number.isFinite(total) || total <= 0) return null;
        return {
          ytd: (approachBlendWeightsRaw.ytd || 0) / total,
          l12: (approachBlendWeightsRaw.l12 || 0) / total,
          l24: (approachBlendWeightsRaw.l24 || 0) / total
        };
      })()
    : null;

  let approachDataCurrent = hasApproachCsv
    ? approachData
    : (approachSnapshotRows.ytd.length > 0 ? approachSnapshotRows.ytd : approachData);
  let approachDataCurrentSource = hasApproachCsv
    ? 'csv_primary'
    : (approachSnapshotRows.ytd.length > 0 ? 'snapshot_ytd' : 'csv_fallback');
  if (!hasApproachCsv && approachBlendWeights) {
    const blendedRows = blendApproachSnapshotRows({
      ytdRows: approachSnapshotRows.ytd,
      l12Rows: approachSnapshotRows.l12,
      l24Rows: approachSnapshotRows.l24,
      weights: approachBlendWeights
    });
    if (blendedRows.length > 0) {
      approachDataCurrent = blendedRows;
      approachDataCurrentSource = 'snapshot_blend';
    } else {
      console.warn('ℹ️  Approach blend requested but no blended rows produced; falling back to snapshot/CSV policy.');
    }
  }
  if (!hasApproachCsv && approachSnapshotRows.ytd.length === 0 && approachSkillRows.length > 0) {
    approachDataCurrentSource = 'api_fallback';
  }

  let approachEventOnlyAvailable = false;

  if (hasApproachCsv) {
    const fieldCount = countApproachRowsInField(approachData);
    console.log(`✓ Using approach CSV as primary for current season (${approachData.length} rows, field overlap ${fieldCount}/${fieldIdSetForDelta.size || 'n/a'})`);
  } else if (approachSnapshotRows.ytd.length > 0) {
    const fieldCount = countApproachRowsInField(approachSnapshotRows.ytd);
    const ytdLabel = approachSnapshotYtd?.path ? path.basename(approachSnapshotYtd.path) : 'approach_ytd_latest.json';
    console.log(`✓ Using YTD approach snapshot for current season (${approachSnapshotRows.ytd.length} rows, file: ${ytdLabel}, field overlap ${fieldCount}/${fieldIdSetForDelta.size || 'n/a'})`);
  } else if (approachSkillRows.length > 0) {
    const fieldCount = countApproachRowsInField(approachSkillRows);
    const skillPeriod = approachSkillPeriod || String(DATAGOLF_APPROACH_PERIOD || '').trim().toLowerCase() || 'unknown';
    console.log(`✓ Using approach skill snapshot as fallback for current season (${approachSkillRows.length} rows, period: ${skillPeriod}, field overlap ${fieldCount}/${fieldIdSetForDelta.size || 'n/a'})`);
  } else {
    console.log('ℹ️  Approach data unavailable (no CSV or snapshots).');
  }

  console.log('ℹ️  Approach usage summary:');
  console.log(`   - Current-season rankings (baseline/optimization): ${approachDataCurrentSource}`);
  console.log(`   - Step 1b (event-only correlations): ${approachEventOnlyAvailable ? 'event_only' : 'latest_snapshot_fallback'}`);
  console.log(`   - Step 1c (event+similar+putting correlations): latest snapshot (${approachDataCurrentSource})`);
  if (!hasApproachCsv && approachBlendWeights) {
    console.log(`   - Approach blend weights: ytd=${(approachBlendWeights.ytd * 100).toFixed(0)}%, l12=${(approachBlendWeights.l12 * 100).toFixed(0)}%, l24=${(approachBlendWeights.l24 * 100).toFixed(0)}%`);
  }

  const fieldIntegritySummary = evaluateFieldIntegrity({
    fieldData,
    fieldIdSet: fieldIdSetForDelta,
    approachRows: approachDataCurrent,
    minPlayers: Math.max(20, Math.floor(getEnvNumberValue('MODEL_FIELD_MIN_PLAYERS', 70))),
    minApproachOverlapPct: Math.max(0, Math.min(1, getEnvNumberValue('MODEL_FIELD_MIN_APPROACH_OVERLAP', 0.4))),
    strict: ['1', 'true', 'yes'].includes(String(process.env.MODEL_FIELD_GATE_STRICT || '').trim().toLowerCase())
  });

  const resolveApproachUsageForYear = year => {
    const meta = {
      year: year,
      mode: VALIDATION_APPROACH_MODE,
      period: 'none',
      source: 'none',
      leakageFlag: 'none'
    };

    if (VALIDATION_APPROACH_MODE === 'none') {
      return { rows: [], meta };
    }

    const yearValue = parseInt(String(year || '').trim(), 10);
    if (Number.isNaN(yearValue)) {
      return { rows: [], meta };
    }

    const diff = effectiveSeason - yearValue;
    if (diff === 0) {
      if (approachDataCurrent.length > 0) {
        meta.period = 'ytd';
        meta.source = approachDataCurrentSource;
        const isYtdSnapshot = approachDataCurrentSource === 'snapshot_ytd'
          || (approachDataCurrentSource === 'api_fallback' && approachSkillPeriod === 'ytd');
        meta.leakageFlag = isYtdSnapshot ? 'as_of_date' : 'approximation';
        return { rows: approachDataCurrent, meta };
      }
      return { rows: [], meta };
    }

    if (diff === 1) {
      if (approachSnapshotRows.l12.length > 0) {
        meta.period = 'l12';
        meta.source = 'snapshot_l12';
        meta.leakageFlag = 'approximation';
        return { rows: approachSnapshotRows.l12, meta };
      }
      return { rows: [], meta };
    }

    if (diff >= 2 && diff <= 4) {
      if (approachSnapshotRows.l24.length > 0) {
        meta.period = 'l24';
        meta.source = 'snapshot_l24';
        meta.leakageFlag = 'approximation';
        return { rows: approachSnapshotRows.l24, meta };
      }
      return { rows: [], meta };
    }

    return { rows: [], meta };
  };

  const fallbackTemplateKey = normalizeTemplateKey(TOURNAMENT_NAME) || `EVENT_${CURRENT_EVENT_ID}`;
  const fieldCourseName = fieldData.find(row => row && (row.course_name || row.course))?.course_name
    || fieldData.find(row => row && (row.course_name || row.course))?.course
    || null;
  const historyCourseName = historyData.find(row => {
    const eventId = String(row['event_id'] || '').trim();
    if (eventId !== String(CURRENT_EVENT_ID)) return false;
    const season = parseInt(String(row['season'] || row['year'] || '').trim());
    if (Number.isNaN(season)) return false;
    return String(season) === String(effectiveSeason) && row['course_name'];
  })?.course_name || null;

  courseTemplateKey = sharedConfig.courseNameKey
    || normalizeTemplateKey(fieldCourseName)
    || normalizeTemplateKey(historyCourseName)
    || fallbackTemplateKey;

  const fieldNameLookup = fieldData.reduce((acc, row) => {
    const dgId = String(row['dg_id'] || '').trim();
    if (!dgId) return acc;
    const playerName = String(row['player_name'] || '').trim();
    if (playerName) acc[dgId] = playerName;
    return acc;
  }, {});
  let resultsCurrent = deriveResultsFromHistory(historyData, CURRENT_EVENT_ID, effectiveSeason, fieldNameLookup);
  console.log(`ℹ️  Derived ${resultsCurrent.length} results from historical data.`);

  if (resultsCurrent.length === 0) {
    const postEventResultsDir = postEventOutputDir || (tournamentDir ? path.resolve(tournamentDir, 'post_event') : null);
    const fallbackResultsDir = postEventResultsDir && path.basename(postEventResultsDir) === 'seed_runs'
      ? path.dirname(postEventResultsDir)
      : null;
    const resultsSlug = normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback);
    const resultsJsonPath =
      findPostEventResultsFile(postEventResultsDir, resultsSlug, 'json', ['_zscores', '_formatting'])
      || findPostEventResultsFile(fallbackResultsDir, resultsSlug, 'json', ['_zscores', '_formatting']);
    if (resultsJsonPath) {
      const jsonLoad = loadResultsFromJsonFile(resultsJsonPath, {
        eventId: CURRENT_EVENT_ID,
        season: effectiveSeason
      });
      if (jsonLoad.results.length > 0) {
        resultsCurrent = jsonLoad.results;
        console.log(`✓ Loaded ${resultsCurrent.length} results from JSON: ${path.basename(resultsJsonPath)}`);
      }
    }

    if (resultsCurrent.length === 0) {
      const resultsCsvPath =
        findPostEventResultsFile(postEventResultsDir, resultsSlug, 'csv', ['_zscores', '_formatting'])
        || findPostEventResultsFile(fallbackResultsDir, resultsSlug, 'csv', ['_zscores', '_formatting']);
      if (resultsCsvPath && fs.existsSync(resultsCsvPath)) {
        const resultsRows = loadCsv(resultsCsvPath, { skipFirstColumn: true });
        const resultsFromCsv = buildResultsFromResultRows(resultsRows);
        if (resultsFromCsv.length > 0) {
          resultsCurrent = resultsFromCsv;
          console.log(`✓ Loaded ${resultsCurrent.length} results from CSV: ${path.basename(resultsCsvPath)}`);
        }
      }
    }
  }

  if (FORCE_RUN_MODE === 'pre') {
    resultsCurrent = [];
    console.log('ℹ️  Pre-tournament override active: ignoring results for mode selection.');
  }

  const HAS_CURRENT_RESULTS = resultsCurrent.length > 0;
  if (FORCE_RUN_MODE === 'post' && !HAS_CURRENT_RESULTS) {
    console.error('\n❌ Forced post-tournament mode but no results were found for the current season/event.');
    process.exit(1);
  }
  if (!HAS_CURRENT_RESULTS) {
    console.warn('\n⚠️  No results found for the current season/event.');
    console.warn('   Falling back to historical + similar-course outcomes for supervised metric training.');
  } else if (!isSeedRunDir) {
    OUTPUT_DIR = postEventOutputDir;
    ensureDirectory(OUTPUT_DIR);
  }

  if (RUN_RESULTS_ONLY) {
    const outputBaseName = buildOutputBaseName({
      tournamentSlug: canonicalTournamentSlug || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
      tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback,
      eventId: CURRENT_EVENT_ID
    });
    const rankingJsonCandidates = [
      preEventOutputDir ? path.resolve(preEventOutputDir, `${outputBaseName}_pre_event_rankings.json`) : null,
      postEventOutputDir ? path.resolve(postEventOutputDir, `${outputBaseName}_pre_event_rankings.json`) : null,
      preEventOutputDir ? path.resolve(preEventOutputDir, `${outputBaseName}_pre_event_rankings.json`.toLowerCase()) : null,
      postEventOutputDir ? path.resolve(postEventOutputDir, `${outputBaseName}_pre_event_rankings.json`.toLowerCase()) : null
    ];
    const rankingCsvCandidates = [
      preEventOutputDir ? path.resolve(preEventOutputDir, `${outputBaseName}_pre_event_rankings.csv`) : null,
      postEventOutputDir ? path.resolve(postEventOutputDir, `${outputBaseName}_pre_event_rankings.csv`) : null,
      preEventOutputDir ? path.resolve(preEventOutputDir, `${outputBaseName}_pre_event_rankings.csv`.toLowerCase()) : null,
      postEventOutputDir ? path.resolve(postEventOutputDir, `${outputBaseName}_pre_event_rankings.csv`.toLowerCase()) : null
    ];
    const rankingJsonPath = findFirstExisting(rankingJsonCandidates);
    if (!rankingJsonPath) {
      console.error('❌ Unable to locate pre-event rankings JSON for results export.');
      process.exit(1);
    }
    const rankingCsvPath = findFirstExisting(rankingCsvCandidates);

    const rankingPayload = readJsonFile(rankingJsonPath);
    const rankingPlayers = Array.isArray(rankingPayload?.players) ? rankingPayload.players : [];
    const rankingsById = new Map(
      rankingPlayers
        .filter(player => player && player.dgId)
        .map(player => [String(player.dgId).trim(), player])
    );

    if (rankingCsvPath) {
      const resultMetricSpecs = resultsCsvUtils.buildResultsMetricSpecs();
      const csvModelById = resultsCsvUtils.parseRankingCsvModelValues(rankingCsvPath, resultMetricSpecs);
      csvModelById.forEach((entry, dgId) => {
        const existing = rankingsById.get(dgId) || {};
        rankingsById.set(dgId, {
          ...existing,
          dgId,
          name: entry.name || existing.name || null,
          rank: Number.isFinite(entry.rank) ? entry.rank : (existing.rank ?? null),
          metrics: Array.isArray(entry.metrics) && entry.metrics.length > 0
            ? entry.metrics
            : (Array.isArray(existing.metrics) ? existing.metrics : null)
        });
      });
    }

    const resultsById = new Map(
      resultsCurrent
        .filter(entry => entry && entry.dgId)
        .map(entry => [String(entry.dgId).trim(), entry.finishPosition])
    );

    const actualMetricsById = resultsCsvUtils.buildActualMetricsFromHistory(historyData, CURRENT_EVENT_ID, effectiveSeason);
    const actualTrendsById = resultsCsvUtils.buildActualTrendsFromHistory(historyData, CURRENT_EVENT_ID, effectiveSeason);

    let approachDeltaPathForResults = null;
    let approachDeltaPathFallback = null;
    let shouldRecomputeResultsDelta = false;
    if (HAS_CURRENT_RESULTS) {
      const manifestEntriesForResults = loadSeasonManifestEntries(DATA_ROOT_DIR, effectiveSeason);
      const currentManifestEntry = resolveManifestEntryForEvent(manifestEntriesForResults, {
        eventId: CURRENT_EVENT_ID,
        tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
        tournamentName: TOURNAMENT_NAME || tournamentNameFallback
      });
      const nextManifestEntry = currentManifestEntry
        ? resolveNextManifestEntry(manifestEntriesForResults, currentManifestEntry)
        : null;
      const eventDateInfoForResults = resolveEventStartDateFromManifest({
        dataRootDir: DATA_ROOT_DIR,
        season: effectiveSeason,
        eventId: CURRENT_EVENT_ID,
        tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
        tournamentName: TOURNAMENT_NAME || tournamentNameFallback
      });
      const buildYtdCandidates = () => buildApproachSnapshotCandidates({
        dataRootDir: DATA_ROOT_DIR,
        season: effectiveSeason,
        manifestEntries: manifestEntriesForResults
      }).filter(entry => entry?.source === 'snapshot_archive' || entry?.source === 'snapshot_latest');
      let ytdCandidates = buildYtdCandidates();
      let hasPostEventYtdSnapshot = false;
      if (eventDateInfoForResults?.time) {
        hasPostEventYtdSnapshot = ytdCandidates.some(entry => entry.time > eventDateInfoForResults.time);
      } else {
        console.warn('ℹ️  Results-only delta refresh: event date not found in manifest; snapshot freshness check skipped.');
      }

      if (eventDateInfoForResults?.time && !hasPostEventYtdSnapshot) {
        if (!DATAGOLF_API_KEY) {
          console.warn('ℹ️  Results-only delta refresh skipped (DATAGOLF_API_KEY not set).');
        } else {
          try {
            const refreshed = await refreshYtdApproachSnapshot({
              apiKey: DATAGOLF_API_KEY,
              cacheDir: null,
              ttlMs: DATAGOLF_APPROACH_TTL_HOURS * 60 * 60 * 1000
            });
            if (refreshed?.payload) {
              approachSnapshotYtd = refreshed;
              ytdCandidates = buildYtdCandidates();
              hasPostEventYtdSnapshot = ytdCandidates.some(entry => entry.time > eventDateInfoForResults.time);
              shouldRecomputeResultsDelta = true;
              console.log('✓ Results-only: refreshed YTD snapshot for approach delta generation.');
            }
          } catch (error) {
            console.warn(`ℹ️  Results-only YTD snapshot refresh failed: ${error.message}`);
          }
        }
      }

      if (currentManifestEntry?.tournamentName || currentManifestEntry?.tournamentSlug) {
        const currentDeltaPath = findApproachDeltaFile(
          [APPROACH_DELTA_DIR, OUTPUT_DIR, DATA_DIR, DEFAULT_DATA_DIR],
          currentManifestEntry.tournamentName,
          currentManifestEntry.tournamentSlug
        );
        if (currentDeltaPath) {
          approachDeltaPathFallback = currentDeltaPath;
        }
      }
      if (nextManifestEntry?.tournamentName || nextManifestEntry?.tournamentSlug) {
        const nextDeltaPath = findApproachDeltaFile(
          [APPROACH_DELTA_DIR, OUTPUT_DIR, DATA_DIR, DEFAULT_DATA_DIR],
          nextManifestEntry.tournamentName,
          nextManifestEntry.tournamentSlug
        );
        if (nextDeltaPath) {
          approachDeltaPathForResults = nextDeltaPath;
          console.log(`ℹ️  Using next-week approach delta for results: ${path.basename(nextDeltaPath)}.`);
        }
      }

      if (!approachDeltaPathFallback || shouldRecomputeResultsDelta) {
        const snapshotOnlyDelta = isSnapshotOnlyDeltaEvent({
          eventId: CURRENT_EVENT_ID,
          tournamentSlug: canonicalTournamentSlug,
          tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback
        });
        const deltaCandidates = buildApproachSnapshotCandidates({
          dataRootDir: DATA_ROOT_DIR,
          season: effectiveSeason,
          manifestEntries: manifestEntriesForResults
        });
        let pre = null;
        let post = null;
        if (eventDateInfoForResults?.time) {
          ({ pre, post } = selectApproachSnapshotsForEvent({
            eventDateMs: eventDateInfoForResults.time,
            candidates: deltaCandidates
          }));
        }
        const manifestFallback = buildManifestApproachCsvFallback({
          dataRootDir: DATA_ROOT_DIR,
          season: effectiveSeason,
          eventId: CURRENT_EVENT_ID,
          tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
          tournamentName: TOURNAMENT_NAME || tournamentNameFallback
        });
        if (!snapshotOnlyDelta) {
          if (!pre && manifestFallback?.eventPre) pre = manifestFallback.eventPre;
          if (!post && manifestFallback?.eventPost) post = manifestFallback.eventPost;
        } else if ((!pre || !post) && (manifestFallback?.eventPre || manifestFallback?.eventPost)) {
          console.log('ℹ️  Results-only delta: snapshot-only policy active; skipping approach CSV fallback.');
        }

        let previousRows = pre?.path ? loadApproachCsv(pre.path) : [];
        let currentRows = post?.path ? loadApproachCsv(post.path) : [];
        let previousSource = pre?.path || null;
        let currentSource = post?.path || null;

        if (!snapshotOnlyDelta && (previousRows.length === 0 || currentRows.length === 0)) {
          const currentApproachPath = APPROACH_PATH && fs.existsSync(APPROACH_PATH)
            ? APPROACH_PATH
            : null;
          const previousApproachPath = resolvePreviousApproachCsv(effectiveSeason, currentApproachPath);
          const csvCurrentRows = currentApproachPath ? loadApproachCsv(currentApproachPath) : [];
          const csvPreviousRows = previousApproachPath ? loadApproachCsv(previousApproachPath) : [];
          if (csvCurrentRows.length > 0 && csvPreviousRows.length > 0) {
            currentRows = csvCurrentRows;
            previousRows = csvPreviousRows;
            currentSource = currentApproachPath;
            previousSource = previousApproachPath;
            console.log('✓ Results-only delta auto-generation using approach CSVs (current + previous tournaments).');
          }
        }

        if (!OVERRIDE_APPROACH_DELTA_IGNORE_LAG) {
          const currentStamp = post?.time || resolveApproachSnapshotTimestamp(currentSource);
          const previousStamp = pre?.time || resolveApproachSnapshotTimestamp(previousSource);
          const csvSources = [pre?.source, post?.source]
            .filter(Boolean)
            .some(source => source.includes('approach_csv'));
          if (!snapshotOnlyDelta && !csvSources && currentStamp && previousStamp) {
            const diffDays = Math.abs(currentStamp - previousStamp) / (1000 * 60 * 60 * 24);
            if (diffDays < APPROACH_DELTA_MIN_DAYS) {
              console.warn(`ℹ️  Results-only delta auto-generation skipped (snapshots only ${diffDays.toFixed(2)} days apart; min=${APPROACH_DELTA_MIN_DAYS}).`);
              previousRows = [];
              currentRows = [];
            }
          }
        }

        if (previousRows.length === 0 || currentRows.length === 0) {
          console.warn('ℹ️  Results-only delta auto-generation skipped (missing current/previous snapshots or approach CSVs).');
        } else {
          const deltaRows = computeApproachDeltas({ previousRows, currentRows });
          const fieldIdSet = new Set(
            fieldData
              .map(row => String(row?.dg_id || '').trim())
              .filter(Boolean)
          );
          const taggedRows = deltaRows.map(row => ({
            ...row,
            tournament_field: fieldIdSet.size > 0 ? fieldIdSet.has(String(row?.dg_id || '').trim()) : null
          }));
          if (taggedRows.length === 0) {
            console.warn('ℹ️  Results-only delta auto-generation skipped (no overlapping players).');
          } else {
            const deltaSlug = canonicalTournamentSlug
              || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback)
              || `event-${CURRENT_EVENT_ID || 'unknown'}`;
            const dateStamp = formatDateKey(new Date()).replace(/-/g, '_');
            const outputName = `approach_deltas_${deltaSlug}_${dateStamp}.json`;
            const outputPath = path.resolve(APPROACH_DELTA_DIR, outputName);
            const meta = {
              generatedAt: formatTimestamp(new Date()),
              previousPath: previousSource,
              currentPath: currentSource,
              fieldCount: fieldIdSet.size,
              beforeCount: deltaRows.length,
              afterCount: taggedRows.length,
              note: 'Auto-generated in results-only mode from snapshots or approach CSVs.'
            };
            writeJsonFile(outputPath, { meta, rows: taggedRows });
            approachDeltaPathFallback = outputPath;
            console.log(`✓ Results-only approach delta JSON generated: ${outputPath}`);
          }
        }
      }
    }

    const approachDeltaPrimary = loadApproachDeltaRows(approachDeltaPathForResults);
    const approachDeltaFallback = loadApproachDeltaRows(approachDeltaPathFallback);
    const approachDeltaPrimaryRows = Array.isArray(approachDeltaPrimary.rows)
      ? approachDeltaPrimary.rows.filter(row => row)
      : [];
    const approachDeltaFallbackRows = Array.isArray(approachDeltaFallback.rows)
      ? approachDeltaFallback.rows.filter(row => row)
      : [];

    const deltaPathForHealth = approachDeltaPathForResults || approachDeltaPathFallback || null;
    const deltaRowsForHealth = deltaPathForHealth === approachDeltaPathForResults
      ? approachDeltaPrimaryRows
      : approachDeltaFallbackRows;
    const deltaMetaForHealth = deltaPathForHealth === approachDeltaPathForResults
      ? approachDeltaPrimary.meta
      : approachDeltaFallback.meta;
    if (!deltaPathForHealth) {
      logApproachDeltaHealthFailure({ reason: 'missing_delta_file', filePath: null, sample: null });
      process.exit(1);
    }
    const deltaHealth = evaluateApproachDeltaHealth({
      filePath: deltaPathForHealth,
      meta: deltaMetaForHealth,
      rows: deltaRowsForHealth
    });
    if (!deltaHealth.ok) {
      logApproachDeltaHealthFailure({
        reason: deltaHealth.reason,
        filePath: deltaPathForHealth,
        sample: deltaHealth.sample
      });
      process.exit(1);
    }

    if (approachDeltaPathFallback && approachDeltaPathForResults && approachDeltaPathFallback !== approachDeltaPathForResults) {
      console.log(`ℹ️  Using current-event approach delta as fallback: ${path.basename(approachDeltaPathFallback)}.`);
    }

    const mergeApproachDeltaRows = (primaryRow, fallbackRow) => {
      if (!primaryRow && !fallbackRow) return null;
      if (!primaryRow) return fallbackRow;
      if (!fallbackRow) return primaryRow;
      const merged = {};
      const keys = new Set([...
        Object.keys(fallbackRow),
        Object.keys(primaryRow)
      ]);
      keys.forEach(key => {
        const primaryValue = primaryRow[key];
        const fallbackValue = fallbackRow[key];
        if (typeof primaryValue === 'number') {
          merged[key] = Number.isFinite(primaryValue) ? primaryValue : fallbackValue;
          return;
        }
        if (primaryValue === null || primaryValue === undefined || primaryValue === '') {
          merged[key] = fallbackValue !== undefined ? fallbackValue : primaryValue;
          return;
        }
        merged[key] = primaryValue;
      });
      return merged;
    };

    const approachDeltaPrimaryById = resultsCsvUtils.buildApproachDeltaMap(approachDeltaPrimaryRows);
    const approachDeltaFallbackById = resultsCsvUtils.buildApproachDeltaMap(approachDeltaFallbackRows);
    const mergedApproachDeltaRows = [];
    const mergedIds = new Set([
      ...approachDeltaFallbackById.keys(),
      ...approachDeltaPrimaryById.keys()
    ]);
    mergedIds.forEach(dgId => {
      const mergedRow = mergeApproachDeltaRows(
        approachDeltaPrimaryById.get(dgId) || null,
        approachDeltaFallbackById.get(dgId) || null
      );
      if (mergedRow) mergedApproachDeltaRows.push(mergedRow);
    });
    const approachDeltaById = resultsCsvUtils.buildApproachDeltaMap(mergedApproachDeltaRows);

    const resultsCsv = resultsCsvUtils.buildPostEventResultsCsv({
      rankingsById,
      resultsById,
      actualMetricsById,
      actualTrendsById,
      approachDeltaById
    });

    const resultsCsvPath = buildArtifactPath({
      artifactType: OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_CSV,
      outputBaseName,
      tournamentSlug: canonicalTournamentSlug || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
      tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback,
      modeRoot: postEventOutputDir || OUTPUT_DIR
    });
    fs.writeFileSync(resultsCsvPath, resultsCsv);
    console.log(`✅ Post-event results CSV saved to: ${resultsCsvPath}`);
    return;
  }

  let approachDataForTop20 = approachDataCurrent;
  let approachDataForTop20Source = approachDataCurrentSource;
  let approachEventOnlyMeta = null;

  if (HAS_CURRENT_RESULTS) {
    const overridePre = resolveApproachOverrideEntry(APPROACH_EVENT_ONLY_PRE, 'approach_override_pre');
    const overridePost = resolveApproachOverrideEntry(APPROACH_EVENT_ONLY_POST, 'approach_override_post');
    const hasOverridePair = !!(overridePre && overridePost);
    const eventDateInfo = resolveEventStartDateFromManifest({
      dataRootDir: DATA_ROOT_DIR,
      season: effectiveSeason,
      eventId: CURRENT_EVENT_ID,
      tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback
    });
    if (overridePre || overridePost || eventDateInfo?.time) {
      const candidates = buildApproachSnapshotCandidates({
        dataRootDir: DATA_ROOT_DIR,
        season: effectiveSeason
      });
      const ytdCandidates = candidates.filter(entry => entry?.source === 'snapshot_archive' || entry?.source === 'snapshot_latest');
      const manifestFallback = buildManifestApproachCsvFallback({
        dataRootDir: DATA_ROOT_DIR,
        season: effectiveSeason,
        eventId: CURRENT_EVENT_ID,
        tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
        tournamentName: TOURNAMENT_NAME || tournamentNameFallback
      });
      if (manifestFallback?.currentEntry || manifestFallback?.nextEntry) {
        const currentLabel = manifestFallback.currentEntry
          ? `${manifestFallback.currentEntry.eventId || 'n/a'}:${manifestFallback.currentEntry.tournamentSlug || manifestFallback.currentEntry.tournamentName || 'unknown'}@${manifestFallback.currentEntry.date || 'n/a'}`
          : 'none';
        const nextLabel = manifestFallback.nextEntry
          ? `${manifestFallback.nextEntry.eventId || 'n/a'}:${manifestFallback.nextEntry.tournamentSlug || manifestFallback.nextEntry.tournamentName || 'unknown'}@${manifestFallback.nextEntry.date || 'n/a'}`
          : 'none';
        const manifestPreLabel = manifestFallback.eventPre?.path
          ? `${path.basename(manifestFallback.eventPre.path)} (${manifestFallback.eventPre.source || 'approach_csv'})`
          : 'none';
        const manifestPostLabel = manifestFallback.eventPost?.path
          ? `${path.basename(manifestFallback.eventPost.path)} (${manifestFallback.eventPost.source || 'approach_csv'})`
          : 'none';
        console.log(`ℹ️  Manifest approach entries: current=${currentLabel}, next=${nextLabel}.`);
        console.log(`ℹ️  Manifest approach CSVs: pre=${manifestPreLabel}, post=${manifestPostLabel}.`);
      } else {
        console.log('ℹ️  Manifest approach entries: none found for event-only fallback.');
      }
      let pre = null;
      let post = null;
      if (eventDateInfo?.time) {
        ({ pre, post } = selectApproachSnapshotsForEvent({
          eventDateMs: eventDateInfo.time,
          candidates: ytdCandidates
        }));
      }
      if (!pre || !post) {
        const preHasSnapshot = hasSnapshotArchiveForDate(ytdCandidates, manifestFallback?.currentEntry?.date);
        const postHasSnapshot = hasSnapshotArchiveForDate(ytdCandidates, manifestFallback?.nextEntry?.date);
        if ((!pre || (manifestFallback?.currentEntry?.date && !preHasSnapshot)) && manifestFallback?.eventPre) {
          pre = manifestFallback.eventPre;
        }
        if ((!post || (manifestFallback?.nextEntry?.date && !postHasSnapshot)) && manifestFallback?.eventPost) {
          post = manifestFallback.eventPost;
        }
      }

      if (overridePre) {
        pre = overridePre;
      }
      if (overridePost) {
        post = overridePost;
      }
      if (overridePre || overridePost) {
        console.log(`ℹ️  Using approach event-only override snapshots: pre=${overridePre ? path.basename(overridePre.path) : 'auto'}, post=${overridePost ? path.basename(overridePost.path) : 'auto'}.`);
      }

      const snapshotOnlyDelta = isSnapshotOnlyDeltaEvent({
        eventId: CURRENT_EVENT_ID,
        tournamentSlug: canonicalTournamentSlug,
        tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback
      });

      if (!pre?.path || !post?.path) {
        let csvPre = manifestFallback?.eventPre || manifestFallback?.pre || null;
        let csvPost = manifestFallback?.eventPost || manifestFallback?.post || null;
        if (!csvPre || !csvPost) {
          const currentCsvPath = APPROACH_PATH && fs.existsSync(APPROACH_PATH)
            ? APPROACH_PATH
            : null;
          const previousCsvPath = resolvePreviousApproachCsv(effectiveSeason, currentCsvPath);
          if (!csvPre && previousCsvPath) {
            csvPre = {
              path: previousCsvPath,
              time: (() => {
                try {
                  return fs.statSync(previousCsvPath).mtimeMs || 0;
                } catch (error) {
                  return 0;
                }
              })(),
              date: null,
              source: 'approach_csv_auto',
              priority: 5
            };
          }
          if (!csvPost && currentCsvPath) {
            csvPost = {
              path: currentCsvPath,
              time: (() => {
                try {
                  return fs.statSync(currentCsvPath).mtimeMs || 0;
                } catch (error) {
                  return 0;
                }
              })(),
              date: null,
              source: 'approach_csv_auto',
              priority: 5
            };
          }
        }
        if (!snapshotOnlyDelta && (csvPre?.path || csvPost?.path)) {
          if (!pre?.path && csvPre?.path) pre = csvPre;
          if (!post?.path && csvPost?.path) post = csvPost;
          if (pre?.path && post?.path) {
            console.log(`ℹ️  Using approach CSVs for event-only fallback: pre=${path.basename(pre.path)}, post=${path.basename(post.path)}.`);
          }
        } else if (snapshotOnlyDelta && (csvPre?.path || csvPost?.path)) {
          console.log('ℹ️  Skipping approach CSV fallback (snapshot-only delta policy).');
        }
      }

      if (pre?.path || post?.path) {
        const preLabel = pre?.path ? `${path.basename(pre.path)} (${pre.source || 'unknown'})` : 'none';
        const postLabel = post?.path ? `${path.basename(post.path)} (${post.source || 'unknown'})` : 'none';
        console.log(`ℹ️  Event-only snapshot selection: pre=${preLabel}, post=${postLabel}.`);
      }

      const allowCsvPair = pre?.source === 'approach_csv_auto' && post?.source === 'approach_csv_auto';
      if (pre?.path && post?.path && (hasOverridePair || post.time > pre.time || allowCsvPair)) {
        const beforeRows = loadApproachCsv(pre.path);
        const afterRows = loadApproachCsv(post.path);
        const eventOnlyResult = computeEventOnlyApproachRows({ beforeRows, afterRows });
        const overlapCount = countApproachRowsInField(eventOnlyResult.rows);
        const overlapPct = fieldIdSetForDelta.size ? overlapCount / fieldIdSetForDelta.size : 0;
        const minApproachOverlapPct = Math.max(0, Math.min(1, getEnvNumberValue('MODEL_FIELD_MIN_APPROACH_OVERLAP', 0.4)));
        const minPlayers = Math.max(20, Math.floor(getEnvNumberValue('MODEL_FIELD_MIN_PLAYERS', 70)));

        approachEventOnlyMeta = {
          pre: { path: pre.path, date: pre.date || null, source: pre.source || null },
          post: { path: post.path, date: post.date || null, source: post.source || null },
          playersWithShots: eventOnlyResult.playersWithShots,
          rows: eventOnlyResult.rows.length,
          fieldOverlap: overlapCount,
          fieldOverlapPct: overlapPct
        };

        if (eventOnlyResult.rows.length > 0 && overlapPct >= minApproachOverlapPct && eventOnlyResult.playersWithShots >= minPlayers) {
          approachEventOnlyAvailable = true;
          approachDataForTop20 = eventOnlyResult.rows;
          approachDataForTop20Source = 'event_only';
          console.log(`✓ Event-only approach metrics enabled (pre=${path.basename(pre.path)}, post=${path.basename(post.path)}, overlap ${(overlapPct * 100).toFixed(1)}%).`);
        } else {
          console.log(`ℹ️  Event-only approach metrics unavailable (overlap ${(overlapPct * 100).toFixed(1)}%, players ${eventOnlyResult.playersWithShots}).`);
        }
      } else if (!pre?.path || !post?.path) {
        console.log('ℹ️  Event-only approach metrics unavailable (missing pre/post snapshot sources).');
      } else if (!hasOverridePair) {
        console.log('ℹ️  Event-only approach metrics unavailable (pre/post snapshot timestamps not ordered).');
      }
    } else {
      console.log('ℹ️  Event-only approach metrics unavailable (event start date not found in manifest).');
    }
  }

  if (HAS_CURRENT_RESULTS && !approachEventOnlyAvailable && shouldFetchApi && DATAGOLF_API_KEY) {
    try {
      const refreshed = await refreshYtdApproachSnapshot({
        apiKey: DATAGOLF_API_KEY,
        cacheDir: null,
        ttlMs: DATAGOLF_APPROACH_TTL_HOURS * 60 * 60 * 1000
      });
      if (refreshed?.payload) {
        approachSnapshotYtd = refreshed;
        approachSnapshotRows.ytd = extractApproachRowsFromJson(refreshed.payload);
        if (refreshed?.source === 'api') {
          approachYtdUpdatedThisRun = true;
        }
        const candidates = buildApproachSnapshotCandidates({
          dataRootDir: DATA_ROOT_DIR,
          season: effectiveSeason
        });
        const eventDateInfo = resolveEventStartDateFromManifest({
          dataRootDir: DATA_ROOT_DIR,
          season: effectiveSeason,
          eventId: CURRENT_EVENT_ID,
          tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
          tournamentName: TOURNAMENT_NAME || tournamentNameFallback
        });
        if (eventDateInfo?.time) {
          const manifestFallback = buildManifestApproachCsvFallback({
            dataRootDir: DATA_ROOT_DIR,
            season: effectiveSeason,
            eventId: CURRENT_EVENT_ID,
            tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
            tournamentName: TOURNAMENT_NAME || tournamentNameFallback
          });
          let { pre, post } = selectApproachSnapshotsForEvent({
            eventDateMs: eventDateInfo.time,
            candidates
          });
          const preHasSnapshot = hasSnapshotArchiveForDate(candidates, manifestFallback?.currentEntry?.date);
          const postHasSnapshot = hasSnapshotArchiveForDate(candidates, manifestFallback?.nextEntry?.date);
          if ((!pre || (manifestFallback?.currentEntry?.date && !preHasSnapshot)) && manifestFallback?.eventPre) {
            pre = manifestFallback.eventPre;
          }
          if ((!post || (manifestFallback?.nextEntry?.date && !postHasSnapshot)) && manifestFallback?.eventPost) {
            post = manifestFallback.eventPost;
          }
          if (pre?.path && post?.path && post.time > pre.time) {
            const beforeRows = loadApproachCsv(pre.path);
            const afterRows = loadApproachCsv(post.path);
            const eventOnlyResult = computeEventOnlyApproachRows({ beforeRows, afterRows });
            const overlapCount = countApproachRowsInField(eventOnlyResult.rows);
            const overlapPct = fieldIdSetForDelta.size ? overlapCount / fieldIdSetForDelta.size : 0;
            const minApproachOverlapPct = Math.max(0, Math.min(1, getEnvNumberValue('MODEL_FIELD_MIN_APPROACH_OVERLAP', 0.4)));
            const minPlayers = Math.max(20, Math.floor(getEnvNumberValue('MODEL_FIELD_MIN_PLAYERS', 70)));
            if (eventOnlyResult.rows.length > 0 && overlapPct >= minApproachOverlapPct && eventOnlyResult.playersWithShots >= minPlayers) {
              approachEventOnlyAvailable = true;
              approachDataForTop20 = eventOnlyResult.rows;
              approachDataForTop20Source = 'event_only';
              console.log(`✓ Event-only approach metrics enabled after snapshot refresh (pre=${path.basename(pre.path)}, post=${path.basename(post.path)}, overlap ${(overlapPct * 100).toFixed(1)}%).`);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`ℹ️  Event-only approach refresh failed: ${error.message}`);
    }
  }

  if (!APPROACH_DELTA_PATH) {
    const deltaModeLabel = HAS_CURRENT_RESULTS ? 'post-tournament' : 'pre-tournament';
    const snapshotOnlyDelta = isSnapshotOnlyDeltaEvent({
      eventId: CURRENT_EVENT_ID,
      tournamentSlug: canonicalTournamentSlug,
      tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback
    });
    console.log(`ℹ️  No approach delta JSON found; attempting auto-generation (${deltaModeLabel}).`);
    if (snapshotOnlyDelta) {
      console.log('ℹ️  Approach delta generation locked to snapshots only for this event (CSV fallback disabled).');
    }
    if (DATAGOLF_API_KEY && SHOULD_REFRESH_YTD) {
      try {
        const refreshed = await refreshYtdApproachSnapshot({
          apiKey: DATAGOLF_API_KEY,
          cacheDir: null,
          ttlMs: DATAGOLF_APPROACH_TTL_HOURS * 60 * 60 * 1000
        });
        if (refreshed?.payload) {
          approachSnapshotYtd = refreshed;
          approachSnapshotRows.ytd = extractApproachRowsFromJson(refreshed.payload);
          console.log('✓ Refreshed YTD approach snapshot for delta generation.');
          if (refreshed?.source === 'api') {
            approachYtdUpdatedThisRun = true;
          }
        }
      } catch (error) {
        console.warn(`ℹ️  Unable to refresh YTD snapshot for delta generation: ${error.message}`);
      }
    } else if (!SHOULD_REFRESH_YTD) {
      console.log('ℹ️  Skipping YTD snapshot refresh for delta generation (post-tournament run).');
    }

    const resolveApproachOverrideSource = source => {
      if (!source) return source;
      if (typeof source !== 'string') return source;
      if (source.startsWith('snapshot:')) return source;
      if (path.isAbsolute(source)) return source;
      const snapshotCandidate = path.resolve(APPROACH_SNAPSHOT_DIR, source);
      if (fs.existsSync(snapshotCandidate)) return snapshotCandidate;
      const hasWildcard = /[\*\?]/.test(source);
      if (hasWildcard) return path.resolve(DATA_ROOT_DIR, source);
      const cwdResolved = path.resolve(source);
      if (fs.existsSync(cwdResolved)) return cwdResolved;
      const dataResolved = path.resolve(DATA_ROOT_DIR, source);
      if (fs.existsSync(dataResolved)) return dataResolved;
      return cwdResolved;
    };
    const buildSourceMeta = (pathValue, sourceLabel = 'override') => {
      if (!pathValue) return null;
      return {
        path: pathValue,
        source: sourceLabel,
        time: resolveApproachSnapshotTimestamp(pathValue),
        date: null
      };
    };

    let previousMeta = OVERRIDE_APPROACH_DELTA_PREVIOUS
      ? buildSourceMeta(resolveApproachOverrideSource(OVERRIDE_APPROACH_DELTA_PREVIOUS), 'override_previous')
      : null;
    let currentMeta = OVERRIDE_APPROACH_DELTA_CURRENT
      ? buildSourceMeta(resolveApproachOverrideSource(OVERRIDE_APPROACH_DELTA_CURRENT), 'override_current')
      : null;

    if (!previousMeta || !currentMeta) {
      const eventDateInfo = resolveEventStartDateFromManifest({
        dataRootDir: DATA_ROOT_DIR,
        season: CURRENT_SEASON,
        eventId: CURRENT_EVENT_ID,
        tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
        tournamentName: TOURNAMENT_NAME || tournamentNameFallback
      });
      const snapshotOnlyDelta = isSnapshotOnlyDeltaEvent({
        eventId: CURRENT_EVENT_ID,
        tournamentSlug: canonicalTournamentSlug,
        tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback
      });
      const anchorEventDateMs = (() => {
        if (!snapshotOnlyDelta) return eventDateInfo?.time || null;
        const seasonEntries = Array.isArray(manifestEntries) && manifestEntries.length
          ? manifestEntries
          : loadSeasonManifestEntries(DATA_ROOT_DIR, CURRENT_SEASON);
        const currentEntry = resolveManifestEntryForEvent(seasonEntries, {
          eventId: CURRENT_EVENT_ID,
          tournamentSlug: canonicalTournamentSlug,
          tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback
        });
        const previousEntry = currentEntry
          ? resolvePreviousManifestEntry(seasonEntries, currentEntry)
          : null;
        if (!previousEntry?.date) return eventDateInfo?.time || null;
        const parsed = parseDateToUtcMs(previousEntry.date);
        return Number.isNaN(parsed) ? (eventDateInfo?.time || null) : parsed;
      })();
      const snapshotCandidates = buildApproachSnapshotCandidates({
        dataRootDir: DATA_ROOT_DIR,
        season: CURRENT_SEASON,
        manifestEntries
      });
      let pre = null;
      let post = null;
      if (anchorEventDateMs) {
        const beforeEvent = (snapshotCandidates || [])
          .filter(entry => typeof entry?.time === 'number' && entry.time <= anchorEventDateMs)
          .sort((a, b) => (b.time - a.time) || ((b.priority || 0) - (a.priority || 0)));
        const afterEvent = (snapshotCandidates || [])
          .filter(entry => typeof entry?.time === 'number' && entry.time > anchorEventDateMs)
          .sort((a, b) => (a.time - b.time) || ((b.priority || 0) - (a.priority || 0)));

        pre = beforeEvent[0] || null;
        const preferAfterEventSnapshot = snapshotOnlyDelta || HAS_CURRENT_RESULTS || IS_POST_TOURNAMENT_RUN;
        post = preferAfterEventSnapshot ? (afterEvent[0] || null) : (beforeEvent[1] || null);
        if (preferAfterEventSnapshot && !post && beforeEvent.length > 1) {
          post = beforeEvent[0] || null;
          pre = beforeEvent[1] || pre;
        }
      }

      const manifestFallback = buildManifestApproachCsvFallback({
        dataRootDir: DATA_ROOT_DIR,
        season: CURRENT_SEASON,
        eventId: CURRENT_EVENT_ID,
        tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
        tournamentName: TOURNAMENT_NAME || tournamentNameFallback
      });

      if (!previousMeta && pre?.path) previousMeta = pre;
      if (!currentMeta && post?.path) currentMeta = post;

      if (!snapshotOnlyDelta && !previousMeta && manifestFallback?.pre?.path) previousMeta = manifestFallback.pre;
      if (!snapshotOnlyDelta && !currentMeta && manifestFallback?.post?.path) currentMeta = manifestFallback.post;

      if (!previousMeta || !currentMeta) {
        if (!eventDateInfo?.time) {
          if (!previousMeta) previousMeta = buildSourceMeta('snapshot:previous', 'snapshot_previous');
          if (!currentMeta) currentMeta = buildSourceMeta('snapshot:current', 'snapshot_current');
        }
      }
    }

    let previousSource = previousMeta?.path || resolveApproachOverrideSource('snapshot:previous');
    let currentSource = currentMeta?.path || resolveApproachOverrideSource('snapshot:current');
    let previousRows = loadApproachCsv(previousSource);
    let currentRows = loadApproachCsv(currentSource);

    if (previousMeta || currentMeta) {
      const preLabel = previousMeta?.path
        ? `${path.basename(previousMeta.path)} (${previousMeta.source || 'unknown'})`
        : 'none';
      const postLabel = currentMeta?.path
        ? `${path.basename(currentMeta.path)} (${currentMeta.source || 'unknown'})`
        : 'none';
      console.log(`ℹ️  Approach delta pre/post selection: pre=${preLabel}, post=${postLabel}.`);
    }

    console.log(`ℹ️  Approach delta sources resolved: current=${currentSource} (${currentRows.length} rows), previous=${previousSource} (${previousRows.length} rows)`);

    if (!snapshotOnlyDelta && (previousRows.length === 0 || currentRows.length === 0)) {
      const currentApproachPath = APPROACH_PATH && fs.existsSync(APPROACH_PATH)
        ? APPROACH_PATH
        : null;
      const previousApproachPath = resolvePreviousApproachCsv(CURRENT_SEASON, currentApproachPath);
      const csvCurrentRows = currentApproachPath ? loadApproachCsv(currentApproachPath) : [];
      const csvPreviousRows = previousApproachPath ? loadApproachCsv(previousApproachPath) : [];
      if (csvCurrentRows.length > 0 && csvPreviousRows.length > 0) {
        currentRows = csvCurrentRows;
        previousRows = csvPreviousRows;
        currentSource = currentApproachPath;
        previousSource = previousApproachPath;
        console.log('✓ Approach delta auto-generation using approach CSVs (current + previous tournaments).');
      }
    } else if (snapshotOnlyDelta && (previousRows.length === 0 || currentRows.length === 0)) {
      console.log('ℹ️  Snapshot-only delta policy: skipping CSV fallback for missing snapshot rows.');
    }

    if (!OVERRIDE_APPROACH_DELTA_IGNORE_LAG) {
      const currentStamp = currentMeta?.time || resolveApproachSnapshotTimestamp(currentSource);
      const previousStamp = previousMeta?.time || resolveApproachSnapshotTimestamp(previousSource);
      const csvSources = [previousMeta?.source, currentMeta?.source]
        .filter(Boolean)
        .some(source => source.includes('approach_csv'));
      if (snapshotOnlyDelta) {
        // Snapshot-only events can use tighter windows without blocking delta generation.
      } else if (!csvSources && currentStamp && previousStamp) {
        const diffDays = Math.abs(currentStamp - previousStamp) / (1000 * 60 * 60 * 24);
        if (diffDays < APPROACH_DELTA_MIN_DAYS) {
          console.warn(`ℹ️  Approach delta auto-generation skipped (snapshots only ${diffDays.toFixed(2)} days apart; min=${APPROACH_DELTA_MIN_DAYS}).`);
          previousRows = [];
          currentRows = [];
        }
      }
    }

    if (previousRows.length === 0 || currentRows.length === 0) {
      console.warn('ℹ️  Approach delta auto-generation skipped (missing current/previous snapshots or approach CSVs).');
    } else {
      const deltaRows = computeApproachDeltas({ previousRows, currentRows });
      const fieldIdSet = new Set(
        fieldData
          .map(row => String(row?.dg_id || '').trim())
          .filter(Boolean)
      );
      const taggedRows = deltaRows.map(row => ({
        ...row,
        tournament_field: fieldIdSet.size > 0 ? fieldIdSet.has(String(row?.dg_id || '').trim()) : null
      }));
      if (taggedRows.length === 0) {
        console.warn('ℹ️  Approach delta auto-generation skipped (no overlapping players).');
      } else {
        const deltaSlug = canonicalTournamentSlug
          || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback)
          || `event-${CURRENT_EVENT_ID || 'unknown'}`;
        const dateStamp = formatDateKey(new Date()).replace(/-/g, '_');
        const outputName = `approach_deltas_${deltaSlug}_${dateStamp}.json`;
        const outputPath = path.resolve(APPROACH_DELTA_DIR, outputName);
        const meta = {
          generatedAt: formatTimestamp(new Date()),
          previousPath: previousSource,
          currentPath: currentSource,
          fieldCount: fieldIdSet.size,
          beforeCount: deltaRows.length,
          afterCount: taggedRows.length,
          note: `Auto-generated in ${deltaModeLabel} mode from snapshots or approach CSVs.`
        };
        writeJsonFile(outputPath, { meta, rows: taggedRows });
        APPROACH_DELTA_PATH = outputPath;
        console.log(`✓ Approach delta JSON generated: ${outputPath}`);
      }
    }
  }

  if (RUN_DELTA_ONLY) {
    if (APPROACH_DELTA_PATH) {
      console.log(`✅ Approach delta ready: ${APPROACH_DELTA_PATH}`);
      return;
    }
    console.error('❌ Delta-only mode: no approach delta file generated.');
    process.exit(1);
  }

  if (WRITE_TEMPLATES && OUTPUT_DIR) {
    if (HAS_CURRENT_RESULTS) {
      const removedBackups = deleteArchiveBackups(OUTPUT_DIR);
      if (removedBackups > 0) {
        console.log(`🧹 Removed ${removedBackups} .bak file(s) from ${path.resolve(OUTPUT_DIR, 'archive')}.`);
      }
    } else {
      console.log('ℹ️  Skipping archive cleanup (pre-tournament mode: no results derived).');
    }
  }

  const resolveApproachDeltaSnapshotSourcesForEvent = ({
    season,
    eventId,
    tournamentSlug,
    tournamentName,
    manifestEntries
  }) => {
    const manifestFallback = buildManifestApproachCsvFallback({
      dataRootDir: DATA_ROOT_DIR,
      season,
      eventId,
      tournamentSlug,
      tournamentName
    });
    const snapshotPair = resolveApproachSnapshotPairForEvent({
      dataRootDir: DATA_ROOT_DIR,
      approachSnapshotDir: APPROACH_SNAPSHOT_DIR,
      season,
      eventId,
      tournamentSlug,
      tournamentName,
      manifestEntries,
      csvFallback: {
        prePath: manifestFallback?.eventPre?.path || null,
        postPath: manifestFallback?.eventPost?.path || null
      }
    });

    return {
      previousPath: snapshotPair.prePath,
      currentPath: snapshotPair.postPath,
      source: snapshotPair.selectionSource
    };
  };

  const approachDeltaData = loadApproachDeltaRows(APPROACH_DELTA_PATH);
  let approachDeltaRowsAll = Array.isArray(approachDeltaData.rows) ? approachDeltaData.rows : [];
  let approachDeltaRows = approachDeltaRowsAll.filter(row => {
    if (!row) return false;
    if (row.tournament_field === false) return false;
    return true;
  });
  let approachDeltaPriorPath = null;
  let approachDeltaPriorData = null;
  let approachDeltaPriorRows = null;
  if (HAS_CURRENT_RESULTS && manifestEntries && manifestEntry) {
    const previousManifestEntry = resolvePreviousManifestEntry(manifestEntries, manifestEntry);
    if (previousManifestEntry?.tournamentName || previousManifestEntry?.tournamentSlug) {
      approachDeltaPriorPath = findApproachDeltaFile(
        [APPROACH_DELTA_DIR, OUTPUT_DIR, DATA_DIR, DEFAULT_DATA_DIR],
        previousManifestEntry.tournamentName,
        previousManifestEntry.tournamentSlug
      );
    }
    if (approachDeltaPriorPath) {
      approachDeltaPriorData = loadApproachDeltaRows(approachDeltaPriorPath);
      const priorRowsAll = Array.isArray(approachDeltaPriorData.rows) ? approachDeltaPriorData.rows : [];
      const priorRows = priorRowsAll.filter(row => {
        if (!row) return false;
        if (row.tournament_field === false) return false;
        return true;
      });
      if (priorRows.length > 0) {
        approachDeltaPriorRows = priorRows;
      }
    }
  }
  if (!IS_PRE_TOURNAMENT_RUN) {
    if (!APPROACH_DELTA_PATH) {
      logApproachDeltaHealthFailure({ reason: 'missing_delta_file', filePath: null, sample: null });
      process.exit(1);
    }
    const deltaHealth = evaluateApproachDeltaHealth({
      filePath: APPROACH_DELTA_PATH,
      meta: approachDeltaData.meta,
      rows: approachDeltaRowsAll
    });
    if (!deltaHealth.ok) {
      logApproachDeltaHealthFailure({
        reason: deltaHealth.reason,
        filePath: APPROACH_DELTA_PATH,
        sample: deltaHealth.sample
      });
      process.exit(1);
    }
  }
  const approachDeltaMetricSpecs = buildApproachDeltaMetricSpecs();
  let approachDeltaCorrelations = [];
  let approachDeltaAlignmentMap = new Map();
  let approachDeltaPriorMode = null;
  let approachDeltaPriorMeta = approachDeltaData.meta || null;
  let approachDeltaPriorFiles = APPROACH_DELTA_PATH ? [APPROACH_DELTA_PATH] : [];
  let approachDeltaPlayerSummary = null;

  if (HAS_CURRENT_RESULTS && (approachDeltaPriorRows || approachDeltaRows).length > 0) {
    if (approachDeltaPriorRows) {
      approachDeltaRowsAll = Array.isArray(approachDeltaPriorData?.rows) ? approachDeltaPriorData.rows : approachDeltaRowsAll;
      approachDeltaRows = approachDeltaPriorRows;
      approachDeltaPriorMode = 'previous_event';
      if (manifestEventDateInfo?.time) {
        const snapshotSources = resolveApproachDeltaSnapshotSourcesForEvent({
          season: CURRENT_SEASON,
          eventId: CURRENT_EVENT_ID,
          tournamentSlug: canonicalTournamentSlug,
          tournamentName: canonicalTournamentName || TOURNAMENT_NAME || tournamentNameFallback,
          manifestEntries
        });
        approachDeltaPriorMeta = {
          ...(approachDeltaPriorData?.meta || {}),
          source: 'previous_event',
          previousPath: snapshotSources.previousPath,
          currentPath: snapshotSources.currentPath,
          selectionSource: snapshotSources.source
        };
      } else {
        approachDeltaPriorMeta = {
          ...(approachDeltaPriorData?.meta || {}),
          source: 'previous_event'
        };
      }
      approachDeltaPriorFiles = approachDeltaPriorPath ? [approachDeltaPriorPath] : [];
      console.log(`✓ Using previous-event approach delta for prior: ${path.basename(approachDeltaPriorPath)}`);
    }
    approachDeltaCorrelations = computeApproachDeltaCorrelations(approachDeltaRows, resultsCurrent, approachDeltaMetricSpecs);
    approachDeltaAlignmentMap = buildApproachDeltaAlignmentMap(metricConfig, approachDeltaCorrelations);
    if (!approachDeltaPriorMode) approachDeltaPriorMode = 'current_event';
    console.log(`✓ Computed approach delta correlations (${approachDeltaCorrelations.length})`);
  } else if (!HAS_CURRENT_RESULTS) {
    let priorDeltaPath = null;
    let priorDeltaRows = null;
    if (IS_PRE_TOURNAMENT_RUN) {
      const manifestEntriesForDelta = loadSeasonManifestEntries(DATA_ROOT_DIR, CURRENT_SEASON);
      const currentManifestEntry = resolveManifestEntryForEvent(manifestEntriesForDelta, {
        eventId: CURRENT_EVENT_ID,
        tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
        tournamentName: TOURNAMENT_NAME || tournamentNameFallback
      });
      const previousManifestEntry = currentManifestEntry
        ? resolvePreviousManifestEntry(manifestEntriesForDelta, currentManifestEntry)
        : null;
      if (previousManifestEntry?.tournamentName || previousManifestEntry?.tournamentSlug) {
        priorDeltaPath = findApproachDeltaFile(
          [APPROACH_DELTA_DIR, OUTPUT_DIR, DATA_DIR, DEFAULT_DATA_DIR],
          previousManifestEntry.tournamentName,
          previousManifestEntry.tournamentSlug
        );
      }
      if (priorDeltaPath) {
        const priorDeltaData = loadApproachDeltaRows(priorDeltaPath);
        const priorRowsAll = Array.isArray(priorDeltaData?.rows) ? priorDeltaData.rows : [];
        const filteredRows = priorRowsAll.filter(row => row && row.tournament_field !== false);
        if (filteredRows.length > 0) {
          approachDeltaRowsAll = filteredRows;
          approachDeltaRows = filteredRows;
          approachDeltaAlignmentMap = buildApproachDeltaAlignmentFromRollingRows(
            approachDeltaMetricSpecs,
            approachDeltaRows
          );
          approachDeltaPriorMode = 'previous_event';
          approachDeltaPriorMeta = {
            ...(priorDeltaData?.meta || {}),
            source: 'previous_event',
            selectionSource: 'manifest'
          };
          approachDeltaPriorFiles = [priorDeltaPath];
          console.log(`✓ Using previous-event approach delta (manifest): ${path.basename(priorDeltaPath)}`);
          priorDeltaRows = filteredRows;
        }
      }
    }

    if (!priorDeltaRows) {
      const rollingEntries = getApproachDeltaFileEntries(
        [APPROACH_DELTA_DIR, OUTPUT_DIR, DATA_DIR, DEFAULT_DATA_DIR]
      );
      const rollingResult = buildRollingApproachDeltaRows(
        rollingEntries,
        approachDeltaMetricSpecs,
        fieldIdSetForDelta,
        APPROACH_DELTA_ROLLING_EVENTS
      );

      if (IS_PRE_TOURNAMENT_RUN && rollingResult?.meta?.filesUsed?.length) {
        const manifestEntriesForDelta = loadSeasonManifestEntries(DATA_ROOT_DIR, CURRENT_SEASON);
        const currentManifestEntry = resolveManifestEntryForEvent(manifestEntriesForDelta, {
          eventId: CURRENT_EVENT_ID,
          tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
          tournamentName: TOURNAMENT_NAME || tournamentNameFallback
        });
        const previousManifestEntry = currentManifestEntry
          ? resolvePreviousManifestEntry(manifestEntriesForDelta, currentManifestEntry)
          : null;
        if (previousManifestEntry?.tournamentName || previousManifestEntry?.tournamentSlug) {
          const priorDeltaPath = findApproachDeltaFile(
            [APPROACH_DELTA_DIR, OUTPUT_DIR, DATA_DIR, DEFAULT_DATA_DIR],
            previousManifestEntry.tournamentName,
            previousManifestEntry.tournamentSlug
          );
          if (priorDeltaPath && !rollingResult.meta.filesUsed.includes(priorDeltaPath)) {
            APPROACH_DELTA_ROLLING_RED_FLAG_NOTE = '🚩 RED FLAG: prior-week approach delta missing; rolling baseline used.';
          }
        }
      }

      if (rollingResult.rows.length > 0) {
        approachDeltaRowsAll = rollingResult.rows;
        approachDeltaRows = rollingResult.rows;
        approachDeltaAlignmentMap = buildApproachDeltaAlignmentFromRollingRows(
          approachDeltaMetricSpecs,
          approachDeltaRows
        );
        approachDeltaPriorMode = 'rolling_average';
        approachDeltaPriorMeta = rollingResult.meta || null;
        approachDeltaPriorFiles = rollingResult.meta?.filesUsed || [];
        console.log(`✓ Built rolling approach delta baseline (${rollingResult.meta?.fileCount || 0} files).`);
      } else if (!APPROACH_DELTA_PATH) {
        approachDeltaPriorFiles = [];
        console.log('ℹ️  Approach delta prior unavailable (no delta JSON found).');
      } else {
        approachDeltaPriorFiles = [];
        console.log('ℹ️  Approach delta prior skipped (missing current results and no rolling baseline).');
      }
    }
  } else if (!APPROACH_DELTA_PATH) {
    approachDeltaPriorFiles = [];
    console.log('ℹ️  Approach delta prior unavailable (no delta JSON found).');
  } else {
    approachDeltaPriorFiles = [];
    console.log('ℹ️  Approach delta prior skipped (no usable rows after filtering).');
  }

  if (!approachDeltaPriorMode && approachDeltaRows.length > 0) {
    const fallbackAlignmentMap = buildApproachDeltaAlignmentFromRollingRows(
      approachDeltaMetricSpecs,
      approachDeltaRows
    );
    if (fallbackAlignmentMap.size > 0) {
      approachDeltaAlignmentMap = fallbackAlignmentMap;
      approachDeltaPriorMode = 'fallback_average';
    }
  }

  if (approachDeltaAlignmentMap.size > 0 && approachDeltaRows.length > 0) {
    approachDeltaPlayerSummary = { totalPlayers: approachDeltaRows.length };
  }

  const field2026DgIds = fieldIdSetForDelta;
  console.log(`✓ Loaded 2026 field: ${field2026DgIds.size} players\n`);

  const deltaScoresById = typeof getDeltaPlayerScoresForEvent === 'function'
    ? getDeltaPlayerScoresForEvent(CURRENT_EVENT_ID, CURRENT_SEASON)
    : {};

  const runtimeConfig = {
    similarCoursesWeight: sharedConfig.similarCoursesWeight,
    puttingCoursesWeight: sharedConfig.puttingCoursesWeight,
    courseSetupWeights: sharedConfig.courseSetupWeights,
    currentSeason: CURRENT_SEASON,
    deltaScoresById,
    playerRampById: rampById,
    playerRampWeight: PAST_PERF_RAMP_WEIGHT,
    playerRampMaxEvents: rampMaxEvents,
    weatherHourlyPenalties: weatherWaveSummary?.hourlyPenalties || null,
    weatherDateStart: weatherWaveSummary?.dateStart || null,
    weatherTimeZone: resolveTimeZone(courseContextEntryFinal) || null,
    weatherRoundDurationHours: getEnvNumberValue('WEATHER_ROUND_DURATION_HOURS', 4.25),
    weatherBasePenalties: weatherWaveSummary?.basePenalties || null
  };

  const runRanking = ({ roundsRawData, approachRawData, groupWeights, metricWeights, includeCurrentEventRounds = false, fieldDataOverride = null }) => {
    const adjustedMetricWeights = applyShotDistributionToMetricWeights(
      metricWeights,
      sharedConfig.courseSetupWeights
    );
    let deltaScoresByIdForRun = runtimeConfig.deltaScoresById;
    if (approachDeltaAlignmentMap.size > 0 && approachDeltaRows.length > 0) {
      const trendScores = buildApproachDeltaPlayerScores(
        approachDeltaMetricSpecs,
        approachDeltaRows,
        approachDeltaAlignmentMap
      );
      const predictiveAlignmentMap = buildApproachAlignmentMapFromMetricWeights(
        metricConfig,
        adjustedMetricWeights,
        approachDeltaMetricSpecs
      );
      const predictiveScores = buildApproachDeltaPlayerScores(
        approachDeltaMetricSpecs,
        approachDeltaRows,
        predictiveAlignmentMap
      );
      const derivedDeltaScores = buildDeltaScoresByIdFromScores(trendScores, predictiveScores);
      if (Object.keys(derivedDeltaScores).length > 0) {
        deltaScoresByIdForRun = derivedDeltaScores;
      }
    }
    const rankingRuntimeConfig = {
      ...runtimeConfig,
      deltaScoresById: deltaScoresByIdForRun
    };
    const playerData = buildPlayerData({
      fieldData: fieldDataOverride || fieldData,
      roundsRawData,
      approachRawData,
      currentEventId: CURRENT_EVENT_ID,
      currentSeason: CURRENT_SEASON,
      includeCurrentEventRounds
    });

    const templateGroups = buildModifiedGroups(
      metricConfig.groups,
      groupWeights,
      adjustedMetricWeights
    );

    return generatePlayerRankings(
      playerData.players,
      { groups: templateGroups, pastPerformance: metricConfig.pastPerformance },
      playerData.historicalData,
      playerData.approachData,
      sharedConfig.similarCourseIds,
      sharedConfig.puttingCourseIds,
      rankingRuntimeConfig
    );
  };

  const filterOutCurrentSeasonEvent = rows => (rows || []).filter(row => {
    const seasonValue = parseInt(String(row?.year || row?.season || '').trim());
    if (Number.isNaN(seasonValue)) return true;
    const eventIdValue = String(row?.event_id || '').trim();
    return !(String(seasonValue) === String(CURRENT_SEASON) && eventIdValue === String(CURRENT_EVENT_ID));
  });

  const getCurrentSeasonRoundsForRanking = includeCurrentEventRounds => {
    if (includeCurrentEventRounds) {
      return roundsByYear[CURRENT_SEASON] || historicalDataForField;
    }
    // Parity mode: exclude only the current season's target event from ranking inputs.
    return filterOutCurrentSeasonEvent(historyData);
  };

  const buildEventResultsFromRows = eventRows => {
    const numericResults = new Map();
    const cutIds = new Set();

    eventRows.forEach(row => {
      const dgId = String(row['dg_id'] || '').trim();
      if (!dgId) return;
      const finishInfo = parseFinishStatus(row['fin_text']);
      if (typeof finishInfo.position === 'number' && !Number.isNaN(finishInfo.position)) {
        const existing = numericResults.get(dgId);
        if (!existing || finishInfo.position < existing) {
          numericResults.set(dgId, finishInfo.position);
        }
        return;
      }
      if (finishInfo.isCut) {
        cutIds.add(dgId);
      }
    });

    const positions = Array.from(numericResults.values());
    const fallback = positions.length ? Math.max(...positions) + 1 : null;
    if (Number.isFinite(fallback)) {
      cutIds.forEach(dgId => {
        if (!numericResults.has(dgId)) numericResults.set(dgId, fallback);
      });
    }

    return numericResults;
  };

  const buildEventSamples = eventRows => {
    const resultsByPlayer = buildEventResultsFromRows(eventRows);
    if (resultsByPlayer.size === 0) return [];
    const currentTemplate = templateConfigs[CURRENT_EVENT_ID] || Object.values(templateConfigs)[0];
    if (!currentTemplate) return [];

    const trainingFieldData = buildFieldDataFromHistory(eventRows, null);

    const ranking = runRanking({
      roundsRawData: eventRows,
      approachRawData: approachDataForTop20,
      groupWeights: currentTemplate.groupWeights,
      metricWeights: currentTemplate.metricWeights,
      includeCurrentEventRounds: true,
      fieldDataOverride: trainingFieldData
    });

    return ranking.players.reduce((acc, player) => {
      const finishPosition = resultsByPlayer.get(String(player.dgId));
      if (!finishPosition) return acc;
      const metricSpecs = GENERATED_METRIC_LABELS.map((label, index) => ({ label, index }));
      const featurePack = buildFeatureVector(player, metricSpecs);
      if (!featurePack) return acc;
      acc.push({ features: featurePack.features, label: finishPosition <= 20 ? 1 : 0 });
      return acc;
    }, []);
  };

  const buildEventSamplesBySeason = season => {
    const eventMap = new Map();
    historyData.forEach(row => {
      const eventId = String(row['event_id'] || '').trim();
      if (!eventId) return;
      const rowSeason = parseInt(String(row['year'] || row['season'] || '').trim());
      if (season && rowSeason !== season) return;
      if (!eventMap.has(eventId)) eventMap.set(eventId, []);
      eventMap.get(eventId).push(row);
    });

    const samplesByEvent = [];
    eventMap.forEach((rows, eventId) => {
      const samples = buildEventSamples(rows);
      if (samples.length >= 10) {
        samplesByEvent.push({ eventId, samples });
      }
    });
    return samplesByEvent;
  };

  const buildHistoricalEventSamples = (metricSpecs, groupWeights, metricWeights, eventIdSet = null) => {
    const eventMap = new Map();
    historyData.forEach(row => {
      const eventId = String(row['event_id'] || '').trim();
      if (!eventId) return;
      if (eventIdSet && !eventIdSet.has(eventId)) return;
      if (!eventMap.has(eventId)) eventMap.set(eventId, []);
      eventMap.get(eventId).push(row);
    });

    const samplesByEvent = [];
    eventMap.forEach((rows, eventId) => {
      const resultsByPlayer = buildEventResultsFromRows(rows);
      if (resultsByPlayer.size === 0) return;
      const trainingFieldData = buildFieldDataFromHistory(rows, eventIdSet);
      const ranking = runRanking({
        roundsRawData: rows,
        approachRawData: [],
        groupWeights,
        metricWeights,
        includeCurrentEventRounds: false,
        fieldDataOverride: trainingFieldData
      });

      const samples = ranking.players.reduce((acc, player) => {
        const finishPosition = resultsByPlayer.get(String(player.dgId));
        if (!finishPosition) return acc;
        const featurePack = buildFeatureVector(player, metricSpecs);
        if (!featurePack) return acc;
        acc.push({ features: featurePack.features, label: finishPosition <= 20 ? 1 : 0 });
        return acc;
      }, []);

      if (samples.length >= 10) {
        samplesByEvent.push({ eventId, samples });
      }
    });

    return samplesByEvent;
  };

  const buildFieldDataFromHistory = (rows, eventIdSet = null) => {
    const players = new Map();
    (rows || []).forEach(row => {
      const eventId = String(row['event_id'] || '').trim();
      if (eventIdSet && !eventIdSet.has(eventId)) return;
      const dgId = String(row['dg_id'] || '').trim();
      if (!dgId) return;
      if (!players.has(dgId)) {
        const playerName = String(row['player_name'] || '').trim();
        players.set(dgId, { dg_id: dgId, player_name: playerName });
      }
    });
    return Array.from(players.values());
  };

  const crossValidateTopNLogisticByEvent = (eventSamples, lambdaCandidates) => {
    if (!Array.isArray(eventSamples) || eventSamples.length < 3) {
      return { success: false, message: 'Not enough events for CV', eventCount: eventSamples ? eventSamples.length : 0 };
    }

    const allSamples = eventSamples.flatMap(entry => entry.samples);
    if (allSamples.length < 30) {
      return { success: false, message: 'Not enough samples for CV', eventCount: eventSamples.length, totalSamples: allSamples.length };
    }

    const lambdas = lambdaCandidates && lambdaCandidates.length > 0
      ? lambdaCandidates
      : [0, 0.001, 0.005, 0.01, 0.05, 0.1];

    const results = [];

    lambdas.forEach(l2 => {
      let totalLogLoss = 0;
      let totalAccuracy = 0;
      let foldsUsed = 0;

      eventSamples.forEach((fold, idx) => {
        const trainingSamples = eventSamples
          .filter((_, i) => i !== idx)
          .flatMap(entry => entry.samples);
        if (trainingSamples.length < 20 || fold.samples.length < 10) return;
        const model = trainLogisticFromSamples(trainingSamples, { l2 });
        if (!model.success) return;
        const evaluation = evaluateLogisticModel(model, fold.samples);
        totalLogLoss += evaluation.logLoss;
        totalAccuracy += evaluation.accuracy;
        foldsUsed += 1;
      });

      if (foldsUsed > 0) {
        results.push({
          l2,
          avgLogLoss: totalLogLoss / foldsUsed,
          avgAccuracy: totalAccuracy / foldsUsed,
          foldsUsed
        });
      }
    });

    if (results.length === 0) {
      return { success: false, message: 'No valid CV folds', eventCount: eventSamples.length };
    }

    results.sort((a, b) => a.avgLogLoss - b.avgLogLoss);
    const best = results[0];
    const finalModel = trainLogisticFromSamples(allSamples, { l2: best.l2 });

    return {
      success: true,
      eventCount: eventSamples.length,
      totalSamples: allSamples.length,
      bestL2: best.l2,
      avgLogLoss: best.avgLogLoss,
      avgAccuracy: best.avgAccuracy,
      foldsUsed: best.foldsUsed,
      allSamples,
      finalModel
    };
  };

  // =========================================================================
  // STEP 1: HISTORICAL METRIC CORRELATIONS + CURRENT-YEAR TEMPLATE BASELINE
  // =========================================================================
  console.log('---');
  console.log('STEP 1: HISTORICAL METRIC CORRELATIONS');
  console.log('Analyze past-year metrics vs finish position');
  console.log('---');

  const allEventRounds = historyData.filter(row => {
    const eventId = String(row['event_id'] || '').trim();
    return eventId === String(CURRENT_EVENT_ID);
  });

  const historicalDataForField = historyData.filter(row => {
    const dgId = String(row['dg_id'] || '').trim();
    const eventId = String(row['event_id'] || '').trim();
    return field2026DgIds.has(dgId) && eventId === String(CURRENT_EVENT_ID);
  });

  const roundsByYear = {};
  historicalDataForField.forEach(row => {
    const year = parseInt(String(row['year'] || '').trim());
    if (Number.isNaN(year)) return;
    if (!roundsByYear[year]) roundsByYear[year] = [];
    roundsByYear[year].push(row);
  });

  const resultsByYearSourceRows = !HAS_CURRENT_RESULTS ? allEventRounds : historicalDataForField;
  const resultsByYear = buildResultsByYear(resultsByYearSourceRows, CURRENT_EVENT_ID);
  const availableYears = Object.keys(resultsByYear).sort();
  const availableYearNumbers = availableYears
    .map(year => parseInt(String(year), 10))
    .filter(year => !Number.isNaN(year));
  const availableYearNumbersFiltered = IS_PRE_TOURNAMENT_RUN
    ? availableYearNumbers.filter(year => year < effectiveSeason)
    : availableYearNumbers;
  const latestAvailableYear = availableYearNumbersFiltered.length > 0
    ? Math.max(...availableYearNumbersFiltered)
    : null;
  const validationAnchorYear = !HAS_CURRENT_RESULTS && latestAvailableYear
    ? latestAvailableYear
    : effectiveSeason;
  const validationYears = availableYearNumbersFiltered
    .filter(year => year >= (validationAnchorYear - (VALIDATION_YEAR_WINDOW - 1)) && year <= validationAnchorYear)
    .sort((a, b) => a - b);

  const resultsByYearSourceLabel = !HAS_CURRENT_RESULTS ? 'event_history' : 'current_field';
  const availableYearsLabel = (IS_PRE_TOURNAMENT_RUN ? availableYearNumbersFiltered : availableYearNumbers)
    .map(year => String(year))
    .join(', ');
  console.log(`\n✓ Years available for evaluation: ${availableYearsLabel || 'none'} (${resultsByYearSourceLabel})`);
  const validationAnchorLabel = (!HAS_CURRENT_RESULTS && latestAvailableYear)
    ? `last ${VALIDATION_YEAR_WINDOW} from latest available (${validationAnchorYear})`
    : `last ${VALIDATION_YEAR_WINDOW} incl current`;
  console.log(`✓ Validation years (${validationAnchorLabel}): ${validationYears.join(', ') || 'none'}`);
  console.log(`✓ Total historical rounds for event ${CURRENT_EVENT_ID} (all players): ${allEventRounds.length}`);
  console.log(`✓ Total historical rounds for event ${CURRENT_EVENT_ID} (current field only): ${historicalDataForField.length}\n`);

  const historicalMetricSamples = buildHistoricalMetricSamples(allEventRounds, CURRENT_EVENT_ID);
  const historicalMetricCorrelations = computeHistoricalMetricCorrelations(historicalMetricSamples);

  console.log('---');
  console.log('STEP 1b: CURRENT-SEASON (EVENT ONLY) METRIC CORRELATIONS');
  console.log('Correlate current-season event-only metrics (event rounds only; event-only approach when available)');
  console.log(`Data usage (Step 1b): event rounds=${roundsByYear[effectiveSeason]?.length || 0}, results=${resultsCurrent.length}, approach=${formatApproachSourceDetail(approachEventOnlyAvailable ? 'event_only' : approachDataCurrentSource, approachEventOnlyAvailable ? approachDataForTop20 : approachDataCurrent)}, history=${formatHistorySourceDetail(historyMeta)}`);
  console.log('---');
  if (IS_PRE_TOURNAMENT_RUN && !HAS_CURRENT_RESULTS) {
    console.log('ℹ️  Pre-tournament: current-season results unavailable; Step 1b correlations will be skipped unless results exist.');
  }

  const currentSeasonRounds = roundsByYear[effectiveSeason] || [];
  const currentSeasonRoundsAllEvents = historyData.filter(row => {
    const dgId = String(row['dg_id'] || '').trim();
    if (!field2026DgIds.has(dgId)) return false;
    const year = parseInt(String(row['year'] || row['season'] || '').trim());
    if (Number.isNaN(year)) return false;
    return String(year) === String(effectiveSeason);
  });
  let eventOnlyGeneratedMetricCorrelations = [];
  let eventOnlyGeneratedTop20Correlations = [];
  let eventOnlyGeneratedTop20Logistic = null;
  let eventOnlyGeneratedTop20CvSummary = null;
  let step1bUsedRounds = [];
  let step1cUsedRounds = [];
  let currentGeneratedMetricCorrelations = [];
  let currentGeneratedTop20Correlations = [];
  let currentGeneratedTop20Logistic = null;
  let currentGeneratedTop20CvSummary = null;
  let historicalCoreTop20Correlations = [];
  let suggestedTop20MetricWeights = { source: 'none', weights: [] };
  let suggestedTop20GroupWeights = { source: 'none', weights: [] };
  let conservativeSuggestedTop20GroupWeights = { source: 'none', weights: [], cvReliability: 0, modelShare: 0, priorShare: 1 };
  let cvReliability = 0;
  let tunedTop20GroupWeights = null;
  let currentGeneratedCorrelationMap = new Map();
  let currentGeneratedTop20AlignmentMap = new Map();
  const HISTORICAL_METRIC_LABELS = GENERATED_METRIC_LABELS.slice(0, 17);
  const HISTORICAL_CORE_TOP20_BLEND = 0.65;
  const HISTORICAL_CORE_METRIC_LABELS = [
    'SG Total',
    'Scoring Average',
    'Birdies or Better',
    'Driving Distance',
    'Driving Accuracy',
    'SG T2G',
    'SG Approach',
    'SG Around Green',
    'SG OTT',
    'SG Putting',
    'Poor Shots'
  ];
  const TRAINING_EXCLUDED_LABELS = [
    'Birdie Chances Created',
    'SG Total',
    'SG Approach',
    'Greens in Regulation',
    'Fairway Proximity',
    'Rough Proximity'
  ];
  const TRAINING_EXCLUDED_SET = new Set(TRAINING_EXCLUDED_LABELS);
  let trainingMetricNotes = {
    included: [],
    excluded: TRAINING_EXCLUDED_LABELS.slice(),
    derived: ['Birdies or Better = birdies + eagles (from historical rounds when available)']
  };

  const coreMetricSpecs = HISTORICAL_CORE_METRIC_LABELS
    .filter(label => !TRAINING_EXCLUDED_SET.has(label))
    .map(label => ({ label, index: GENERATED_METRIC_LABELS.indexOf(label) }))
    .filter(spec => spec.index >= 0);
  if (coreMetricSpecs.length > 0 && allEventRounds.length > 0) {
    const baseTemplateForCore = templateConfigs[CURRENT_EVENT_ID] || Object.values(templateConfigs)[0];
    if (baseTemplateForCore) {
      const coreResults = buildResultsFromRows(allEventRounds);
      const coreFieldData = buildFieldDataFromHistory(allEventRounds, new Set([String(CURRENT_EVENT_ID)]));
      const coreGroupWeights = removeApproachGroupWeights(baseTemplateForCore.groupWeights || {});
      const coreRanking = runRanking({
        roundsRawData: allEventRounds,
        approachRawData: [],
        groupWeights: coreGroupWeights,
        metricWeights: baseTemplateForCore.metricWeights || {},
        includeCurrentEventRounds: resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.historicalEvaluation),
        fieldDataOverride: coreFieldData
      });
      historicalCoreTop20Correlations = computeGeneratedMetricTopNCorrelationsForLabels(
        coreRanking.players,
        coreResults,
        coreMetricSpecs,
        20
      );
    }
  }

  const eventOnlyRoundsFilter = rows => rows.filter(row => {
    const dgId = String(row['dg_id'] || '').trim();
    if (!field2026DgIds.has(dgId)) return false;
    const year = parseInt(String(row['year'] || row['season'] || '').trim());
    if (Number.isNaN(year)) return false;
    if (String(year) !== String(effectiveSeason)) return false;
    const eventId = String(row['event_id'] || '').trim();
    return eventId === String(CURRENT_EVENT_ID);
  });

  if (HAS_CURRENT_RESULTS) {
    let eventOnlyRounds = eventOnlyRoundsFilter(historyData);

    if (eventOnlyRounds.length === 0 && shouldFetchApi) {
      try {
        const eventSnapshot = await getDataGolfHistoricalRounds({
          apiKey: DATAGOLF_API_KEY,
          cacheDir: DATAGOLF_CACHE_DIR,
          ttlMs: 0,
          allowStale: true,
          tour: DATAGOLF_HISTORICAL_TOUR,
          eventId: String(CURRENT_EVENT_ID),
          year: effectiveSeason,
          fileFormat: 'json'
        });
        const eventRows = extractHistoricalRowsFromSnapshotPayload(eventSnapshot?.payload)
          .map(normalizeHistoricalRoundRow)
          .filter(Boolean);
        if (eventRows.length > 0) {
          historyData = historyData.concat(eventRows);
          eventOnlyRounds = eventOnlyRoundsFilter(historyData);
          console.log(`✓ Loaded ${eventRows.length} event rounds for Step 1b (event-only).`);
        }
      } catch (error) {
        console.warn(`ℹ️  Step 1b event rounds fetch failed: ${error.message}`);
      }
    }

    let eventOnlyApproachRows = approachEventOnlyAvailable ? approachDataForTop20 : [];
    if (!approachEventOnlyAvailable && approachDataCurrent.length > 0) {
      eventOnlyApproachRows = approachDataCurrent;
      console.warn('ℹ️  Step 1b event-only approach unavailable; falling back to latest approach snapshot.');
    }

    if (eventOnlyRounds.length > 0 && eventOnlyApproachRows.length > 0) {
      const eventOnlyTemplate = templateConfigs[CURRENT_EVENT_ID] || Object.values(templateConfigs)[0];
      if (eventOnlyTemplate) {
        const eventOnlyRanking = runRanking({
          roundsRawData: eventOnlyRounds,
          approachRawData: eventOnlyApproachRows,
          groupWeights: eventOnlyTemplate.groupWeights,
          metricWeights: eventOnlyTemplate.metricWeights,
          includeCurrentEventRounds: true
        });
        eventOnlyGeneratedMetricCorrelations = computeGeneratedMetricCorrelationsForLabels(
          eventOnlyRanking.players,
          resultsCurrent,
          eventOnlyMetricSpecs
        );
        const eventOnlyMetricSpecs = GENERATED_METRIC_LABELS
          .filter(label => !TRAINING_EXCLUDED_SET.has(label))
          .map((label, index) => ({ label, index }))
          .filter(spec => spec.index >= 0);
        eventOnlyGeneratedTop20Correlations = computeGeneratedMetricTopNCorrelationsForLabels(
          eventOnlyRanking.players,
          resultsCurrent,
          eventOnlyMetricSpecs,
          20
        );
        eventOnlyGeneratedTop20Logistic = trainTopNLogisticModel(
          eventOnlyRanking.players,
          resultsCurrent,
          eventOnlyMetricSpecs.map(spec => spec.label),
          { topN: 20 }
        );
        step1bUsedRounds = eventOnlyRounds;
        console.log(`✓ Computed ${eventOnlyGeneratedMetricCorrelations.length} event-only metric correlations (${CURRENT_SEASON}).`);
      }
    } else if (eventOnlyRounds.length === 0) {
      console.warn(`⚠️  No current-season event rounds found; skipping Step 1b event-only correlations.`);
    } else {
      console.warn('⚠️  Step 1b event-only approach data unavailable; skipping Step 1b correlations.');
    }
  }

  console.log('---');
  console.log('STEP 1c: CURRENT-SEASON (EVENT + SIMILAR + PUTTING) METRIC CORRELATIONS');
  console.log('Correlate generatePlayerRankings metrics for current season using event + similar/putting courses (latest approach snapshot)');
  const step1cCourseFilterMap = buildStep1cCourseFilterMap(courseContextEntryFinal, CURRENT_EVENT_ID);
  const step1cAllowedEventIds = new Set(Array.from(step1cCourseFilterMap.keys()));
  const step1cRoundsLabel = HAS_CURRENT_RESULTS
    ? `${currentSeasonRoundsAllEvents.length}`
    : (IS_PRE_TOURNAMENT_RUN ? 'current-season-only' : 'multi-season');
  const step1cApproachLabel = HAS_CURRENT_RESULTS
    ? formatApproachSourceDetail(approachDataCurrentSource, approachDataCurrent)
    : 'none (historical mode)';
  console.log(`Data usage (Step 1c): rounds=${step1cRoundsLabel}, events=event+similar+putting, approach=${step1cApproachLabel}, history=${formatHistorySourceDetail(historyMeta)}`);
  console.log('---');
  if (IS_PRE_TOURNAMENT_RUN && !HAS_CURRENT_RESULTS) {
    console.log('ℹ️  Pre-tournament: Step 1c uses multi-season event+similar+putting rounds and any available results across years.');
  }

  if (!HAS_CURRENT_RESULTS) {
    const currentTemplate = templateConfigs[CURRENT_EVENT_ID] || Object.values(templateConfigs)[0];
    if (!currentTemplate) {
      console.warn('⚠️  No template available for historical metric correlations.');
    } else {
      const similarCourseIds = normalizeIdList(sharedConfig.similarCourseIds);
      const puttingCourseIds = normalizeIdList(sharedConfig.puttingCourseIds);
      const similarCourseBlend = clamp01(sharedConfig.similarCoursesWeight, 0.3);
      const puttingCourseBlend = clamp01(sharedConfig.puttingCoursesWeight, 0.35);
      const eventIdSet = step1cAllowedEventIds.size > 0
        ? new Set(Array.from(step1cAllowedEventIds.values()))
        : new Set([String(CURRENT_EVENT_ID), ...similarCourseIds, ...puttingCourseIds]);
      const metricSpecsForTraining = HISTORICAL_METRIC_LABELS
        .filter(label => !APPROACH_BUCKET_LABELS.has(label))
        .map((label, index) => ({ label, index }))
        .filter(spec => !TRAINING_EXCLUDED_SET.has(spec.label));
      const metricLabelsForTraining = metricSpecsForTraining.map(spec => spec.label);
      trainingMetricNotes = {
        included: metricLabelsForTraining,
        excluded: TRAINING_EXCLUDED_LABELS.slice(),
        derived: ['Birdies or Better = birdies + eagles (from historical rounds when available)']
      };
      console.log(`Training metrics included (${trainingMetricNotes.included.length}): ${trainingMetricNotes.included.join(', ')}`);
      console.log(`Training metrics excluded: ${trainingMetricNotes.excluded.join(', ')}`);
      console.log(`Derived metrics: ${trainingMetricNotes.derived.join('; ')}`);
      const historicalEventRounds = historyData.filter(row => {
        const eventId = String(row['event_id'] || '').trim();
        if (eventId !== String(CURRENT_EVENT_ID)) return false;
        if (!step1cAllowedEventIds.has(eventId)) return false;
        return isStep1cCourseAllowed(row, step1cCourseFilterMap);
      });
      const similarCourseRoundsAll = historyData.filter(row => {
        const eventId = String(row['event_id'] || '').trim();
        if (!eventIdSet.has(eventId)) return false;
        if (!step1cAllowedEventIds.has(eventId)) return false;
        return isStep1cCourseAllowed(row, step1cCourseFilterMap);
      });
      const combinedRounds = [...historicalEventRounds, ...similarCourseRoundsAll];
      const trainingRounds = Array.from(new Map(
        combinedRounds.map(row => {
          const key = [row.dg_id || row['dg_id'], row.year || row['year'] || row.season || row['season'], row.round_num || row.round || row.round_num, row.event_id || row['event_id']]
            .map(value => String(value || '').trim())
            .join('|');
          return [key, row];
        })
      ).values());
      const trainingResults = buildResultsFromRows(trainingRounds);
      const historicalGroupWeights = removeApproachGroupWeights(currentTemplate.groupWeights);

      if (trainingRounds.length > 0 && trainingResults.length > 0) {
        const trainingFieldData = buildFieldDataFromHistory(trainingRounds, eventIdSet);
        const historicalRanking = runRanking({
          roundsRawData: trainingRounds,
          approachRawData: [],
          groupWeights: historicalGroupWeights,
          metricWeights: currentTemplate.metricWeights,
          includeCurrentEventRounds: false,
          fieldDataOverride: trainingFieldData
        });

        currentGeneratedMetricCorrelations = computeGeneratedMetricCorrelationsForLabels(
          historicalRanking.players,
          trainingResults,
          metricSpecsForTraining
        );
        currentGeneratedTop20Correlations = computeGeneratedMetricTopNCorrelationsForLabels(
          historicalRanking.players,
          trainingResults,
          metricSpecsForTraining,
          20
        );
        const trainingSamples = buildTopNSamplesFromPlayers(
          historicalRanking.players,
          trainingResults,
          metricSpecsForTraining,
          20
        );
        const logisticModel = trainLogisticFromSamples(trainingSamples);
        currentGeneratedTop20Logistic = summarizeLogisticModel(
          logisticModel,
          trainingSamples,
          metricLabelsForTraining
        );

        const eventSamples = buildHistoricalEventSamples(
          metricSpecsForTraining,
          historicalGroupWeights,
          currentTemplate.metricWeights,
          eventIdSet
        );
        if (eventSamples.length >= 3) {
          currentGeneratedTop20CvSummary = crossValidateTopNLogisticByEvent(eventSamples);
          if (currentGeneratedTop20CvSummary.success && currentGeneratedTop20CvSummary.finalModel) {
            currentGeneratedTop20Logistic = summarizeLogisticModel(
              currentGeneratedTop20CvSummary.finalModel,
              currentGeneratedTop20CvSummary.allSamples,
              metricLabelsForTraining
            );
          }
        } else {
          currentGeneratedTop20CvSummary = {
            success: false,
            message: 'Not enough events for CV',
            eventCount: eventSamples.length
          };
        }
        step1cUsedRounds = trainingRounds;
      }

      if (similarCourseIds.length > 0 && similarCourseBlend > 0) {
        const similarCourseSet = new Set(similarCourseIds);
        const similarCourseRounds = historyData.filter(row => {
          const eventId = String(row['event_id'] || '').trim();
          if (!step1cAllowedEventIds.has(eventId)) return false;
          if (!isStep1cCourseAllowed(row, step1cCourseFilterMap)) return false;
          return similarCourseSet.has(eventId);
        });
        const similarCourseResults = buildResultsFromRows(similarCourseRounds);

        if (similarCourseRounds.length > 0 && similarCourseResults.length > 0) {
          const similarFieldData = buildFieldDataFromHistory(similarCourseRounds, eventIdSet);
          const similarRanking = runRanking({
            roundsRawData: similarCourseRounds,
            approachRawData: [],
            groupWeights: historicalGroupWeights,
            metricWeights: currentTemplate.metricWeights,
            includeCurrentEventRounds: false,
            fieldDataOverride: similarFieldData
          });
          const similarMetricCorrelations = computeGeneratedMetricCorrelationsForLabels(
            similarRanking.players,
            similarCourseResults,
            metricSpecsForTraining
          );
          const similarTop20Correlations = computeGeneratedMetricTopNCorrelationsForLabels(
            similarRanking.players,
            similarCourseResults,
            metricSpecsForTraining,
            20
          );
          currentGeneratedMetricCorrelations = blendCorrelationLists(currentGeneratedMetricCorrelations, similarMetricCorrelations, similarCourseBlend);
          currentGeneratedTop20Correlations = blendCorrelationLists(currentGeneratedTop20Correlations, similarTop20Correlations, similarCourseBlend);
        }
      }

      if (puttingCourseIds.length > 0 && puttingCourseBlend > 0) {
        const puttingCourseSet = new Set(puttingCourseIds);
        const puttingCourseRounds = historyData.filter(row => {
          const eventId = String(row['event_id'] || '').trim();
          if (!step1cAllowedEventIds.has(eventId)) return false;
          if (!isStep1cCourseAllowed(row, step1cCourseFilterMap)) return false;
          return puttingCourseSet.has(eventId);
        });
        const puttingCourseResults = buildResultsFromRows(puttingCourseRounds);
        if (puttingCourseRounds.length > 0 && puttingCourseResults.length > 0) {
          const puttingFieldData = buildFieldDataFromHistory(puttingCourseRounds, eventIdSet);
          const puttingRanking = runRanking({
            roundsRawData: puttingCourseRounds,
            approachRawData: [],
            groupWeights: historicalGroupWeights,
            metricWeights: currentTemplate.metricWeights,
            includeCurrentEventRounds: false,
            fieldDataOverride: puttingFieldData
          });
          const puttingMetricCorrelations = computeGeneratedMetricCorrelationsForLabels(
            puttingRanking.players,
            puttingCourseResults,
            metricSpecsForTraining
          );
          const puttingTop20Correlations = computeGeneratedMetricTopNCorrelationsForLabels(
            puttingRanking.players,
            puttingCourseResults,
            metricSpecsForTraining,
            20
          );
          currentGeneratedMetricCorrelations = blendSingleMetricCorrelation(currentGeneratedMetricCorrelations, puttingMetricCorrelations, 'SG Putting', puttingCourseBlend);
          currentGeneratedTop20Correlations = blendSingleMetricCorrelation(currentGeneratedTop20Correlations, puttingTop20Correlations, 'SG Putting', puttingCourseBlend);
        }
      }

      if (historicalCoreTop20Correlations.length > 0) {
        currentGeneratedTop20Correlations = blendCorrelationLists(
          currentGeneratedTop20Correlations,
          historicalCoreTop20Correlations,
          HISTORICAL_CORE_TOP20_BLEND
        );
      }

      suggestedTop20MetricWeights = buildSuggestedMetricWeights(
        metricLabelsForTraining,
        currentGeneratedTop20Correlations,
        currentGeneratedTop20Logistic
      );
      suggestedTop20GroupWeights = buildSuggestedGroupWeights(
        metricConfig,
        suggestedTop20MetricWeights
      );
      currentGeneratedCorrelationMap = new Map(
        currentGeneratedMetricCorrelations.map(entry => [normalizeGeneratedMetricLabel(entry.label), entry.correlation])
      );
      const signalMap = buildAlignmentMapFromTop20Signal(currentGeneratedTop20Correlations);
      const logisticMap = buildAlignmentMapFromTop20Logistic(metricLabelsForTraining, currentGeneratedTop20Logistic);
      currentGeneratedTop20AlignmentMap = blendAlignmentMaps([signalMap, logisticMap], [0.5, 0.5]);
      console.log(`✓ Computed ${currentGeneratedMetricCorrelations.length} historical metric correlations (no current results).`);
    }
  } else if (currentSeasonRounds.length > 0 || currentSeasonRoundsAllEvents.length > 0) {
    const currentTemplate = templateConfigs[CURRENT_EVENT_ID] || Object.values(templateConfigs)[0];
    if (!currentTemplate) {
      console.warn('⚠️  No template available for current-season (event + similar + putting) metric correlations.');
    } else {
      const similarCourseIds = normalizeIdList(sharedConfig.similarCourseIds);
      const puttingCourseIds = normalizeIdList(sharedConfig.puttingCourseIds);
      const similarCourseBlend = clamp01(sharedConfig.similarCoursesWeight, 0.3);
      const puttingCourseBlend = clamp01(sharedConfig.puttingCoursesWeight, 0.35);
      const fieldIdSet = field2026DgIds;
      const eventIdSetForMetrics = new Set([
        String(CURRENT_EVENT_ID),
        ...similarCourseIds.map(String),
        ...puttingCourseIds.map(String)
      ]);
      const eventIdListForMetrics = Array.from(eventIdSetForMetrics.values());
      const includeApproachBuckets = approachDataCurrent.length > 0;
      TOP20_METRIC_LABELS = (includeApproachBuckets
        ? GENERATED_METRIC_LABELS.slice()
        : GENERATED_METRIC_LABELS.filter(label => !APPROACH_BUCKET_LABELS.has(label)))
        .filter(label => !TRAINING_EXCLUDED_SET.has(label));
      const top20MetricSpecs = TOP20_METRIC_LABELS
        .map(label => ({ label, index: GENERATED_METRIC_LABELS.indexOf(label) }))
        .filter(spec => spec.index >= 0);
      trainingMetricNotes = {
        included: TOP20_METRIC_LABELS.slice(),
        excluded: TRAINING_EXCLUDED_LABELS.slice(),
        derived: ['Birdies or Better = birdies + eagles (from historical rounds when available)']
      };
      console.log(`ℹ️  Current-season metric scope: season=${effectiveSeason}, events=[${eventIdListForMetrics.join(', ')}] (event + similar + putting).`);
      console.log(`   Similar events: ${similarCourseIds.length ? similarCourseIds.join(', ') : 'none'}`);
      console.log(`   Putting events: ${puttingCourseIds.length ? puttingCourseIds.join(', ') : 'none'}`);

      const roundsForMetrics = historyData.filter(row => {
        const eventId = String(row['event_id'] || '').trim();
        if (!eventIdSetForMetrics.has(eventId)) return false;
        if (!step1cAllowedEventIds.has(eventId)) return false;
        return isStep1cCourseAllowed(row, step1cCourseFilterMap);
      });

      if (roundsForMetrics.length > 0) {
        console.log(`ℹ️  Using ${roundsForMetrics.length} multi-year event+similar+putting rounds (field-filtered) for metric correlations.`);
        if (currentSeasonRoundsAllEvents.length > 0) {
          console.log(`   Total current-season rounds (all players): ${currentSeasonRoundsAllEvents.length}`);
        }
      } else {
        console.warn('⚠️  No current-season rounds found for event + similar + putting courses; skipping Step 1c correlations.');
      }
      if (roundsForMetrics.length > 0) {
        const metricsFieldData = buildFieldDataFromHistory(roundsForMetrics, null);
        const currentRankingForMetrics = runRanking({
          roundsRawData: roundsForMetrics,
          approachRawData: approachDataCurrent,
          groupWeights: currentTemplate.groupWeights,
          metricWeights: currentTemplate.metricWeights,
          includeCurrentEventRounds: resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonMetrics),
          fieldDataOverride: metricsFieldData
        });
        const firstMetricLength = currentRankingForMetrics.players.find(p => Array.isArray(p.metrics))?.metrics?.length || 0;
        if (firstMetricLength <= 1) {
          const metricLabel = firstMetricLength === 1 ? (GENERATED_METRIC_LABELS[0] || 'Metric 0') : 'Weighted Score';
          const singleMetric = computeSingleMetricCorrelation(currentRankingForMetrics.players, resultsCurrent, {
            label: metricLabel,
            valueGetter: player => {
              if (Array.isArray(player.metrics) && typeof player.metrics[0] === 'number') {
                return player.metrics[0];
              }
              if (typeof player.weightedScore === 'number') return player.weightedScore;
              if (typeof player.finalScore === 'number') return player.finalScore;
              return null;
            }
          });
          currentGeneratedMetricCorrelations = [{ index: 0, label: singleMetric.label, correlation: singleMetric.correlation, samples: singleMetric.samples }];
          currentGeneratedTop20Correlations = [{ index: 0, label: singleMetric.label, correlation: singleMetric.correlation, samples: singleMetric.samples }];
        } else {
          currentGeneratedMetricCorrelations = computeGeneratedMetricCorrelationsForLabels(
            currentRankingForMetrics.players,
            resultsCurrent,
            top20MetricSpecs
          );
          currentGeneratedTop20Correlations = computeGeneratedMetricTopNCorrelationsForLabels(
            currentRankingForMetrics.players,
            resultsCurrent,
            top20MetricSpecs,
            20
          );
          currentGeneratedTop20Logistic = trainTopNLogisticModel(
            currentRankingForMetrics.players,
            resultsCurrent,
            TOP20_METRIC_LABELS,
            { topN: 20 }
          );
        }

        const seasonEventSamples = buildEventSamplesBySeason(CURRENT_SEASON);
        let eventSamples = seasonEventSamples;
        let cvNote = null;
        if (seasonEventSamples.length < 3) {
          eventSamples = buildEventSamplesBySeason(null);
          if (eventSamples.length >= 3) {
            cvNote = `Insufficient events for season ${CURRENT_SEASON}; used all seasons.`;
          }
        }

        if (eventSamples.length >= 3) {
          currentGeneratedTop20CvSummary = crossValidateTopNLogisticByEvent(eventSamples);
          if (cvNote) currentGeneratedTop20CvSummary.note = cvNote;
          if (currentGeneratedTop20CvSummary.success && currentGeneratedTop20CvSummary.finalModel) {
            currentGeneratedTop20Logistic = summarizeLogisticModel(
              currentGeneratedTop20CvSummary.finalModel,
              currentGeneratedTop20CvSummary.allSamples,
              GENERATED_METRIC_LABELS
            );
          }
        } else {
          currentGeneratedTop20CvSummary = {
            success: false,
            message: 'Not enough events for CV',
            eventCount: eventSamples.length
          };
        }
        step1cUsedRounds = roundsForMetrics;
      }

      if (similarCourseIds.length > 0 && similarCourseBlend > 0) {
        const similarCourseSet = new Set(similarCourseIds);
        const similarCourseRounds = historyData.filter(row => {
          const eventId = String(row['event_id'] || '').trim();
          if (!step1cAllowedEventIds.has(eventId)) return false;
          if (!isStep1cCourseAllowed(row, step1cCourseFilterMap)) return false;
          return similarCourseSet.has(eventId);
        });
        const similarCourseResults = buildResultsFromRows(similarCourseRounds);

        if (similarCourseRounds.length > 0 && similarCourseResults.length > 0) {
          const similarFieldData = buildFieldDataFromHistory(similarCourseRounds, null);
          const similarRanking = runRanking({
            roundsRawData: similarCourseRounds,
            approachRawData: approachDataCurrent,
            groupWeights: currentTemplate.groupWeights,
            metricWeights: currentTemplate.metricWeights,
            includeCurrentEventRounds: resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonMetrics),
            fieldDataOverride: similarFieldData
          });
          const similarMetricCorrelations = computeGeneratedMetricCorrelations(similarRanking.players, similarCourseResults);
          const similarTop20Correlations = computeGeneratedMetricTopNCorrelationsForLabels(
            similarRanking.players,
            similarCourseResults,
            top20MetricSpecs,
            20
          );
          currentGeneratedMetricCorrelations = blendCorrelationLists(currentGeneratedMetricCorrelations, similarMetricCorrelations, similarCourseBlend);
          currentGeneratedTop20Correlations = blendCorrelationLists(currentGeneratedTop20Correlations, similarTop20Correlations, similarCourseBlend);
        }
      }

      if (puttingCourseIds.length > 0 && puttingCourseBlend > 0) {
        const puttingCourseSet = new Set(puttingCourseIds);
        const puttingCourseRounds = historyData.filter(row => {
          const eventId = String(row['event_id'] || '').trim();
          if (!step1cAllowedEventIds.has(eventId)) return false;
          if (!isStep1cCourseAllowed(row, step1cCourseFilterMap)) return false;
          return puttingCourseSet.has(eventId);
        });
        const puttingCourseResults = buildResultsFromRows(puttingCourseRounds);
        if (puttingCourseRounds.length > 0 && puttingCourseResults.length > 0) {
          const puttingFieldData = buildFieldDataFromHistory(puttingCourseRounds, null);
          const puttingRanking = runRanking({
            roundsRawData: puttingCourseRounds,
            approachRawData: approachDataCurrent,
            groupWeights: currentTemplate.groupWeights,
            metricWeights: currentTemplate.metricWeights,
            includeCurrentEventRounds: resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonMetrics),
            fieldDataOverride: puttingFieldData
          });
          const puttingMetricCorrelations = computeGeneratedMetricCorrelations(puttingRanking.players, puttingCourseResults);
          const puttingTop20Correlations = computeGeneratedMetricTopNCorrelationsForLabels(
            puttingRanking.players,
            puttingCourseResults,
            top20MetricSpecs,
            20
          );
          currentGeneratedMetricCorrelations = blendSingleMetricCorrelation(currentGeneratedMetricCorrelations, puttingMetricCorrelations, 'SG Putting', puttingCourseBlend);
          currentGeneratedTop20Correlations = blendSingleMetricCorrelation(currentGeneratedTop20Correlations, puttingTop20Correlations, 'SG Putting', puttingCourseBlend);
        }
      }

      if (historicalCoreTop20Correlations.length > 0) {
        currentGeneratedTop20Correlations = blendCorrelationLists(
          currentGeneratedTop20Correlations,
          historicalCoreTop20Correlations,
          HISTORICAL_CORE_TOP20_BLEND
        );
      }
      suggestedTop20MetricWeights = buildSuggestedMetricWeights(
        TOP20_METRIC_LABELS,
        currentGeneratedTop20Correlations,
        currentGeneratedTop20Logistic
      );
      suggestedTop20GroupWeights = buildSuggestedGroupWeights(
        metricConfig,
        suggestedTop20MetricWeights
      );
      currentGeneratedCorrelationMap = new Map(
        currentGeneratedMetricCorrelations.map(entry => [normalizeGeneratedMetricLabel(entry.label), entry.correlation])
      );
      const signalMap = buildAlignmentMapFromTop20Signal(currentGeneratedTop20Correlations);
      const logisticMap = buildAlignmentMapFromTop20Logistic(TOP20_METRIC_LABELS, currentGeneratedTop20Logistic);
      currentGeneratedTop20AlignmentMap = blendAlignmentMaps([signalMap, logisticMap], [0.5, 0.5]);
      if (IS_POST_TOURNAMENT_RUN && currentTemplate) {
        const top20BlendOutputDir = resolveValidationSubdir({
          validationRoot: validationOutputsDir,
          kind: 'TOP20_BLEND'
        }) || validationOutputsDir;
        if (top20BlendOutputDir) {
          ensureDirectory(top20BlendOutputDir);
          try {
            const top20BlendPayload = blendTemplateWeights({
              metricConfig,
              baselineGroupWeights: currentTemplate.groupWeights || {},
              baselineMetricWeights: currentTemplate.metricWeights || {},
              top20Correlations: currentGeneratedTop20Correlations,
              top20Logistic: currentGeneratedTop20Logistic,
              metricLabels: TOP20_METRIC_LABELS
            });
            const blendMeta = {
              createdAt: formatTimestamp(new Date()),
              eventId: CURRENT_EVENT_ID || null,
              season: CURRENT_SEASON || null,
              mode: 'post_event',
              templateKey: currentTemplate === templateConfigs[CURRENT_EVENT_ID] ? String(CURRENT_EVENT_ID) : (templateConfigs[CURRENT_EVENT_ID] ? String(CURRENT_EVENT_ID) : 'fallback')
            };
            const blendSlug = normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback)
              || `event-${CURRENT_EVENT_ID || 'unknown'}`;
            const outputBaseName = buildOutputBaseName({
              tournamentSlug: blendSlug,
              tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
              eventId: CURRENT_EVENT_ID
            });
            const outputPath = buildArtifactPath({
              artifactType: OUTPUT_ARTIFACTS.TOP20_TEMPLATE_BLEND_JSON,
              outputBaseName,
              tournamentSlug: blendSlug,
              tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
              validationSubdirs: { top20Blend: top20BlendOutputDir },
              validationRoot: validationOutputsDir
            });
            if (outputPath) {
              writeJsonFile(outputPath, { ...top20BlendPayload, meta: blendMeta });
              console.log(`✓ Wrote top20 template blend output: ${outputPath}`);
            }
          } catch (error) {
            console.warn(`ℹ️  Unable to write top20 template blend output: ${error.message}`);
          }
        }
      }
      console.log(`✓ Computed ${currentGeneratedMetricCorrelations.length} metric correlations for ${CURRENT_SEASON} (event + similar + putting)`);
    }
  } else {
    console.warn(`⚠️  No ${CURRENT_SEASON} rounds found (event + similar + putting); skipping Step 1c correlations.`);
  }

  if (currentGeneratedTop20Correlations.length > 0 || (currentGeneratedTop20Logistic && currentGeneratedTop20Logistic.success)) {
    const top20SignalMap = buildTop20SignalMap(
      currentGeneratedTop20Correlations,
      currentGeneratedTop20Logistic,
      TOP20_METRIC_LABELS
    );
    const alignmentScores = computeTemplateAlignmentScores(metricConfig, templateConfigs, top20SignalMap);
    const recommended = Object.entries(alignmentScores)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
    if (recommended) {
      const scoreDetails = Object.entries(alignmentScores)
        .map(([type, score]) => `${type}=${score.toFixed(4)}`)
        .join(', ');
      console.log(`ℹ️  Course type alignment recommendation (informational only): ${recommended[0]} (${scoreDetails})`);
    }
  }

  const fallbackTemplateForCv = templateConfigs[CURRENT_EVENT_ID] || Object.values(templateConfigs)[0];
  cvReliability = computeCvReliability(currentGeneratedTop20CvSummary);
  conservativeSuggestedTop20GroupWeights = blendSuggestedGroupWeightsWithCv(
    suggestedTop20GroupWeights,
    fallbackTemplateForCv?.groupWeights || {},
    cvReliability,
    { maxModelShare: 0.35 }
  );

  if (!HAS_CURRENT_RESULTS) {
    const fallbackTemplate = templateConfigs[CURRENT_EVENT_ID] || Object.values(templateConfigs)[0];
    const priorTemplate = templateConfigs.TECHNICAL || fallbackTemplate;
    const fallbackGroupWeights = fallbackTemplate?.groupWeights || {};
    const fallbackMetricWeights = fallbackTemplate?.metricWeights || {};
    const priorGroupWeights = priorTemplate?.groupWeights || fallbackGroupWeights;
    const priorMetricWeights = priorTemplate?.metricWeights || fallbackMetricWeights;
    const priorShare = 0.6;
    const modelShare = 0.4;

    const filledGroupWeights = buildFilledGroupWeights(suggestedTop20GroupWeights, fallbackGroupWeights);
    const filledMetricWeights = buildMetricWeightsFromSuggested(
      metricConfig,
      suggestedTop20MetricWeights,
      fallbackMetricWeights
    );
    const blendedGroupWeights = blendGroupWeights(priorGroupWeights, filledGroupWeights, priorShare, modelShare);
    const blendedMetricWeights = blendMetricWeights(metricConfig, priorMetricWeights, filledMetricWeights, priorShare, modelShare);
    const invertedLabelSet = buildInvertedLabelSet(currentGeneratedTop20Correlations);
    const filledMetricWeightsWithInversions = applyInversionsToMetricWeights(
      metricConfig,
      filledMetricWeights,
      invertedLabelSet
    );
    const blendedMetricWeightsWithInversions = applyInversionsToMetricWeights(
      metricConfig,
      blendedMetricWeights,
      invertedLabelSet
    );
    const adjustedMetricWeights = applyShotDistributionToMetricWeights(
      blendedMetricWeightsWithInversions,
      sharedConfig.courseSetupWeights
    );

    const preEventMetricWeightsForGroups = applyShotDistributionToMetricWeights(
      adjustedMetricWeights,
      sharedConfig.courseSetupWeights
    );
    const preEventGroups = buildModifiedGroups(
      metricConfig.groups,
      blendedGroupWeights,
      preEventMetricWeightsForGroups
    );
    const preEventRanking = runRanking({
      roundsRawData: historyData,
      approachRawData: approachDataCurrent,
      groupWeights: blendedGroupWeights,
      metricWeights: adjustedMetricWeights,
      includeCurrentEventRounds: resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonBaseline)
    });
    const preEventRankingPlayers = formatRankingPlayers(
      preEventRanking.players,
      preEventGroups,
      preEventRanking.groupStats
    );

    const lowDataAlert = buildLowDataAlert(preEventRanking.players, {
      coverageThreshold: getEnvNumberValue('MODEL_LOW_DATA_COVERAGE_THRESH', 0.75),
      topN: Math.max(5, Math.floor(getEnvNumberValue('MODEL_LOW_DATA_TOP_N', 20))),
      alertCount: Math.max(1, Math.floor(getEnvNumberValue('MODEL_LOW_DATA_ALERT_COUNT', 5)))
    });


    if (approachDeltaAlignmentMap.size > 0 && approachDeltaRows.length > 0) {
      const trendScores = buildApproachDeltaPlayerScores(
        approachDeltaMetricSpecs,
        approachDeltaRows,
        approachDeltaAlignmentMap
      );
      const predictiveAlignmentMap = buildApproachAlignmentMapFromMetricWeights(
        metricConfig,
        adjustedMetricWeights,
        approachDeltaMetricSpecs
      );
      const predictiveScores = buildApproachDeltaPlayerScores(
        approachDeltaMetricSpecs,
        approachDeltaRows,
        predictiveAlignmentMap
      );

      approachDeltaPlayerSummary = {
        totalPlayers: approachDeltaRows.length,
        trendWeightedAll: trendScores,
        trendWeighted: {
          topMovers: trendScores.slice(0, 10),
          bottomMovers: trendScores.slice(-10).reverse()
        },
        predictiveWeightedAll: predictiveScores,
        predictiveWeighted: {
          topMovers: predictiveScores.slice(0, 10),
          bottomMovers: predictiveScores.slice(-10).reverse()
        }
      };
    }

    const manifestEntries = loadSeasonManifestEntries(DATA_ROOT_DIR, CURRENT_SEASON);
    const manifestMatch = resolveManifestEntryForEvent(manifestEntries, {
      eventId: CURRENT_EVENT_ID,
      tournamentSlug: normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback
    });
    const manifestSlug = manifestMatch?.tournamentSlug
      ? normalizeTournamentSlug(manifestMatch.tournamentSlug)
      : null;
    const outputTagRaw = String(process.env.OUTPUT_TAG || '').trim();
    const outputBaseName = buildOutputBaseName({
      tournamentSlug: manifestSlug || canonicalTournamentSlug || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
      eventId: CURRENT_EVENT_ID,
      outputTag: outputTagRaw || null
    });
    summaryOutputBaseName = outputBaseName;
    summaryTournamentSlug = manifestSlug || canonicalTournamentSlug || null;
    const preEventModeRoot = preEventOutputDir || OUTPUT_DIR;

    const signalContributionReport = buildSignalContributionReport(
      preEventRanking.players,
      preEventGroups,
      { limit: Math.max(10, Math.floor(getEnvNumberValue('MODEL_SIGNAL_REPORT_PLAYERS', 50))) }
    );

    signalReportPath = signalContributionReport
      ? buildArtifactPath({
        artifactType: OUTPUT_ARTIFACTS.PRE_EVENT_SIGNAL_CONTRIBUTIONS_JSON,
        outputBaseName,
        tournamentSlug: manifestSlug || canonicalTournamentSlug,
        tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
        modeRoot: preEventModeRoot
      })
      : null;
    if (signalContributionReport && signalReportPath) {
      fs.writeFileSync(signalReportPath, JSON.stringify(signalContributionReport, null, 2));
    }

    preEventRankingPath = buildArtifactPath({
      artifactType: OUTPUT_ARTIFACTS.PRE_EVENT_RANKINGS_JSON,
      outputBaseName,
      tournamentSlug: manifestSlug || canonicalTournamentSlug,
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
      modeRoot: preEventModeRoot
    });
    preEventRankingCsvPath = buildArtifactPath({
      artifactType: OUTPUT_ARTIFACTS.PRE_EVENT_RANKINGS_CSV,
      outputBaseName,
      tournamentSlug: manifestSlug || canonicalTournamentSlug,
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
      modeRoot: preEventModeRoot
    });
    fs.writeFileSync(preEventRankingPath, JSON.stringify({
      timestamp: formatTimestamp(new Date()),
      eventId: CURRENT_EVENT_ID,
      season: CURRENT_SEASON,
      tournament: TOURNAMENT_NAME || 'Event',
      weights: {
        groupWeights: blendedGroupWeights,
        metricWeights: adjustedMetricWeights
      },
      players: preEventRankingPlayers
    }, null, 2));

    const rankingCsvContent = buildSheetLikeRankingCsv(preEventRanking, preEventGroups);
    fs.writeFileSync(preEventRankingCsvPath, rankingCsvContent);

    const output = {
      timestamp: formatTimestamp(new Date()),
      mode: 'pre_event_training',
      eventId: CURRENT_EVENT_ID,
      season: CURRENT_SEASON,
      tournament: TOURNAMENT_NAME || 'Event',
      dryRun: DRY_RUN,
      preEventRanking: {
        path: preEventRankingPath,
        csvPath: preEventRankingCsvPath,
        totalPlayers: preEventRankingPlayers.length,
        top25: preEventRankingPlayers.slice(0, 25),
        players: preEventRankingPlayers
      },
      lowDataAlert,
      signalContributionReport: signalReportPath,
      fieldIntegrity: fieldIntegritySummary,
      pastPerformanceWeighting: pastPerformanceWeightSummary,
      courseContextUpdates: courseContextUpdateSummary,
      apiSnapshots: {
        dataGolfRankings: {
          source: rankingsSnapshot?.source || 'unknown',
          path: rankingsSnapshot?.path || null,
          lastUpdated: rankingsSnapshot?.payload?.last_updated || null,
          count: Array.isArray(rankingsSnapshot?.payload?.rankings)
            ? rankingsSnapshot.payload.rankings.length
            : null
        },
        dataGolfApproachSkill: {
          source: approachSkillSnapshot?.source || 'unknown',
          path: approachSkillSnapshot?.path || null,
          lastUpdated: approachSkillSnapshot?.payload?.last_updated || null,
          timePeriod: approachSkillSnapshot?.payload?.time_period || DATAGOLF_APPROACH_PERIOD || null,
          count: Array.isArray(approachSkillSnapshot?.payload?.data)
            ? approachSkillSnapshot.payload.data.length
            : null
        },
        dataGolfApproachSnapshotL24: {
          source: approachSnapshotL24?.source || 'unknown',
          path: approachSnapshotL24?.path || null,
          lastUpdated: approachSnapshotL24?.payload?.last_updated || null,
          timePeriod: approachSnapshotL24?.payload?.time_period || 'l24',
          count: Array.isArray(approachSnapshotL24?.payload?.data)
            ? approachSnapshotL24.payload.data.length
            : null
        },
        dataGolfApproachSnapshotL12: {
          source: approachSnapshotL12?.source || 'unknown',
          path: approachSnapshotL12?.path || null,
          lastUpdated: approachSnapshotL12?.payload?.last_updated || null,
          timePeriod: approachSnapshotL12?.payload?.time_period || 'l12',
          count: Array.isArray(approachSnapshotL12?.payload?.data)
            ? approachSnapshotL12.payload.data.length
            : null
        },
        dataGolfApproachSnapshotYtd: {
          source: approachSnapshotYtd?.source || 'unknown',
          path: approachSnapshotYtd?.path || null,
          archivePath: approachSnapshotYtd?.archivePath || null,
          lastUpdated: approachSnapshotYtd?.payload?.last_updated || null,
          timePeriod: approachSnapshotYtd?.payload?.time_period || 'ytd',
          count: Array.isArray(approachSnapshotYtd?.payload?.data)
            ? approachSnapshotYtd.payload.data.length
            : null
        },
        dataGolfFieldUpdates: {
          source: fieldUpdatesSnapshot?.source || 'unknown',
          path: fieldUpdatesSnapshot?.path || null,
          eventName: fieldUpdatesSnapshot?.payload?.event_name || null,
          eventId: fieldUpdatesSnapshot?.payload?.event_id || null,
          tour: fieldUpdatesSnapshot?.payload?.tour || DATAGOLF_FIELD_TOUR || null,
          fieldCount: Array.isArray(fieldUpdatesSnapshot?.payload?.field)
            ? fieldUpdatesSnapshot.payload.field.length
            : null
        },
        dataGolfPlayerDecompositions: {
          source: playerDecompositionsSnapshot?.source || 'unknown',
          path: playerDecompositionsSnapshot?.path || null,
          lastUpdated: playerDecompositionsSnapshot?.payload?.last_updated || null,
          eventName: playerDecompositionsSnapshot?.payload?.event_name || null,
          tour: DATAGOLF_DECOMP_TOUR || null,
          count: Array.isArray(playerDecompositionsSnapshot?.payload?.players)
            ? playerDecompositionsSnapshot.payload.players.length
            : null
        },
        dataGolfSkillRatingsValue: {
          source: skillRatingsValueSnapshot?.source || 'unknown',
          path: skillRatingsValueSnapshot?.path || null,
          lastUpdated: skillRatingsValueSnapshot?.payload?.last_updated || null,
          display: DATAGOLF_SKILL_DISPLAY_VALUE || null,
          count: Array.isArray(skillRatingsValueSnapshot?.payload?.players)
            ? skillRatingsValueSnapshot.payload.players.length
            : null
        },
        dataGolfSkillRatingsRank: {
          source: skillRatingsRankSnapshot?.source || 'unknown',
          path: skillRatingsRankSnapshot?.path || null,
          lastUpdated: skillRatingsRankSnapshot?.payload?.last_updated || null,
          display: DATAGOLF_SKILL_DISPLAY_RANK || null,
          count: Array.isArray(skillRatingsRankSnapshot?.payload?.players)
            ? skillRatingsRankSnapshot.payload.players.length
            : null
        },
        dataGolfHistoricalRounds: {
          source: historicalRoundsSnapshot?.source || 'unknown',
          path: historicalRoundsSnapshot?.path || null,
          tour: DATAGOLF_HISTORICAL_TOUR || null,
          eventId: DATAGOLF_HISTORICAL_EVENT_ID || null,
          year: historicalYear || null,
          count: historicalRoundsSnapshot?.payload && typeof historicalRoundsSnapshot.payload === 'object'
            ? Object.keys(historicalRoundsSnapshot.payload).length
            : null
        }
      },
      trainingSource: 'historical+similar-course',
      trainingMetrics: trainingMetricNotes,
      historicalMetricCorrelations,
      currentGeneratedMetricCorrelations,
      currentGeneratedTop20Correlations,
      currentGeneratedTop20Logistic,
      currentGeneratedTop20CvSummary,
      cvReliability,
      approachDeltaPrior: {
        label: APPROACH_DELTA_PRIOR_LABEL,
        weight: APPROACH_DELTA_PRIOR_WEIGHT,
        mode: approachDeltaPriorMode || 'unavailable',
        sourcePath: approachDeltaPriorMode === 'current_event' ? (APPROACH_DELTA_PATH || null) : null,
        filesUsed: approachDeltaPriorFiles,
        meta: approachDeltaPriorMeta || null,
        rowsTotal: approachDeltaRowsAll.length,
        rowsUsed: approachDeltaRows.length,
        correlations: approachDeltaCorrelations,
        alignmentMap: Array.from(approachDeltaAlignmentMap.entries()).map(([label, correlation]) => ({ label, correlation })),
        playerSummary: approachDeltaPlayerSummary
      },
      blendSettings: {
        similarCourseIds: normalizeIdList(sharedConfig.similarCourseIds),
        puttingCourseIds: normalizeIdList(sharedConfig.puttingCourseIds),
        similarCoursesWeight: clamp01(sharedConfig.similarCoursesWeight, 0.3),
        puttingCoursesWeight: clamp01(sharedConfig.puttingCoursesWeight, 0.35)
      },
      suggestedTop20MetricWeights,
      suggestedTop20GroupWeights,
      conservativeSuggestedTop20GroupWeights,
      filledGroupWeights,
      filledMetricWeights: filledMetricWeightsWithInversions,
      blendedGroupWeights,
      blendedMetricWeights: blendedMetricWeightsWithInversions,
      blendedMetricWeightsAdjusted: adjustedMetricWeights,
      blendSettings: {
        priorTemplate: priorTemplate === templateConfigs.TECHNICAL ? 'TECHNICAL' : (priorTemplate === fallbackTemplate ? 'FALLBACK' : 'CUSTOM'),
        priorShare,
        modelShare
      }
    };

    const outputPath = buildArtifactPath({
      artifactType: OUTPUT_ARTIFACTS.PRE_EVENT_RESULTS_JSON,
      outputBaseName,
      tournamentSlug: manifestSlug || canonicalTournamentSlug,
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
      modeRoot: preEventModeRoot
    });
    const backupJsonPath = backupIfExists(outputPath);
    if (backupJsonPath) {
      console.log(`🗄️  Backed up previous JSON results to: ${backupJsonPath}`);
    }
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    const textLines = [];
    textLines.push('='.repeat(100));
    textLines.push('MODEL OPTIMIZER - PRE-EVENT TRAINING');
    textLines.push('='.repeat(100));
    textLines.push(`DRY RUN: ${DRY_RUN ? 'ON (template files not modified)' : 'OFF (templates written)'}`);
    textLines.push('');
    textLines.push('MODE: Historical + Similar-Course Training (no current-year results)');
    textLines.push(`Event: ${CURRENT_EVENT_ID} | Tournament: ${TOURNAMENT_NAME || 'Event'}`);
    textLines.push('');
    textLines.push('PAST PERFORMANCE WEIGHTING (course history regression):');
    textLines.push(`  Enabled: ${pastPerformanceWeightSummary.enabled ? 'yes' : 'no'}`);
    textLines.push(`  Course Num: ${pastPerformanceWeightSummary.courseNum || 'n/a'}`);
    if (pastPerformanceWeightSummary.regression) {
      const slope = Number(pastPerformanceWeightSummary.regression.slope);
      const pValue = Number(pastPerformanceWeightSummary.regression.pValue);
      textLines.push(`  Regression: slope=${Number.isFinite(slope) ? slope.toFixed(4) : 'n/a'}, p=${Number.isFinite(pValue) ? pValue.toFixed(6) : 'n/a'}`);
    } else {
      textLines.push('  Regression: n/a');
    }
    const computedWeightText = typeof pastPerformanceWeightSummary.computedWeight === 'number'
      ? pastPerformanceWeightSummary.computedWeight.toFixed(2)
      : 'n/a';
    const usedWeightText = typeof pastPerformanceWeightSummary.usedWeight === 'number'
      ? pastPerformanceWeightSummary.usedWeight.toFixed(2)
      : 'n/a';
    textLines.push(`  Computed Weight: ${computedWeightText}`);
    textLines.push(`  Used Weight (config): ${usedWeightText}`);
    const regressionSourceLabel = pastPerformanceWeightSummary.source || 'n/a';
    const regressionPathLabel = pastPerformanceWeightSummary.path ? path.basename(pastPerformanceWeightSummary.path) : null;
    textLines.push(`  Regression Source: ${regressionSourceLabel}${regressionPathLabel ? ` (${regressionPathLabel})` : ''}`);
    if (courseContextUpdateSummary) {
      const updateStatus = courseContextUpdateSummary.updated ? 'yes' : 'no';
      textLines.push(`  Course Context Updates: ${updateStatus} (${courseContextUpdateSummary.updatedCount || 0} entries)`);
      if (courseContextUpdateSummary.reason) {
        textLines.push(`  Update Note: ${courseContextUpdateSummary.reason}`);
      }
    }
    textLines.push('');
    textLines.push('STEP 1: HISTORICAL METRIC CORRELATIONS');
    HISTORICAL_METRICS.forEach(metric => {
      const avg = historicalMetricCorrelations.average[metric.key];
      const corrValue = avg ? avg.correlation : 0;
      const samples = avg ? avg.samples : 0;
      textLines.push(`  ${metric.label}: Corr=${corrValue.toFixed(4)}, Samples=${samples}`);
    });
    textLines.push('');
    textLines.push('TRAINING METRIC CORRELATIONS (historical outcomes):');
    if (!currentGeneratedMetricCorrelations.length) {
      textLines.push('  No metric correlations computed.');
    } else {
      currentGeneratedMetricCorrelations.forEach(entry => {
        textLines.push(`  ${entry.index}. ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
      });
    }
    textLines.push('');
    textLines.push('TRAINING METRICS USED:');
    textLines.push(`  Included: ${trainingMetricNotes.included.join(', ')}`);
    textLines.push(`  Excluded: ${trainingMetricNotes.excluded.join(', ')}`);
    textLines.push(`  Derived: ${trainingMetricNotes.derived.join('; ')}`);
    textLines.push('');
    textLines.push(`APPROACH DELTA PRIOR (${APPROACH_DELTA_PRIOR_LABEL}):`);
    if (approachDeltaPriorMode === 'rolling_average' || approachDeltaPriorMode === 'fallback_average') {
      const modeLabel = approachDeltaPriorMode === 'rolling_average' ? 'rolling_average' : 'fallback_average';
      const maxLabel = approachDeltaPriorMode === 'rolling_average' ? `, max=${APPROACH_DELTA_ROLLING_EVENTS}` : '';
      textLines.push(`  Mode: ${modeLabel} (files=${approachDeltaPriorFiles.length}${maxLabel})`);
      textLines.push(`  Rows used: ${approachDeltaRows.length}/${approachDeltaRowsAll.length}`);
      const rollingEntries = Array.from(approachDeltaAlignmentMap.entries())
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 10);
      if (rollingEntries.length === 0) {
        textLines.push('  No rolling alignment map computed.');
      } else {
        rollingEntries.forEach(([label, value]) => {
          textLines.push(`  ${label}: Score=${value.toFixed(4)}`);
        });
      }
      if (approachDeltaPlayerSummary?.trendWeighted?.topMovers?.length) {
        textLines.push('  Player delta movers (trend-weighted, top 10):');
        approachDeltaPlayerSummary.trendWeighted.topMovers.forEach((entry, idx) => {
          const name = entry.playerName || entry.dgId || 'Unknown';
          textLines.push(`    ${idx + 1}. ${name}: Score=${entry.score.toFixed(4)}`);
        });
        textLines.push('  Player delta movers (trend-weighted, bottom 10):');
        approachDeltaPlayerSummary.trendWeighted.bottomMovers.forEach((entry, idx) => {
          const name = entry.playerName || entry.dgId || 'Unknown';
          textLines.push(`    ${idx + 1}. ${name}: Score=${entry.score.toFixed(4)}`);
        });
      }
      if (approachDeltaPlayerSummary?.predictiveWeighted?.topMovers?.length) {
        textLines.push('  Player delta movers (predictive-weighted, top 10):');
        approachDeltaPlayerSummary.predictiveWeighted.topMovers.forEach((entry, idx) => {
          const name = entry.playerName || entry.dgId || 'Unknown';
          textLines.push(`    ${idx + 1}. ${name}: Score=${entry.score.toFixed(4)}`);
        });
        textLines.push('  Player delta movers (predictive-weighted, bottom 10):');
        approachDeltaPlayerSummary.predictiveWeighted.bottomMovers.forEach((entry, idx) => {
          const name = entry.playerName || entry.dgId || 'Unknown';
          textLines.push(`    ${idx + 1}. ${name}: Score=${entry.score.toFixed(4)}`);
        });
      }
    } else if (!approachDeltaCorrelations.length) {
      textLines.push('  No approach delta correlations computed (missing results or delta file).');
    } else {
      textLines.push(`  Weight: ${APPROACH_DELTA_PRIOR_WEIGHT.toFixed(2)}`);
      textLines.push(`  Source: ${APPROACH_DELTA_PATH || 'n/a'}`);
      textLines.push(`  Rows used: ${approachDeltaRows.length}/${approachDeltaRowsAll.length}`);
      approachDeltaCorrelations.slice(0, 10).forEach(entry => {
        textLines.push(`  ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
      });
    }
    textLines.push('');
    textLines.push('TRAINING TOP-20 SIGNAL (historical outcomes):');
    if (!currentGeneratedTop20Correlations.length) {
      textLines.push('  No top-20 correlations computed.');
    } else {
      currentGeneratedTop20Correlations.forEach(entry => {
        textLines.push(`  ${entry.index}. ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
      });
    }
    textLines.push('');
    textLines.push(`SUGGESTED METRIC WEIGHTS (TOP-20) - SOURCE: ${suggestedTop20MetricWeights.source}`);
    if (!suggestedTop20MetricWeights.weights.length) {
      textLines.push('  No suggested metric weights available.');
    } else {
      suggestedTop20MetricWeights.weights.slice(0, 15).forEach((entry, idx) => {
        const corrText = typeof entry.top20Correlation === 'number' ? entry.top20Correlation.toFixed(4) : 'n/a';
        const logisticText = typeof entry.logisticWeight === 'number' ? entry.logisticWeight.toFixed(4) : 'n/a';
        textLines.push(`  ${idx + 1}. ${entry.label}: weight=${entry.weight.toFixed(4)}, top20Corr=${corrText}, logisticWeight=${logisticText}`);
      });
    }
    textLines.push('');
    textLines.push(`SUGGESTED GROUP WEIGHTS (TOP-20) - SOURCE: ${suggestedTop20GroupWeights.source}`);
    if (!suggestedTop20GroupWeights.weights.length) {
      textLines.push('  No suggested group weights available.');
    } else {
      suggestedTop20GroupWeights.weights.forEach((entry, idx) => {
        textLines.push(`  ${idx + 1}. ${entry.groupName}: weight=${entry.weight.toFixed(4)}`);
      });
    }
    textLines.push('');
    textLines.push(`CV RELIABILITY (event-based): ${(cvReliability * 100).toFixed(1)}%`);
    textLines.push(`CONSERVATIVE GROUP WEIGHTS (CV-adjusted, model share ${(conservativeSuggestedTop20GroupWeights.modelShare * 100).toFixed(1)}%):`);
    if (!conservativeSuggestedTop20GroupWeights.weights.length) {
      textLines.push('  No CV-adjusted group weights available.');
    } else {
      conservativeSuggestedTop20GroupWeights.weights.forEach((entry, idx) => {
        textLines.push(`  ${idx + 1}. ${entry.groupName}: weight=${entry.weight.toFixed(4)}`);
      });
    }
    textLines.push('');
    textLines.push('FILLED GROUP WEIGHTS (normalized with fallback template):');
    Object.entries(filledGroupWeights).forEach(([groupName, weight]) => {
      textLines.push(`  ${groupName}: ${weight.toFixed(4)}`);
    });
    textLines.push('');
    textLines.push('FILLED METRIC WEIGHTS (group-level normalization applied):');
    Object.entries(filledMetricWeightsWithInversions).forEach(([metricKey, weight]) => {
      textLines.push(`  ${metricKey}: ${weight.toFixed(4)}`);
    });
    textLines.push('');
    textLines.push(`BLENDED GROUP WEIGHTS (prior ${Math.round(priorShare * 100)}% / model ${Math.round(modelShare * 100)}%):`);
    Object.entries(blendedGroupWeights).forEach(([groupName, weight]) => {
      textLines.push(`  ${groupName}: ${weight.toFixed(4)}`);
    });
    textLines.push('');
    textLines.push('BLENDED METRIC WEIGHTS (prior/model blend, normalized per group):');
    Object.entries(blendedMetricWeightsWithInversions).forEach(([metricKey, weight]) => {
      textLines.push(`  ${metricKey}: ${weight.toFixed(4)}`);
    });
    textLines.push('');
    textLines.push('ADJUSTED METRIC WEIGHTS (course setup applied):');
    Object.entries(adjustedMetricWeights).forEach(([metricKey, weight]) => {
      textLines.push(`  ${metricKey}: ${weight.toFixed(4)}`);
    });
    textLines.push('');
    textLines.push(`PRE-EVENT RANKINGS: ${path.basename(preEventRankingPath)}`);
    textLines.push(`  CSV: ${path.basename(preEventRankingCsvPath)}`);
    textLines.push(`  Players ranked: ${preEventRankingPlayers.length}`);
    if (lowDataAlert) {
      textLines.push(`  Low-data alert: ${lowDataAlert.lowDataCount}/${lowDataAlert.topN} players under ${Math.round(lowDataAlert.coverageThreshold * 100)}% coverage`);
    }
    if (signalReportPath) {
      textLines.push(`  Signal contribution report: ${path.basename(signalReportPath)}`);
    }
    textLines.push('');
    textLines.push('PRE-EVENT RANKINGS LIST (rank | player | WAR | notes):');
    preEventRankingPlayers.forEach(player => {
      const rankValue = player.rank ?? '';
      const warValue = typeof player.war === 'number' ? player.war.toFixed(2) : 'n/a';
      const notesValue = player.notes ? player.notes : '';
      textLines.push(`${rankValue} | ${player.name || 'Unknown'} | WAR: ${warValue} | ${notesValue}`.trim());
    });
    textLines.push('');

    const textOutputPath = buildArtifactPath({
      artifactType: OUTPUT_ARTIFACTS.PRE_EVENT_RESULTS_TXT,
      outputBaseName,
      tournamentSlug: manifestSlug || canonicalTournamentSlug,
      tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
      modeRoot: preEventModeRoot
    });
    const backupTextPath = backupIfExists(textOutputPath);
    if (backupTextPath) {
      console.log(`🗄️  Backed up previous text results to: ${backupTextPath}`);
    }

    fs.writeFileSync(textOutputPath, textLines.join('\n'));

    console.log('✅ Pre-event training output saved (rankings generated).');
    console.log(`✅ JSON results saved to: ${outputPath}`);
    console.log(`✅ Text results saved to: ${textOutputPath}\n`);

    resultsJsonPath = outputPath;
    resultsTextPath = textOutputPath;
    dryRunTemplatePath = null;
    dryRunDeltaScoresPath = null;

    if (WRITE_TEMPLATES || DRY_RUN) {
      if (DRY_RUN && !WRITE_TEMPLATES) {
        console.log('🧪 Dry-run enabled: generating preview outputs without writing templates.');
      }
      const preEventTemplateName = courseTemplateKey || String(CURRENT_EVENT_ID);
      const preEventTemplate = {
        name: preEventTemplateName,
        eventId: String(CURRENT_EVENT_ID),
        description: `${TOURNAMENT_NAME || 'Event'} ${CURRENT_SEASON || ''} Pre-Event Blended`,
        groupWeights: blendedGroupWeights,
        metricWeights: nestMetricWeights(adjustedMetricWeights)
      };

      const preEventTemplateTargets = [
        path.resolve(ROOT_DIR, 'utilities', 'weightTemplates.js')
      ];

      preEventTemplateTargets.forEach(filePath => {
        const result = upsertTemplateInFile(filePath, preEventTemplate, { replaceByEventId: true, dryRun: DRY_RUN });
        if (result.updated) {
          if (DRY_RUN && result.content) {
            const dryRunPath = path.resolve(dryRunOutputDir || OUTPUT_DIR, `dryrun_${path.basename(filePath)}`);
            fs.writeFileSync(dryRunPath, result.content, 'utf8');
            console.log(`🧪 Dry-run template output saved to: ${dryRunPath}`);
            dryRunTemplatePath = dryRunPath;
          } else {
            console.log(`✅ Pre-event template written to: ${filePath}`);
          }
        } else {
          console.warn(`⚠️  Pre-event template not written (unable to update): ${filePath}`);
        }
      });

      const deltaScoresByEvent = buildDeltaPlayerScoresEntry(
        CURRENT_EVENT_ID,
        CURRENT_SEASON,
        approachDeltaPlayerSummary
      );

      if (deltaScoresByEvent) {
        const deltaScoreTargets = [
          path.resolve(ROOT_DIR, 'utilities', 'deltaPlayerScores.js')
        ];
        const outputs = writeDeltaPlayerScoresFiles(deltaScoreTargets, deltaScoresByEvent, {
          dryRun: DRY_RUN,
          outputDir: dryRunOutputDir || OUTPUT_DIR
        });
        outputs.forEach(entry => {
          const label = entry.action === 'dryRun' ? '🧪 Dry-run delta scores saved to' : '✅ Delta scores written to';
          console.log(`${label}: ${entry.target}`);
          if (entry.action === 'dryRun') {
            dryRunDeltaScoresPath = entry.target;
          }
        });
      } else {
        console.warn('⚠️  Delta player scores not written (missing player summary data).');
      }
    }

    emitCleanSummaryLog();

    if (LOGGING_HANDLE && typeof LOGGING_HANDLE.teardown === 'function') {
      LOGGING_HANDLE.teardown();
    }
    return;
  }

  let alignmentMapForOptimization = currentGeneratedTop20AlignmentMap;
  const alignmentMaps = [];
  const alignmentWeights = [];

  if (currentGeneratedTop20AlignmentMap.size > 0) {
    alignmentMaps.push(currentGeneratedTop20AlignmentMap);
  }

  if (validationAlignmentMap.size > 0) {
    alignmentMaps.push(validationAlignmentMap);
    alignmentWeights.push(VALIDATION_PRIOR_WEIGHT);
  }

  if (deltaTrendAlignmentMap.size > 0) {
    alignmentMaps.push(deltaTrendAlignmentMap);
    alignmentWeights.push(DELTA_TREND_PRIOR_WEIGHT);
    console.log(`ℹ️  Blended delta trend prior (${Math.round(DELTA_TREND_PRIOR_WEIGHT * 100)}%) into alignment map.`);
  }

  if (approachDeltaAlignmentMap.size > 0) {
    alignmentMaps.push(approachDeltaAlignmentMap);
    alignmentWeights.push(APPROACH_DELTA_PRIOR_WEIGHT);
    console.log(`ℹ️  Blended ${APPROACH_DELTA_PRIOR_LABEL} (${Math.round(APPROACH_DELTA_PRIOR_WEIGHT * 100)}%) into alignment map.`);
  }

  if (currentGeneratedTop20AlignmentMap.size > 0) {
    const totalPriors = alignmentWeights.reduce((sum, value) => sum + value, 0);
    alignmentWeights.unshift(Math.max(0, 1 - totalPriors));
  }

  if (alignmentMaps.length > 0) {
    alignmentMapForOptimization = blendAlignmentMaps(alignmentMaps, alignmentWeights);
  }

  console.log('---');
  console.log('STEP 1d: CURRENT-SEASON TEMPLATE BASELINE');
  console.log(`Compare baseline templates for current-season, current-tournament results (${CURRENT_SEASON})`);
  console.log(`Data usage (Step 1d): rounds=${currentSeasonRoundsAllEvents.length}, results=${resultsCurrent.length}, approach=${formatApproachSourceDetail(approachDataCurrentSource, approachDataCurrent)}, validationTemplates=${applyValidationOutputs ? 'enabled' : 'reporting_only'}, history=${formatHistorySourceDetail(historyMeta)}`);
  console.log('---');
  if (IS_PRE_TOURNAMENT_RUN && !HAS_CURRENT_RESULTS) {
    console.log('ℹ️  Pre-tournament: Step 1d evaluates historical years only; current-season template evaluation is skipped.');
  }

  const templateResults = [];

  for (const [templateName, config] of Object.entries(templateConfigs)) {
    console.log(`\n🔄 Testing ${templateName} for ${CURRENT_SEASON}...`);

    const perYear = {};
    availableYears.forEach(year => {
      const rounds = roundsByYear[year] || [];
      const results = resultsByYear[year] || [];
      if (rounds.length === 0 || results.length === 0) return;

      const useApproach = String(year) === String(CURRENT_SEASON);
      const adjustedGroupWeights = useApproach ? config.groupWeights : removeApproachGroupWeights(config.groupWeights);
      const ranking = runRanking({
        roundsRawData: rounds,
        approachRawData: useApproach ? approachDataCurrent : [],
        groupWeights: adjustedGroupWeights,
        metricWeights: config.metricWeights,
        includeCurrentEventRounds: resolveIncludeCurrentEventRounds(useApproach ? false : currentEventRoundsDefaults.historicalEvaluation)
      });

      perYear[year] = evaluateRankings(ranking.players, results, {
        includeTopN: useApproach,
        includeTopNDetails: useApproach
      });
    });

    const aggregate = aggregateYearlyEvaluations(perYear);
    const currentEvaluation = perYear[CURRENT_SEASON] || null;

    const correlationAlignment = computeTemplateCorrelationAlignment(config.metricWeights, historicalMetricCorrelations.average);

    templateResults.push({
      name: templateName,
      evaluation: aggregate,
      evaluationCurrent: currentEvaluation,
      yearly: perYear,
      groupWeights: config.groupWeights,
      metricWeights: config.metricWeights,
      correlationAlignment
    });

    if (currentEvaluation) {
      const top10Text = typeof currentEvaluation.top10 === 'number' ? `${currentEvaluation.top10.toFixed(1)}%` : 'n/a';
      const top20Text = typeof currentEvaluation.top20 === 'number' ? `${currentEvaluation.top20.toFixed(1)}%` : 'n/a';
      const top20WeightedText = typeof currentEvaluation.top20WeightedScore === 'number' ? `${currentEvaluation.top20WeightedScore.toFixed(1)}%` : 'n/a';
      console.log(`   Correlation: ${currentEvaluation.correlation.toFixed(4)}`);
      console.log(`   Top-10: ${top10Text}`);
      console.log(`   Top-20: ${top20Text}`);
      console.log(`   Top-20 Weighted Score: ${top20WeightedText}`);
    } else {
      console.log(`   No evaluation data for ${CURRENT_SEASON}`);
    }
  }

  const bestTemplateByEval = [...templateResults].sort((a, b) => {
    const evalA = a.evaluationCurrent;
    const evalB = b.evaluationCurrent;

    if (!evalA && !evalB) {
      const aWeighted = typeof a.evaluation?.top20WeightedScore === 'number' ? a.evaluation.top20WeightedScore : -Infinity;
      const bWeighted = typeof b.evaluation?.top20WeightedScore === 'number' ? b.evaluation.top20WeightedScore : -Infinity;
      if (bWeighted !== aWeighted) return bWeighted - aWeighted;
      const aCorr = typeof a.evaluation?.correlation === 'number' ? a.evaluation.correlation : -Infinity;
      const bCorr = typeof b.evaluation?.correlation === 'number' ? b.evaluation.correlation : -Infinity;
      if (bCorr !== aCorr) return bCorr - aCorr;
      const aTop20 = typeof a.evaluation?.top20 === 'number' ? a.evaluation.top20 : -Infinity;
      const bTop20 = typeof b.evaluation?.top20 === 'number' ? b.evaluation.top20 : -Infinity;
      return bTop20 - aTop20;
    }
    if (!evalA) return 1;
    if (!evalB) return -1;

    const aWeighted = typeof evalA.top20WeightedScore === 'number' ? evalA.top20WeightedScore : -Infinity;
    const bWeighted = typeof evalB.top20WeightedScore === 'number' ? evalB.top20WeightedScore : -Infinity;
    if (bWeighted !== aWeighted) return bWeighted - aWeighted;

    if (evalB.correlation !== evalA.correlation) {
      return evalB.correlation - evalA.correlation;
    }

    const aTop20 = typeof evalA.top20 === 'number' ? evalA.top20 : -Infinity;
    const bTop20 = typeof evalB.top20 === 'number' ? evalB.top20 : -Infinity;
    return bTop20 - aTop20;
  })[0];

  let baselineTemplate = bestTemplateByEval;
  let optimizationTemplate = bestTemplateByEval;

  const preferredTemplateName = courseContextEntryFinal?.templateKey
    ? String(courseContextEntryFinal.templateKey).trim()
    : null;

  if (!TEMPLATE && preferredTemplateName) {
    const preferredResult = templateResults.find(result => result.name === preferredTemplateName);
    if (preferredResult) {
      baselineTemplate = preferredResult;
      console.log(`ℹ️  Using course-context template: ${preferredTemplateName}`);
    } else {
      console.warn(`ℹ️  Course-context template not found in weightTemplates: ${preferredTemplateName}`);
    }
  }

  const bestTemplate = baselineTemplate || bestTemplateByEval;
  if (!bestTemplate) {
    throw new Error('No baseline template resolved for post-event optimizer run.');
  }

  const baselineEvaluation = baselineTemplate.evaluationCurrent || baselineTemplate.evaluation;
  const configTemplateResult = templateResults.find(result => result.name === String(CURRENT_EVENT_ID));
  const configBaselineEvaluation = configTemplateResult ? (configTemplateResult.evaluationCurrent || configTemplateResult.evaluation) : null;

  console.log('---');
  console.log('STEP 2: TOP-20 GROUP WEIGHT TUNING');
  console.log(`Tune lower-importance groups for Top-20 outcomes (event ${CURRENT_EVENT_ID}, all years)`);
  console.log(`Data usage (Step 2): roundsByYear=${Object.keys(roundsByYear).length} years, resultsByYear=${Object.keys(resultsByYear).length} years, approach=${formatApproachSourceDetail(approachDataCurrentSource, approachDataCurrent)}, history=${formatHistorySourceDetail(historyMeta)}`);
  console.log('---');

  const step2BaseTemplate = optimizationTemplate;
  const step2BaseTemplateName = step2BaseTemplate?.name || 'UNKNOWN';
  const step2MetricWeights = step2BaseTemplate?.metricWeights || {};

  const groupWeightsSeed = conservativeSuggestedTop20GroupWeights.weights.length > 0
    ? buildGroupWeightsMap(conservativeSuggestedTop20GroupWeights.weights)
    : step2BaseTemplate.groupWeights;
  const groupWeightsSeedNormalized = normalizeWeights(groupWeightsSeed);
  const optimizableGroups = selectOptimizableGroups(conservativeSuggestedTop20GroupWeights.weights.length > 0
    ? conservativeSuggestedTop20GroupWeights.weights
    : Object.entries(groupWeightsSeedNormalized).map(([groupName, weight]) => ({ groupName, weight })), 3);

  const GROUP_TUNE_RANGE = 0.25; // ±25% adjustments
  const GROUP_TUNE_TESTS = 400;

  const tunedResults = [];
  for (let i = 0; i < GROUP_TUNE_TESTS; i++) {
    const candidate = { ...groupWeightsSeedNormalized };
    optimizableGroups.forEach(groupName => {
      const base = candidate[groupName] || 0.0001;
      const adjustment = (rand() * 2 - 1) * GROUP_TUNE_RANGE;
      candidate[groupName] = Math.max(0.0001, base * (1 + adjustment));
    });
    const normalizedCandidate = normalizeWeights(candidate);

    const perYear = {};
    availableYears.forEach(year => {
      const rounds = roundsByYear[year] || [];
      const results = resultsByYear[year] || [];
      if (rounds.length === 0 || results.length === 0) return;
      const useApproach = String(year) === String(CURRENT_SEASON);
      const adjustedGroupWeights = useApproach
        ? normalizedCandidate
        : removeApproachGroupWeights(normalizedCandidate);
      const ranking = runRanking({
        roundsRawData: rounds,
        approachRawData: useApproach ? approachDataCurrent : [],
        groupWeights: adjustedGroupWeights,
        metricWeights: step2MetricWeights,
        includeCurrentEventRounds: resolveIncludeCurrentEventRounds(
          useApproach ? currentEventRoundsDefaults.currentSeasonOptimization : currentEventRoundsDefaults.historicalEvaluation
        )
      });
      perYear[year] = evaluateRankings(ranking.players, results, { includeTopN: true });
    });
    const evaluation = aggregateYearlyEvaluations(perYear);
    tunedResults.push({
      groupWeights: normalizedCandidate,
      evaluation
    });
  }

  tunedResults.sort((a, b) => {
    const top20A = typeof a.evaluation.top20 === 'number' ? a.evaluation.top20 : -Infinity;
    const top20B = typeof b.evaluation.top20 === 'number' ? b.evaluation.top20 : -Infinity;
    if (top20B !== top20A) return top20B - top20A;
    if (a.evaluation.rmse !== b.evaluation.rmse) return a.evaluation.rmse - b.evaluation.rmse;
    return b.evaluation.correlation - a.evaluation.correlation;
  });

  tunedTop20GroupWeights = tunedResults[0] || null;

  if (tunedTop20GroupWeights) {
    const bestEval = tunedTop20GroupWeights.evaluation;
    const top10Text = typeof bestEval.top10 === 'number' ? `${bestEval.top10.toFixed(1)}%` : 'n/a';
    const top20Text = typeof bestEval.top20 === 'number' ? `${bestEval.top20.toFixed(1)}%` : 'n/a';
    const rmseText = typeof bestEval.rmse === 'number' ? bestEval.rmse.toFixed(2) : 'n/a';
    console.log(`✓ Top-20 tuning best: Top-10=${top10Text}, Top-20=${top20Text}, RMSE=${rmseText}, Corr=${bestEval.correlation.toFixed(4)}`);
  }

  console.log('---');
  console.log('BEST BASELINE TEMPLATE (CURRENT YEAR)');
  console.log('---');

  const baselineTop10Current = typeof baselineEvaluation.top10 === 'number' ? `${baselineEvaluation.top10.toFixed(1)}%` : 'n/a';
  const baselineTop20 = typeof baselineEvaluation.top20 === 'number' ? `${baselineEvaluation.top20.toFixed(1)}%` : 'n/a';
  const baselineTop20Weighted = typeof baselineEvaluation.top20WeightedScore === 'number' ? `${baselineEvaluation.top20WeightedScore.toFixed(1)}%` : 'n/a';

  console.log(`\n✅ Baseline Template (rankings): ${baselineTemplate.name}`);
  console.log(`   Correlation: ${baselineEvaluation.correlation.toFixed(4)}`);
  console.log(`   Top-10: ${baselineTop10Current}`);
  console.log(`   Top-20: ${baselineTop20}`);
  console.log(`   Top-20 Weighted Score: ${baselineTop20Weighted}\n`);
  if (optimizationTemplate?.name && optimizationTemplate.name !== baselineTemplate.name) {
    console.log(`✅ Optimization seed template: ${optimizationTemplate.name}`);
  }

  // ============================================================================
  // STEP 3: WEIGHT OPTIMIZATION (with 2026 approach metrics)
  // ============================================================================
  console.log('---');
  console.log('STEP 3: WEIGHT OPTIMIZATION');
  console.log('Randomized search starting from best template baseline');
  console.log('Using current season results for optimization (current-year field only)');
  console.log(`Data usage (Step 3): rounds=${getCurrentSeasonRoundsForRanking(resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonOptimization)).length}, results=${resultsCurrent.length}, approach=${formatApproachSourceDetail(approachDataCurrentSource, approachDataCurrent)}, history=${formatHistorySourceDetail(historyMeta)}`);
  console.log('---');

  // Random search from best template
  console.log(`🔄 Grid search optimization from ${optimizationTemplate.name} baseline...`);
  console.log(`   Starting correlation: ${baselineEvaluation.correlation.toFixed(4)}`);

  const GROUP_GRID_RANGE = 0.20;
  const METRIC_GRID_RANGE = 0.15;
  const parsedEnvTests = parseInt(OPT_TESTS_RAW, 10);
  const MAX_TESTS = MAX_TESTS_OVERRIDE
    ?? (Number.isNaN(parsedEnvTests) ? 1500 : parsedEnvTests);
  const optimizedResults = [];
  const defaultObjectiveWeights = {
    correlation: 0.3,
    top20: 0.5,
    alignment: 0.2
  };
  const WEIGHT_OBJECTIVE = resolveObjectiveWeights(defaultObjectiveWeights, {
    correlation: OPT_OBJECTIVE_CORR,
    top20: OPT_OBJECTIVE_TOP20,
    alignment: OPT_OBJECTIVE_ALIGN
  });
  optimizationObjectiveWeights = WEIGHT_OBJECTIVE;
  const objectiveOverrideApplied = [OPT_OBJECTIVE_CORR, OPT_OBJECTIVE_TOP20, OPT_OBJECTIVE_ALIGN]
    .some(value => typeof value === 'number' && Number.isFinite(value));
  if (objectiveOverrideApplied) {
    console.log(`ℹ️  Objective weights override: corr=${WEIGHT_OBJECTIVE.correlation.toFixed(2)}, top20=${WEIGHT_OBJECTIVE.top20.toFixed(2)}, align=${WEIGHT_OBJECTIVE.alignment.toFixed(2)}`);
  }
  const approachCapEnabled = typeof APPROACH_GROUP_CAP === 'number' && APPROACH_GROUP_CAP > 0 && APPROACH_GROUP_CAP < 1;
  let loggedApproachCap = false;

  const aggregateLoeoEvaluations = folds => {
    if (!Array.isArray(folds) || folds.length === 0) return null;
    const totals = folds.reduce((acc, evaluation) => {
      const weight = evaluation?.matchedPlayers || 0;
      acc.matchedPlayers += weight;
      acc.correlation += (evaluation?.correlation || 0) * weight;
      acc.rmse += (evaluation?.rmse || 0) * weight;
      acc.rSquared += (evaluation?.rSquared || 0) * weight;
      acc.meanError += (evaluation?.meanError || 0) * weight;
      acc.stdDevError += (evaluation?.stdDevError || 0) * weight;
      acc.mae += (evaluation?.mae || 0) * weight;
      if (typeof evaluation?.top10 === 'number') {
        acc.top10 += evaluation.top10 * weight;
      }
      if (typeof evaluation?.top20 === 'number') {
        acc.top20 += evaluation.top20 * weight;
        acc.top20WeightedScore += (evaluation?.top20WeightedScore || 0) * weight;
      }
      return acc;
    }, {
      correlation: 0,
      rmse: 0,
      rSquared: 0,
      meanError: 0,
      stdDevError: 0,
      mae: 0,
      top10: 0,
      top20: 0,
      top20WeightedScore: 0,
      matchedPlayers: 0
    });

    if (totals.matchedPlayers === 0) return null;
    return {
      correlation: totals.correlation / totals.matchedPlayers,
      rmse: totals.rmse / totals.matchedPlayers,
      rSquared: totals.rSquared / totals.matchedPlayers,
      meanError: totals.meanError / totals.matchedPlayers,
      stdDevError: totals.stdDevError / totals.matchedPlayers,
      mae: totals.mae / totals.matchedPlayers,
      top10: totals.top10 > 0 ? totals.top10 / totals.matchedPlayers : null,
      top20: totals.top20 > 0 ? totals.top20 / totals.matchedPlayers : null,
      top20WeightedScore: totals.top20WeightedScore > 0 ? totals.top20WeightedScore / totals.matchedPlayers : null,
      matchedPlayers: totals.matchedPlayers
    };
  };

  const runCurrentSeasonLoeo = ({ groupWeights, metricWeights }) => {
    const yearRows = historyData.filter(row => {
      const rowYear = parseInt(String(row?.year || row?.season || '').trim(), 10);
      return !Number.isNaN(rowYear) && rowYear === effectiveSeason;
    });
    if (!yearRows.length) return null;

    const events = new Map();
    yearRows.forEach(row => {
      const eventId = String(row?.event_id || '').trim();
      if (!eventId) return;
      if (!events.has(eventId)) events.set(eventId, []);
      events.get(eventId).push(row);
    });

    const eventEntries = Array.from(events.entries());
    if (eventEntries.length < 3) return null;

    const fieldDataOverride = buildFieldDataFromHistory(yearRows, null);
    const useApproach = approachDataCurrent.length > 0;
    const adjustedGroupWeights = useApproach
      ? groupWeights
      : removeApproachGroupWeights(groupWeights);

    const foldEvaluations = [];
    eventEntries.forEach(([eventId, eventRows]) => {
      const testRows = eventRows || [];
      const trainingRows = yearRows.filter(row => String(row?.event_id || '').trim() !== String(eventId).trim());
      if (trainingRows.length < 30 || testRows.length < 10) return;
      const ranking = runRanking({
        roundsRawData: trainingRows,
        approachRawData: useApproach ? approachDataCurrent : [],
        groupWeights: adjustedGroupWeights,
        metricWeights,
        includeCurrentEventRounds: false,
        fieldDataOverride
      });
      const testResults = buildResultsFromRows(testRows);
      if (!testResults.length) return;
      const evaluation = evaluateRankings(ranking.players, testResults, {
        includeTopN: true,
        includeTopNDetails: false,
        includeAdjusted: true
      });
      foldEvaluations.push(evaluation);
    });

    return aggregateLoeoEvaluations(foldEvaluations);
  };
  
  for (let i = 0; i < MAX_TESTS; i++) {
    const weights = { ...optimizationTemplate.groupWeights };
    const groupNames = Object.keys(weights);
    const numAdjust = 2 + Math.floor(rand() * 2);
    for (let j = 0; j < numAdjust; j++) {
      const groupName = groupNames[Math.floor(rand() * groupNames.length)];
      const adjustment = (rand() * 2 - 1) * GROUP_GRID_RANGE;
      weights[groupName] = Math.max(0.001, weights[groupName] * (1 + adjustment));
    }

    let normalizedWeights = normalizeWeights(weights);
    if (approachCapEnabled) {
      if (!loggedApproachCap) {
        const approachTotal = Object.entries(normalizedWeights)
          .filter(([key]) => String(key).toLowerCase().startsWith('approach'))
          .reduce((sum, [, value]) => sum + (value || 0), 0);
        if (approachTotal > APPROACH_GROUP_CAP) {
          console.log(`ℹ️  Approach group cap enabled: ${APPROACH_GROUP_CAP.toFixed(2)} (pre-cap=${approachTotal.toFixed(2)})`);
          loggedApproachCap = true;
        }
      }
      normalizedWeights = applyApproachGroupCap(normalizedWeights, APPROACH_GROUP_CAP);
    }
    let adjustedMetricWeights = adjustMetricWeights(optimizationTemplate.metricWeights, metricConfig, METRIC_GRID_RANGE);
    if (validationMetricConstraints && Object.keys(validationMetricConstraints).length > 0) {
      adjustedMetricWeights = applyMetricWeightConstraints(metricConfig, adjustedMetricWeights, validationMetricConstraints);
    }

    let evaluation;
    const ranking = runRanking({
      roundsRawData: getCurrentSeasonRoundsForRanking(
        resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonOptimization)
      ),
      approachRawData: approachDataCurrent,
      groupWeights: normalizedWeights,
      metricWeights: adjustedMetricWeights,
      includeCurrentEventRounds: resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonOptimization)
    });
    evaluation = evaluateRankings(ranking.players, resultsCurrent, { includeTopN: true });

    const alignmentScore = alignmentMapForOptimization.size > 0
      ? computeMetricAlignmentScore(adjustedMetricWeights, normalizedWeights, alignmentMapForOptimization)
      : 0;
    const correlationScore = (evaluation.correlation + 1) / 2;
    const top20Score = buildTop20CompositeScore(evaluation);
    const alignmentNormalized = (alignmentScore + 1) / 2;
    const combinedScore = (
      WEIGHT_OBJECTIVE.correlation * correlationScore +
      WEIGHT_OBJECTIVE.top20 * top20Score +
      WEIGHT_OBJECTIVE.alignment * alignmentNormalized
    );

    optimizedResults.push({
      weights: normalizedWeights,
      metricWeights: adjustedMetricWeights,
      alignmentScore,
      top20Score,
      combinedScore,
      ...evaluation
    });
    
    if ((i + 1) % 100 === 0) {
      console.log(`   Tested ${i + 1}/${MAX_TESTS}...`);
    }
  }
  
  optimizedResults.sort((a, b) => {
    const scoreDiff = (b.combinedScore || 0) - (a.combinedScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return b.correlation - a.correlation;
  });
  if (OPT_LOEO_PENALTY > 0 && OPT_LOEO_TOP_N > 0) {
    const candidateCount = Math.min(OPT_LOEO_TOP_N, optimizedResults.length);
    let loeoApplied = 0;
    console.log(`ℹ️  Applying LOEO penalty to top ${candidateCount} candidates (weight=${OPT_LOEO_PENALTY.toFixed(2)}).`);
    optimizedResults.slice(0, candidateCount).forEach(candidate => {
      const loeoEvaluation = runCurrentSeasonLoeo({
        groupWeights: candidate.weights,
        metricWeights: candidate.metricWeights
      });
      const loeoScore = loeoEvaluation ? buildTop20CompositeScore(loeoEvaluation) : 0;
      if (loeoEvaluation) {
        candidate.loeoEvaluation = loeoEvaluation;
        candidate.loeoScore = loeoScore;
        candidate.combinedScore = (1 - OPT_LOEO_PENALTY) * candidate.combinedScore + OPT_LOEO_PENALTY * loeoScore;
        loeoApplied += 1;
      }
    });
    if (loeoApplied > 0) {
      optimizedResults.sort((a, b) => {
        const scoreDiff = (b.combinedScore || 0) - (a.combinedScore || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return b.correlation - a.correlation;
      });
      console.log(`ℹ️  LOEO penalty applied to ${loeoApplied} candidates; rankings updated.`);
    } else {
      console.log('ℹ️  LOEO penalty skipped (no valid LOEO evaluations).');
    }
  }

  const bestOptimized = optimizedResults[0];
  
  console.log(`\n✅ Best Optimized: ${bestOptimized.correlation.toFixed(4)}`);
  console.log(`   Metric Alignment Score (Top-20 KPI blend): ${bestOptimized.alignmentScore.toFixed(4)}`);
  console.log(`   Top-20 Composite Score: ${(bestOptimized.top20Score * 100).toFixed(1)}%`);
  console.log(`   Combined Objective Score: ${bestOptimized.combinedScore.toFixed(4)}`);
  const improvement = bestOptimized.correlation - baselineEvaluation.correlation;
  console.log(`   Improvement: ${((improvement) / Math.abs(baselineEvaluation.correlation) * 100).toFixed(2)}%`);
  const bestOptimizedTop10 = typeof bestOptimized.top10 === 'number' ? `${bestOptimized.top10.toFixed(1)}%` : 'n/a';
  const optimizedTop20Text = typeof bestOptimized.top20 === 'number' ? `${bestOptimized.top20.toFixed(1)}%` : 'n/a';
  const optimizedTop20WeightedText = typeof bestOptimized.top20WeightedScore === 'number' ? `${bestOptimized.top20WeightedScore.toFixed(1)}%` : 'n/a';
  console.log(`   Top-10: ${bestOptimizedTop10}`);
  console.log(`   Top-20: ${optimizedTop20Text}`);
  console.log(`   Top-20 Weighted Score: ${optimizedTop20WeightedText}\n`);

  const optimizedRankingCurrent = runRanking({
    roundsRawData: getCurrentSeasonRoundsForRanking(
      resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonOptimization)
    ),
    approachRawData: approachDataCurrent,
    groupWeights: bestOptimized.weights,
    metricWeights: bestOptimized.metricWeights || optimizationTemplate.metricWeights,
    includeCurrentEventRounds: resolveIncludeCurrentEventRounds(currentEventRoundsDefaults.currentSeasonOptimization)
  });

  const optimizedEvaluationCurrent = resultsCurrent.length > 0
    ? evaluateRankings(optimizedRankingCurrent.players, resultsCurrent, { includeTopN: true })
    : null;

  // ============================================================================
  // STEP 4a/4b: MULTI-YEAR VALIDATION (BASELINE + OPTIMIZED)
  // ============================================================================
  console.log('---');
  console.log('STEP 4a/4b: MULTI-YEAR VALIDATION');
  console.log('Test baseline vs optimized weights across all available years');
  console.log(`Data usage (Step 4): years=${validationYears.length}, approachPolicy=${VALIDATION_APPROACH_MODE}, snapshots=current:${approachDataCurrentSource}/last:${approachSnapshotRows.l12.length ? 'l12' : 'none'}/older:${approachSnapshotRows.l24.length ? 'l24' : 'none'}, history=${formatHistorySourceDetail(historyMeta)}`);
  console.log('---');

  const skillRatingsValidationValue = buildSkillRatingsValidation(
    optimizedRankingCurrent,
    skillRatingsValueSnapshot,
    metricConfig,
    { mode: DATAGOLF_SKILL_DISPLAY_VALUE }
  );
  const skillRatingsValidationRank = buildSkillRatingsValidation(
    optimizedRankingCurrent,
    skillRatingsRankSnapshot,
    metricConfig,
    { mode: DATAGOLF_SKILL_DISPLAY_RANK, fallbackSnapshot: skillRatingsValueSnapshot }
  );
  const playerDecompositionValidation = buildPlayerDecompositionValidation(
    optimizedRankingCurrent,
    playerDecompositionsSnapshot
  );

  if (skillRatingsValidationValue.status === 'ok') {
    console.log(`✓ Skill ratings (value) validation: avg |ρ|=${skillRatingsValidationValue.avgAbsCorrelation.toFixed(3)} across ${skillRatingsValidationValue.metrics.length} metrics (matched players: ${skillRatingsValidationValue.matchedPlayers})`);
  } else {
    console.log(`ℹ️  Skill ratings (value) validation skipped (${skillRatingsValidationValue.reason || 'unavailable'})`);
  }

  if (skillRatingsValidationRank.status === 'ok') {
    const rankNote = skillRatingsValidationRank.derivedFromValue ? ' (derived from value)' : '';
    console.log(`✓ Skill ratings (rank) validation${rankNote}: avg |ρ|=${skillRatingsValidationRank.avgAbsCorrelation.toFixed(3)} across ${skillRatingsValidationRank.metrics.length} metrics (matched players: ${skillRatingsValidationRank.matchedPlayers})`);
  } else {
    console.log(`ℹ️  Skill ratings (rank) validation skipped (${skillRatingsValidationRank.reason || 'unavailable'})`);
  }

  if (playerDecompositionValidation.status === 'ok') {
    console.log(`✓ Player decompositions validation: ρ=${playerDecompositionValidation.correlation.toFixed(3)} (matched players: ${playerDecompositionValidation.matchedPlayers})`);
  } else {
    console.log(`ℹ️  Player decompositions validation skipped (${playerDecompositionValidation.reason || 'unavailable'})`);
  }

  const runMultiYearValidation = ({ label, groupWeights, metricWeights, approachOverride = null }) => {
    console.log(`\n🔄 ${label}: building multi-year validation data...`);
    console.log(`   Approach mode: ${VALIDATION_APPROACH_MODE}`);

    const results = {};
    console.log(`\n📊 Historical rounds by year (${label}):`);

    for (const year of validationYears) {
      const rounds = roundsByYear[year] || [];
      console.log(`\n  ${year}: ${rounds.length} rounds`);

      const approachUsage = approachOverride === 'none'
        ? {
            rows: [],
            meta: {
              year,
              mode: VALIDATION_APPROACH_MODE,
              period: 'none',
              source: 'none',
              leakageFlag: 'none'
            }
          }
        : resolveApproachUsageForYear(year);
      const approachRows = approachUsage.rows;
      const useApproach = approachRows.length > 0 && approachOverride !== 'none';
      const adjustedGroupWeights = useApproach
        ? groupWeights
        : removeApproachGroupWeights(groupWeights);
      const ranking = runRanking({
        roundsRawData: rounds,
        approachRawData: useApproach ? approachRows : [],
        groupWeights: adjustedGroupWeights,
        metricWeights,
        includeCurrentEventRounds: resolveIncludeCurrentEventRounds(
          useApproach ? currentEventRoundsDefaults.currentSeasonOptimization : currentEventRoundsDefaults.historicalEvaluation
        )
      });

      const evaluationResults = resultsByYear[year] && resultsByYear[year].length > 0
        ? resultsByYear[year]
        : resultsCurrent;
      const evaluation = evaluateRankings(ranking.players, evaluationResults, {
        includeTopN: true,
        includeTopNDetails: true,
        includeAdjusted: true
      });
      results[year] = {
        ...evaluation,
        approachUsage: approachUsage.meta
      };

      const top10Text = typeof evaluation.top10 === 'number' ? `${evaluation.top10.toFixed(1)}%` : 'n/a';
      const top20Text = typeof evaluation.top20 === 'number' ? `${evaluation.top20.toFixed(1)}%` : 'n/a';
      const top20WeightedText = typeof evaluation.top20WeightedScore === 'number' ? `${evaluation.top20WeightedScore.toFixed(1)}%` : 'n/a';
      const top10OverlapText = evaluation.top10Details ? `${evaluation.top10Details.overlapCount}/10` : 'n/a';
      const top20OverlapText = evaluation.top20Details ? `${evaluation.top20Details.overlapCount}/20` : 'n/a';
      const stress = evaluateStressTest(evaluation, {
        minPlayers: 20,
        minCorr: 0.1,
        minTop20Weighted: 60
      });
      const stressText = stress.status
        ? `${stress.status.toUpperCase()}${stress.reason ? ` (${stress.reason})` : ''}`
        : 'n/a';
      const subsetEval = evaluation.adjusted?.subset || null;
      const percentileEval = evaluation.adjusted?.percentile || null;
      const subsetTop10Text = subsetEval && typeof subsetEval.top10 === 'number' ? `${subsetEval.top10.toFixed(1)}%` : 'n/a';
      const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `${subsetEval.top20.toFixed(1)}%` : 'n/a';
      const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? subsetEval.rmse.toFixed(2) : 'n/a';
      const pctTop10Text = percentileEval && typeof percentileEval.top10 === 'number' ? `${percentileEval.top10.toFixed(1)}%` : 'n/a';
      const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `${percentileEval.top20.toFixed(1)}%` : 'n/a';
      const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? percentileEval.rmse.toFixed(2) : 'n/a';
      console.log(`     Correlation: ${evaluation.correlation.toFixed(4)} | Top-10: ${top10Text} | Top-20: ${top20Text} | Top-20 Weighted: ${top20WeightedText} | Subset RMSE: ${subsetRmseText} | Subset Top-10: ${subsetTop10Text} | Subset Top-20: ${subsetTop20Text} | Pct RMSE: ${pctRmseText} | Pct Top-10: ${pctTop10Text} | Pct Top-20: ${pctTop20Text} | Stress: ${stressText} | Top-10 Overlap: ${top10OverlapText} | Top-20 Overlap: ${top20OverlapText}`);
    }

    return results;
  };

  const aggregateFoldEvaluations = folds => {
    if (!Array.isArray(folds) || folds.length === 0) return null;
    const totals = folds.reduce((acc, evaluation) => {
      const weight = evaluation?.matchedPlayers || 0;
      acc.matchedPlayers += weight;
      acc.correlation += (evaluation?.correlation || 0) * weight;
      acc.rmse += (evaluation?.rmse || 0) * weight;
      acc.rSquared += (evaluation?.rSquared || 0) * weight;
      acc.meanError += (evaluation?.meanError || 0) * weight;
      acc.stdDevError += (evaluation?.stdDevError || 0) * weight;
      acc.mae += (evaluation?.mae || 0) * weight;
      if (typeof evaluation?.top10 === 'number') {
        acc.top10 += evaluation.top10 * weight;
      }
      if (typeof evaluation?.top20 === 'number') {
        acc.top20 += evaluation.top20 * weight;
        acc.top20WeightedScore += (evaluation?.top20WeightedScore || 0) * weight;
      }
      return acc;
    }, {
      correlation: 0,
      rmse: 0,
      rSquared: 0,
      meanError: 0,
      stdDevError: 0,
      mae: 0,
      top10: 0,
      top20: 0,
      top20WeightedScore: 0,
      matchedPlayers: 0
    });

    if (totals.matchedPlayers === 0) return null;
    return {
      correlation: totals.correlation / totals.matchedPlayers,
      rmse: totals.rmse / totals.matchedPlayers,
      rSquared: totals.rSquared / totals.matchedPlayers,
      meanError: totals.meanError / totals.matchedPlayers,
      stdDevError: totals.stdDevError / totals.matchedPlayers,
      mae: totals.mae / totals.matchedPlayers,
      top10: totals.top10 > 0 ? totals.top10 / totals.matchedPlayers : null,
      top20: totals.top20 > 0 ? totals.top20 / totals.matchedPlayers : null,
      top20WeightedScore: totals.top20WeightedScore > 0 ? totals.top20WeightedScore / totals.matchedPlayers : null,
      matchedPlayers: totals.matchedPlayers
    };
  };

  const runEventKFoldValidation = ({ label, groupWeights, metricWeights }) => {
    console.log(`\n🔄 ${label}: event-based K-fold validation...`);
    const results = {};

    const rawK = parseInt(String(process.env.EVENT_KFOLD_K || '').trim(), 10);
    const kOverride = Number.isNaN(rawK) ? null : rawK;
    const defaultSeed = OPT_SEED_RAW || `${CURRENT_EVENT_ID}-${CURRENT_SEASON}`;
    const seedOverride = String(process.env.EVENT_KFOLD_SEED || defaultSeed).trim();

    validationYears.forEach(year => {
      const yearRows = historyData.filter(row => {
        const rowYear = parseInt(String(row?.year || row?.season || '').trim(), 10);
        return !Number.isNaN(rowYear) && rowYear === year;
      });

      const events = new Map();
      yearRows.forEach(row => {
        const eventId = String(row?.event_id || '').trim();
        if (!eventId) return;
        if (!events.has(eventId)) events.set(eventId, []);
        events.get(eventId).push(row);
      });

      const eventEntries = Array.from(events.entries());
      if (eventEntries.length < 3) {
        results[year] = {
          status: 'unavailable',
          reason: 'not_enough_events',
          eventCount: eventEntries.length
        };
        return;
      }

      const useLeaveOneOut = !kOverride || kOverride <= 1 || kOverride >= eventEntries.length;
      const foldMode = useLeaveOneOut ? 'leave_one_event_out' : 'k_fold';
      const foldCount = useLeaveOneOut ? eventEntries.length : kOverride;
      const rng = createSeededRng(seedOverride || `${CURRENT_EVENT_ID}-${year}`) || Math.random;
      const shuffleEntries = (entries, rngFn) => {
        const output = [...entries];
        for (let i = output.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rngFn() * (i + 1));
          [output[i], output[j]] = [output[j], output[i]];
        }
        return output;
      };

      const shuffledEntries = useLeaveOneOut
        ? eventEntries
        : shuffleEntries(eventEntries, rng);

      const folds = Array.from({ length: foldCount }, () => []);
      shuffledEntries.forEach((entry, idx) => {
        folds[idx % foldCount].push(entry);
      });

      const fieldDataOverride = buildFieldDataFromHistory(yearRows, null);
      const approachUsage = resolveApproachUsageForYear(year);
      const approachRows = approachUsage.rows;
      const useApproach = approachRows.length > 0;
      const adjustedGroupWeights = useApproach
        ? groupWeights
        : removeApproachGroupWeights(groupWeights);

      const foldEvaluations = [];
      const foldSummaries = [];
      folds.forEach((fold, foldIndex) => {
        if (!fold.length) return;
        const foldEventIds = new Set(fold.map(([eventId]) => String(eventId).trim()));
        const testRows = yearRows.filter(row => foldEventIds.has(String(row?.event_id || '').trim()));
        const trainingRows = yearRows.filter(row => !foldEventIds.has(String(row?.event_id || '').trim()));
        if (trainingRows.length < 30 || testRows.length < 10) return;

        const ranking = runRanking({
          roundsRawData: trainingRows,
          approachRawData: useApproach ? approachRows : [],
          groupWeights: adjustedGroupWeights,
          metricWeights,
          includeCurrentEventRounds: false,
          fieldDataOverride
        });

        const testResults = buildResultsFromRows(testRows);
        if (!testResults.length) return;
        const evaluation = evaluateRankings(ranking.players, testResults, {
          includeTopN: true,
          includeTopNDetails: false,
          includeAdjusted: true
        });
        foldEvaluations.push(evaluation);
        foldSummaries.push({
          fold: foldIndex + 1,
          eventCount: fold.length,
          testRows: testRows.length,
          trainingRows: trainingRows.length,
          matchedPlayers: evaluation.matchedPlayers,
          correlation: evaluation.correlation,
          rmse: evaluation.rmse,
          top10: evaluation.top10,
          top20: evaluation.top20,
          top20WeightedScore: evaluation.top20WeightedScore
        });
      });

      const aggregate = aggregateFoldEvaluations(foldEvaluations);
      results[year] = aggregate
        ? {
            status: 'ok',
            mode: foldMode,
            foldCount,
            eventCount: eventEntries.length,
            foldsUsed: foldEvaluations.length,
            evaluation: aggregate,
            folds: foldSummaries,
            approachUsage: approachUsage.meta
          }
        : {
            status: 'unavailable',
            reason: 'no_valid_folds',
            eventCount: eventEntries.length,
            approachUsage: approachUsage.meta
          };
    });

    return results;
  };

  const baselineMultiYearResults = runMultiYearValidation({
    label: 'STEP 4a BASELINE',
    groupWeights: bestTemplate.groupWeights,
    metricWeights: bestTemplate.metricWeights
  });

  const noApproachMultiYearResults = runMultiYearValidation({
    label: 'STEP 4a NO-APPROACH BASELINE',
    groupWeights: bestTemplate.groupWeights,
    metricWeights: bestTemplate.metricWeights,
    approachOverride: 'none'
  });

  const optimizedMultiYearResults = runMultiYearValidation({
    label: 'STEP 4b OPTIMIZED',
    groupWeights: bestOptimized.weights,
    metricWeights: bestOptimized.metricWeights || bestTemplate.metricWeights
  });

  const baselineEventKFold = runEventKFoldValidation({
    label: 'STEP 4a BASELINE',
    groupWeights: bestTemplate.groupWeights,
    metricWeights: bestTemplate.metricWeights
  });

  const optimizedEventKFold = runEventKFoldValidation({
    label: 'STEP 4b OPTIMIZED',
    groupWeights: bestOptimized.weights,
    metricWeights: bestOptimized.metricWeights || bestTemplate.metricWeights
  });

  // ============================================================================
  // FINAL RESULTS
  // ============================================================================
  console.log('---');
  console.log('FINAL SUMMARY');
  console.log('---');

  console.log('\nBaseline Template Analysis (Current Year):');
  console.log(`  Best Template: ${bestTemplate.name}`);
  console.log(`   Correlation: ${baselineEvaluation.correlation.toFixed(4)}`);
  console.log(`   Top-10: ${baselineTop10Current}`);
  console.log(`   Top-20: ${baselineTop20}`);
  console.log(`   Top-20 Weighted Score: ${baselineTop20Weighted}\n`);

  console.log('\nOptimized Results (2026):');
  console.log(`  Correlation: ${bestOptimized.correlation.toFixed(4)}`);
  console.log(`  Improvement: ${((bestOptimized.correlation - baselineEvaluation.correlation) / Math.abs(baselineEvaluation.correlation) * 100).toFixed(2)}%`);
  console.log(`  Top-10: ${bestOptimizedTop10}`);
  const bestOptimizedTop20 = typeof bestOptimized.top20 === 'number' ? `${bestOptimized.top20.toFixed(1)}%` : 'n/a';
  const bestOptimizedTop20Weighted = typeof bestOptimized.top20WeightedScore === 'number' ? `${bestOptimized.top20WeightedScore.toFixed(1)}%` : 'n/a';
  console.log(`  Top-20: ${bestOptimizedTop20}`);
  console.log(`  Top-20 Weighted Score: ${bestOptimizedTop20Weighted}`);

  console.log('\nMulti-Year Validation (Baseline):');
  Object.entries(baselineMultiYearResults).forEach(([year, evalResult]) => {
    const top10Text = typeof evalResult.top10 === 'number' ? `${evalResult.top10.toFixed(1)}%` : 'n/a';
    const top20Text = typeof evalResult.top20 === 'number' ? `${evalResult.top20.toFixed(1)}%` : 'n/a';
    const top20WeightedText = typeof evalResult.top20WeightedScore === 'number' ? `${evalResult.top20WeightedScore.toFixed(1)}%` : 'n/a';
    const top10OverlapText = evalResult.top10Details ? `${evalResult.top10Details.overlapCount}/10` : 'n/a';
    const top20OverlapText = evalResult.top20Details ? `${evalResult.top20Details.overlapCount}/20` : 'n/a';
    const subsetEval = evalResult.adjusted?.subset || null;
    const percentileEval = evalResult.adjusted?.percentile || null;
    const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? subsetEval.rmse.toFixed(2) : 'n/a';
    const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `${subsetEval.top20.toFixed(1)}%` : 'n/a';
    const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? percentileEval.rmse.toFixed(2) : 'n/a';
    const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `${percentileEval.top20.toFixed(1)}%` : 'n/a';
    console.log(`  ${year}: Correlation=${evalResult.correlation.toFixed(4)} | Top-10=${top10Text} | Top-20=${top20Text} | Top-20 Weighted=${top20WeightedText} | Subset RMSE=${subsetRmseText} | Subset Top-20=${subsetTop20Text} | Pct RMSE=${pctRmseText} | Pct Top-20=${pctTop20Text} | Top-10 Overlap=${top10OverlapText} | Top-20 Overlap=${top20OverlapText}`);
  });

  console.log('\nMulti-Year Validation (No-Approach Baseline):');
  Object.entries(noApproachMultiYearResults).forEach(([year, evalResult]) => {
    const top10Text = typeof evalResult.top10 === 'number' ? `${evalResult.top10.toFixed(1)}%` : 'n/a';
    const top20Text = typeof evalResult.top20 === 'number' ? `${evalResult.top20.toFixed(1)}%` : 'n/a';
    const top20WeightedText = typeof evalResult.top20WeightedScore === 'number' ? `${evalResult.top20WeightedScore.toFixed(1)}%` : 'n/a';
    const top10OverlapText = evalResult.top10Details ? `${evalResult.top10Details.overlapCount}/10` : 'n/a';
    const top20OverlapText = evalResult.top20Details ? `${evalResult.top20Details.overlapCount}/20` : 'n/a';
    const subsetEval = evalResult.adjusted?.subset || null;
    const percentileEval = evalResult.adjusted?.percentile || null;
    const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? subsetEval.rmse.toFixed(2) : 'n/a';
    const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `${subsetEval.top20.toFixed(1)}%` : 'n/a';
    const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? percentileEval.rmse.toFixed(2) : 'n/a';
    const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `${percentileEval.top20.toFixed(1)}%` : 'n/a';
    console.log(`  ${year}: Correlation=${evalResult.correlation.toFixed(4)} | Top-10=${top10Text} | Top-20=${top20Text} | Top-20 Weighted=${top20WeightedText} | Subset RMSE=${subsetRmseText} | Subset Top-20=${subsetTop20Text} | Pct RMSE=${pctRmseText} | Pct Top-20=${pctTop20Text} | Top-10 Overlap=${top10OverlapText} | Top-20 Overlap=${top20OverlapText}`);
  });

  console.log('\nMulti-Year Validation (Optimized):');
  Object.entries(optimizedMultiYearResults).forEach(([year, evalResult]) => {
    const top10Text = typeof evalResult.top10 === 'number' ? `${evalResult.top10.toFixed(1)}%` : 'n/a';
    const top20Text = typeof evalResult.top20 === 'number' ? `${evalResult.top20.toFixed(1)}%` : 'n/a';
    const top20WeightedText = typeof evalResult.top20WeightedScore === 'number' ? `${evalResult.top20WeightedScore.toFixed(1)}%` : 'n/a';
    const top10OverlapText = evalResult.top10Details ? `${evalResult.top10Details.overlapCount}/10` : 'n/a';
    const top20OverlapText = evalResult.top20Details ? `${evalResult.top20Details.overlapCount}/20` : 'n/a';
    const subsetEval = evalResult.adjusted?.subset || null;
    const percentileEval = evalResult.adjusted?.percentile || null;
    const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? subsetEval.rmse.toFixed(2) : 'n/a';
    const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `${subsetEval.top20.toFixed(1)}%` : 'n/a';
    const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? percentileEval.rmse.toFixed(2) : 'n/a';
    const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `${percentileEval.top20.toFixed(1)}%` : 'n/a';
    console.log(`  ${year}: Correlation=${evalResult.correlation.toFixed(4)} | Top-10=${top10Text} | Top-20=${top20Text} | Top-20 Weighted=${top20WeightedText} | Subset RMSE=${subsetRmseText} | Subset Top-20=${subsetTop20Text} | Pct RMSE=${pctRmseText} | Pct Top-20=${pctTop20Text} | Top-10 Overlap=${top10OverlapText} | Top-20 Overlap=${top20OverlapText}`);
  });

  console.log('\nEvent K-Fold Validation (Baseline):');
  Object.entries(baselineEventKFold).forEach(([year, result]) => {
    if (!result || result.status !== 'ok') {
      console.log(`  ${year}: unavailable (${result?.reason || 'n/a'})`);
      return;
    }
    const evaluation = result.evaluation || {};
    const top10Text = typeof evaluation.top10 === 'number' ? `${evaluation.top10.toFixed(1)}%` : 'n/a';
    const top20Text = typeof evaluation.top20 === 'number' ? `${evaluation.top20.toFixed(1)}%` : 'n/a';
    const top20WeightedText = typeof evaluation.top20WeightedScore === 'number' ? `${evaluation.top20WeightedScore.toFixed(1)}%` : 'n/a';
    console.log(`  ${year}: mode=${result.mode || 'n/a'}, folds=${result.foldsUsed}/${result.foldCount || 'n/a'}, Corr=${evaluation.correlation?.toFixed(4) || 'n/a'}, Top-10=${top10Text}, Top-20=${top20Text}, Top-20 Weighted=${top20WeightedText}`);
  });

  console.log('\nEvent K-Fold Validation (Optimized):');
  Object.entries(optimizedEventKFold).forEach(([year, result]) => {
    if (!result || result.status !== 'ok') {
      console.log(`  ${year}: unavailable (${result?.reason || 'n/a'})`);
      return;
    }
    const evaluation = result.evaluation || {};
    const top10Text = typeof evaluation.top10 === 'number' ? `${evaluation.top10.toFixed(1)}%` : 'n/a';
    const top20Text = typeof evaluation.top20 === 'number' ? `${evaluation.top20.toFixed(1)}%` : 'n/a';
    const top20WeightedText = typeof evaluation.top20WeightedScore === 'number' ? `${evaluation.top20WeightedScore.toFixed(1)}%` : 'n/a';
    console.log(`  ${year}: mode=${result.mode || 'n/a'}, folds=${result.foldsUsed}/${result.foldCount || 'n/a'}, Corr=${evaluation.correlation?.toFixed(4) || 'n/a'}, Top-10=${top10Text}, Top-20=${top20Text}, Top-20 Weighted=${top20WeightedText}`);
  });

  // Summary output
  console.log('---');
  console.log('📊 FINAL SUMMARY');
  console.log('---');

  console.log(`\n🏆 Step 1: Current-Year Baseline (${CURRENT_SEASON})`);
  console.log(`   Best Template: ${bestTemplate.name}`);
  console.log(`   Correlation: ${baselineEvaluation.correlation.toFixed(4)}`);
  console.log(`   Top-10 Accuracy: ${baselineTop10Current}`);
  console.log(`   Top-20 Accuracy: ${baselineTop20}`);
  console.log(`   Top-20 Weighted Score: ${baselineTop20Weighted}`);
  console.log(`   Matched Players: ${baselineEvaluation.matchedPlayers}`);

  console.log('\n🎯 Step 3: Weight Optimization (2026 with approach metrics)');
  console.log(`   Best Correlation: ${bestOptimized.correlation.toFixed(4)}`);
  console.log(`   Improvement: ${((bestOptimized.correlation - baselineEvaluation.correlation) / Math.abs(baselineEvaluation.correlation) * 100).toFixed(2)}%`);
  console.log(`   Top-10 Accuracy: ${bestOptimizedTop10}`);
  console.log(`   Top-20 Accuracy: ${bestOptimizedTop20}`);
  console.log(`   Top-20 Weighted Score: ${bestOptimizedTop20Weighted}`);
  console.log(`   Matched Players (current year): ${bestOptimized.matchedPlayers}`);

  console.log('\n📈 Optimized Weights:');
  Object.entries(bestOptimized.weights).forEach(([metric, weight]) => {
    console.log(`   ${metric}: ${(weight * 100).toFixed(1)}%`);
  });

  console.log('\n✓ Step 4a: Multi-Year Validation (Baseline)');
  Object.entries(baselineMultiYearResults).sort().forEach(([year, result]) => {
    const top10Text = typeof result.top10 === 'number' ? `${result.top10.toFixed(1)}%` : 'n/a';
    const top20Text = typeof result.top20 === 'number' ? `${result.top20.toFixed(1)}%` : 'n/a';
    const top20WeightedText = typeof result.top20WeightedScore === 'number' ? `${result.top20WeightedScore.toFixed(1)}%` : 'n/a';
    const top10OverlapText = result.top10Details ? `${result.top10Details.overlapCount}/10` : 'n/a';
    const top20OverlapText = result.top20Details ? `${result.top20Details.overlapCount}/20` : 'n/a';
    const subsetEval = result.adjusted?.subset || null;
    const percentileEval = result.adjusted?.percentile || null;
    const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? subsetEval.rmse.toFixed(2) : 'n/a';
    const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `${subsetEval.top20.toFixed(1)}%` : 'n/a';
    const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? percentileEval.rmse.toFixed(2) : 'n/a';
    const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `${percentileEval.top20.toFixed(1)}%` : 'n/a';
    console.log(`   ${year}: Correlation=${result.correlation.toFixed(4)}, Top-10=${top10Text}, Top-20=${top20Text}, Top-20 Weighted=${top20WeightedText}, Subset RMSE=${subsetRmseText}, Subset Top-20=${subsetTop20Text}, Pct RMSE=${pctRmseText}, Pct Top-20=${pctTop20Text}, Top-10 Overlap=${top10OverlapText}, Top-20 Overlap=${top20OverlapText}, Players=${result.matchedPlayers}`);
  });

  console.log('\n✓ Step 4b: Multi-Year Validation (Optimized)');
  Object.entries(optimizedMultiYearResults).sort().forEach(([year, result]) => {
    const top10Text = typeof result.top10 === 'number' ? `${result.top10.toFixed(1)}%` : 'n/a';
    const top20Text = typeof result.top20 === 'number' ? `${result.top20.toFixed(1)}%` : 'n/a';
    const top20WeightedText = typeof result.top20WeightedScore === 'number' ? `${result.top20WeightedScore.toFixed(1)}%` : 'n/a';
    const top10OverlapText = result.top10Details ? `${result.top10Details.overlapCount}/10` : 'n/a';
    const top20OverlapText = result.top20Details ? `${result.top20Details.overlapCount}/20` : 'n/a';
    const subsetEval = result.adjusted?.subset || null;
    const percentileEval = result.adjusted?.percentile || null;
    const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? subsetEval.rmse.toFixed(2) : 'n/a';
    const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `${subsetEval.top20.toFixed(1)}%` : 'n/a';
    const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? percentileEval.rmse.toFixed(2) : 'n/a';
    const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `${percentileEval.top20.toFixed(1)}%` : 'n/a';
    console.log(`   ${year}: Correlation=${result.correlation.toFixed(4)}, Top-10=${top10Text}, Top-20=${top20Text}, Top-20 Weighted=${top20WeightedText}, Subset RMSE=${subsetRmseText}, Subset Top-20=${subsetTop20Text}, Pct RMSE=${pctRmseText}, Pct Top-20=${pctTop20Text}, Top-10 Overlap=${top10OverlapText}, Top-20 Overlap=${top20OverlapText}, Players=${result.matchedPlayers}`);
  });

  const aggregateEventKFoldSummary = kfoldResults => {
    const totals = {
      correlation: 0,
      rmse: 0,
      top10: 0,
      top20: 0,
      top20WeightedScore: 0,
      matchedPlayers: 0,
      years: 0
    };
    const foldMetrics = {
      correlation: [],
      rmse: [],
      top10: [],
      top20: [],
      top20WeightedScore: []
    };

    Object.values(kfoldResults || {}).forEach(result => {
      if (!result || result.status !== 'ok' || !result.evaluation) return;
      const evalResult = result.evaluation;
      const weight = typeof evalResult.matchedPlayers === 'number' ? evalResult.matchedPlayers : 0;
      if (!weight) return;
      totals.matchedPlayers += weight;
      totals.correlation += (evalResult.correlation || 0) * weight;
      totals.rmse += (evalResult.rmse || 0) * weight;
      if (typeof evalResult.top10 === 'number') totals.top10 += evalResult.top10 * weight;
      if (typeof evalResult.top20 === 'number') totals.top20 += evalResult.top20 * weight;
      if (typeof evalResult.top20WeightedScore === 'number') {
        totals.top20WeightedScore += evalResult.top20WeightedScore * weight;
      }
      totals.years += 1;

      if (Array.isArray(result.folds)) {
        result.folds.forEach(fold => {
          if (typeof fold.correlation === 'number') foldMetrics.correlation.push(fold.correlation);
          if (typeof fold.rmse === 'number') foldMetrics.rmse.push(fold.rmse);
          if (typeof fold.top10 === 'number') foldMetrics.top10.push(fold.top10);
          if (typeof fold.top20 === 'number') foldMetrics.top20.push(fold.top20);
          if (typeof fold.top20WeightedScore === 'number') {
            foldMetrics.top20WeightedScore.push(fold.top20WeightedScore);
          }
        });
      }
    });

    const computeStats = values => {
      if (!values.length) {
        return { count: 0, mean: 0, stdDev: 0, min: 0, max: 0, median: 0, p25: 0, p75: 0, iqr: 0 };
      }
      const count = values.length;
      const mean = values.reduce((sum, value) => sum + value, 0) / count;
      const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / count;
      const sorted = [...values].sort((a, b) => a - b);
      const quantile = q => {
        const position = (sorted.length - 1) * q;
        const base = Math.floor(position);
        const rest = position - base;
        if (sorted[base + 1] !== undefined) {
          return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        }
        return sorted[base];
      };
      const p25 = quantile(0.25);
      const p75 = quantile(0.75);
      const median = quantile(0.5);
      return {
        count,
        mean,
        stdDev: Math.sqrt(variance),
        min: Math.min(...values),
        max: Math.max(...values),
        median,
        p25,
        p75,
        iqr: p75 - p25
      };
    };

    const buildConfidence = stats => {
      const countScore = clamp01((stats?.count || 0) / 8);
      const variabilityScore = clamp01(1 - ((stats?.stdDev || 0) / 0.15));
      const score = clamp01((countScore * 0.6) + (variabilityScore * 0.4));
      const note = score >= 0.75
        ? 'High confidence: many folds with stable correlation distribution.'
        : (score >= 0.5
          ? 'Moderate confidence: some fold variability or limited fold count.'
          : 'Low confidence: high variability or few folds—treat results cautiously.');
      return { score, note, components: { countScore, variabilityScore } };
    };

    const foldStats = {
      correlation: computeStats(foldMetrics.correlation),
      rmse: computeStats(foldMetrics.rmse),
      top10: computeStats(foldMetrics.top10),
      top20: computeStats(foldMetrics.top20),
      top20WeightedScore: computeStats(foldMetrics.top20WeightedScore)
    };

    if (totals.matchedPlayers === 0) {
      const confidence = buildConfidence(foldStats.correlation);
      return {
        correlation: 0,
        rmse: 0,
        top10: 0,
        top20: 0,
        top20WeightedScore: 0,
        matchedPlayers: 0,
        years: totals.years,
        foldStats,
        confidence
      };
    }

    const confidence = buildConfidence(foldStats.correlation);
    return {
      correlation: totals.correlation / totals.matchedPlayers,
      rmse: totals.rmse / totals.matchedPlayers,
      top10: totals.top10 / totals.matchedPlayers,
      top20: totals.top20 / totals.matchedPlayers,
      top20WeightedScore: totals.top20WeightedScore / totals.matchedPlayers,
      matchedPlayers: totals.matchedPlayers,
      years: totals.years,
      foldStats,
      confidence
    };
  };

  const baselineEventKFoldSummary = aggregateEventKFoldSummary(baselineEventKFold);
  const optimizedEventKFoldSummary = aggregateEventKFoldSummary(optimizedEventKFold);
  const formatApproachUsageTable = results => {
    if (!results || typeof results !== 'object') return [];
    const rows = Object.entries(results)
      .map(([year, result]) => {
        const usage = result?.approachUsage || {};
        return {
          year,
          period: usage.period || 'none',
          source: usage.source || 'none',
          leakage: usage.leakageFlag || 'none'
        };
      })
      .sort((a, b) => String(a.year).localeCompare(String(b.year)));

    if (rows.length === 0) return [];
    const header = ['Year', 'Period', 'Source', 'Leakage'];
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`
    ];
    rows.forEach(row => {
      lines.push(`| ${row.year} | ${row.period} | ${row.source} | ${row.leakage} |`);
    });
    return lines;
  };
  const eventKFoldInterpretation = (() => {
    if (!baselineEventKFoldSummary || !optimizedEventKFoldSummary) {
      return { verdict: 'unavailable', note: 'Missing event K-fold summaries.' };
    }
    if (!baselineEventKFoldSummary.matchedPlayers || !optimizedEventKFoldSummary.matchedPlayers) {
      return { verdict: 'unavailable', note: 'Insufficient matched players across folds.' };
    }
    const corrDelta = optimizedEventKFoldSummary.correlation - baselineEventKFoldSummary.correlation;
    const rmseDelta = optimizedEventKFoldSummary.rmse - baselineEventKFoldSummary.rmse;
    const top20WDelta = optimizedEventKFoldSummary.top20WeightedScore - baselineEventKFoldSummary.top20WeightedScore;
    let verdict = 'no_material_change';
    let interpretation = 'No material change vs baseline across event folds.';
    if (corrDelta > 0.02 && rmseDelta < 0 && top20WDelta > 0) {
      verdict = 'strong_improvement';
      interpretation = 'Strong improvement: higher rank agreement, lower error, better Top-20 weighted score.';
    } else if (corrDelta > 0.01 && rmseDelta <= 0) {
      verdict = 'improvement';
      interpretation = 'Improvement: better correlation with equal or lower error.';
    } else if (corrDelta > 0.01 && rmseDelta > 0) {
      verdict = 'mixed';
      interpretation = 'Mixed: correlation improved but errors increased.';
    } else if (corrDelta < -0.01) {
      verdict = 'regression';
      interpretation = 'Regression: optimized weights underperform baseline across folds.';
    }
    const baselineConfidence = baselineEventKFoldSummary.confidence?.score ?? 0;
    const optimizedConfidence = optimizedEventKFoldSummary.confidence?.score ?? 0;
    const confidenceNote = optimizedConfidence >= baselineConfidence
      ? 'Optimized fold distribution is at least as stable as baseline.'
      : 'Optimized fold distribution is less stable than baseline.';
    return {
      verdict,
      interpretation,
      confidence: {
        baselineScore: baselineConfidence,
        optimizedScore: optimizedConfidence,
        note: confidenceNote
      },
      deltas: {
        correlation: corrDelta,
        rmse: rmseDelta,
        top20WeightedScore: top20WDelta
      }
    };
  })();

  const KFOLD_GATE_CONFIDENCE = 0.65;
  const kfoldOptimizedConfidence = eventKFoldInterpretation?.confidence?.optimizedScore;
  const kfoldGateApplied = eventKFoldInterpretation?.verdict === 'regression'
    && typeof kfoldOptimizedConfidence === 'number'
    && kfoldOptimizedConfidence >= KFOLD_GATE_CONFIDENCE;

  const currentYearRecommendation = improvement > 0.01
    ? 'Use optimized weights'
    : (improvement > 0
      ? 'Marginal improvement'
      : 'Use template baseline');

  const recommendationNote = kfoldGateApplied
    ? `K-fold gate applied (confidence ${(kfoldOptimizedConfidence * 100).toFixed(0)}% ≥ ${(KFOLD_GATE_CONFIDENCE * 100).toFixed(0)}%)`
    : 'Current-year improvement used (no K-fold gate triggered)';

  const recommendationApproach = kfoldGateApplied
    ? `Use template baseline (${bestTemplate.name})`
    : currentYearRecommendation;

  console.log('\n💡 Recommendation:');
  if (kfoldGateApplied) {
    console.log(`   ❌ K-fold regression detected; ${recommendationApproach}`);
    console.log(`   ⚠️  ${recommendationNote}`);
  } else if (improvement > 0.01) {
    console.log(`   ✅ ${recommendationApproach} - shows ${(improvement).toFixed(4)} improvement`);
  } else if (improvement > 0) {
    console.log(`   ⚠️  ${recommendationApproach} (${(improvement).toFixed(4)}) - consider baseline`);
  } else {
    console.log(`   ❌ ${recommendationApproach}`);
  }

  console.log('\n' + '='.repeat(100) + '\n');

  // Also save results to JSON
  const metricStatsDiagnostics = buildMetricStatsDiagnostics(optimizedRankingCurrent.groupStats, {
    stdDevThreshold: 0.05,
    minCount: 10
  });

  let eventTemplateAction = null;
  let eventTemplateTargets = [];
  const validationTemplateActions = [];

  const optimizedTemplateName = courseTemplateKey || String(CURRENT_EVENT_ID);

  const STANDARD_TEMPLATES = new Set(['POWER', 'BALANCED', 'TECHNICAL']);

  const validationTemplateSourceLabel = validationData?.weightTemplatesPath
    ? path.basename(validationData.weightTemplatesPath)
    : null;
  const validationCourseTypeKey = validationCourseType
    ? String(validationCourseType).trim().toUpperCase()
    : null;
  const standardTemplateSelection = (() => {
    const rawKey = courseContextEntry?.templateKey || courseContextEntry?.courseType || null;
    if (!rawKey) {
      return {
        key: null,
        source: 'course_context_missing',
        raw: null
      };
    }
    const normalized = String(rawKey).trim().toUpperCase();
    if (STANDARD_TEMPLATES.has(normalized)) {
      return {
        key: normalized,
        source: courseContextEntry?.templateKey ? 'course_context.templateKey' : 'course_context.courseType',
        raw: rawKey
      };
    }
    return {
      key: null,
      source: 'course_context_non_standard',
      raw: rawKey
    };
  })();
  const standardTemplateKey = standardTemplateSelection.key;
  const effectiveStandardTemplateKey = standardTemplateKey
    || (validationCourseTypeKey && STANDARD_TEMPLATES.has(validationCourseTypeKey)
      ? validationCourseTypeKey
      : null);
  const effectiveStandardTemplateSource = standardTemplateKey
    ? standardTemplateSelection.source
    : (effectiveStandardTemplateKey ? 'validation_course_type' : standardTemplateSelection.source);
  const effectiveStandardTemplateRaw = standardTemplateKey
    ? standardTemplateSelection.raw
    : (effectiveStandardTemplateKey ? validationCourseTypeKey : standardTemplateSelection.raw);
  console.log(`ℹ️  Standard template selection: ${effectiveStandardTemplateKey || 'none'} (source=${effectiveStandardTemplateSource}${effectiveStandardTemplateRaw ? `, raw=${effectiveStandardTemplateRaw}` : ''})`);

  const output = {
    timestamp: formatTimestamp(new Date()),
    eventId: CURRENT_EVENT_ID,
    tournament: TOURNAMENT_NAME || 'Sony Open',
    dryRun: DRY_RUN,
    optSeed: OPT_SEED_RAW || null,
    runFingerprint,
    pastPerformanceWeighting: pastPerformanceWeightSummary,
    courseContextUpdates: courseContextUpdateSummary,
    apiSnapshots: {
      dataGolfRankings: {
        source: rankingsSnapshot?.source || 'unknown',
        path: rankingsSnapshot?.path || null,
        lastUpdated: rankingsSnapshot?.payload?.last_updated || null,
        count: Array.isArray(rankingsSnapshot?.payload?.rankings)
          ? rankingsSnapshot.payload.rankings.length
          : null
      },
      dataGolfApproachSkill: {
        source: approachSkillSnapshot?.source || 'unknown',
        path: approachSkillSnapshot?.path || null,
        lastUpdated: approachSkillSnapshot?.payload?.last_updated || null,
        timePeriod: approachSkillSnapshot?.payload?.time_period || DATAGOLF_APPROACH_PERIOD || null,
        count: Array.isArray(approachSkillSnapshot?.payload?.data)
          ? approachSkillSnapshot.payload.data.length
          : null
      },
      dataGolfApproachSnapshotL24: {
        source: approachSnapshotL24?.source || 'unknown',
        path: approachSnapshotL24?.path || null,
        lastUpdated: approachSnapshotL24?.payload?.last_updated || null,
        timePeriod: approachSnapshotL24?.payload?.time_period || 'l24',
        count: Array.isArray(approachSnapshotL24?.payload?.data)
          ? approachSnapshotL24.payload.data.length
          : null
      },
      dataGolfApproachSnapshotL12: {
        source: approachSnapshotL12?.source || 'unknown',
        path: approachSnapshotL12?.path || null,
        lastUpdated: approachSnapshotL12?.payload?.last_updated || null,
        timePeriod: approachSnapshotL12?.payload?.time_period || 'l12',
        count: Array.isArray(approachSnapshotL12?.payload?.data)
          ? approachSnapshotL12.payload.data.length
          : null
      },
      dataGolfApproachSnapshotYtd: {
        source: approachSnapshotYtd?.source || 'unknown',
        path: approachSnapshotYtd?.path || null,
        archivePath: approachSnapshotYtd?.archivePath || null,
        lastUpdated: approachSnapshotYtd?.payload?.last_updated || null,
        timePeriod: approachSnapshotYtd?.payload?.time_period || 'ytd',
        count: Array.isArray(approachSnapshotYtd?.payload?.data)
          ? approachSnapshotYtd.payload.data.length
          : null
      },
      dataGolfFieldUpdates: {
        source: fieldUpdatesSnapshot?.source || 'unknown',
        path: fieldUpdatesSnapshot?.path || null,
        eventName: fieldUpdatesSnapshot?.payload?.event_name || null,
        eventId: fieldUpdatesSnapshot?.payload?.event_id || null,
        tour: fieldUpdatesSnapshot?.payload?.tour || DATAGOLF_FIELD_TOUR || null,
        fieldCount: Array.isArray(fieldUpdatesSnapshot?.payload?.field)
          ? fieldUpdatesSnapshot.payload.field.length
          : null
      },
      dataGolfPlayerDecompositions: {
        source: playerDecompositionsSnapshot?.source || 'unknown',
        path: playerDecompositionsSnapshot?.path || null,
        lastUpdated: playerDecompositionsSnapshot?.payload?.last_updated || null,
        eventName: playerDecompositionsSnapshot?.payload?.event_name || null,
        tour: DATAGOLF_DECOMP_TOUR || null,
        count: Array.isArray(playerDecompositionsSnapshot?.payload?.players)
          ? playerDecompositionsSnapshot.payload.players.length
          : null
      },
      dataGolfSkillRatingsValue: {
        source: skillRatingsValueSnapshot?.source || 'unknown',
        path: skillRatingsValueSnapshot?.path || null,
        lastUpdated: skillRatingsValueSnapshot?.payload?.last_updated || null,
        display: DATAGOLF_SKILL_DISPLAY_VALUE || null,
        count: Array.isArray(skillRatingsValueSnapshot?.payload?.players)
          ? skillRatingsValueSnapshot.payload.players.length
          : null
      },
      dataGolfSkillRatingsRank: {
        source: skillRatingsRankSnapshot?.source || 'unknown',
        path: skillRatingsRankSnapshot?.path || null,
        lastUpdated: skillRatingsRankSnapshot?.payload?.last_updated || null,
        display: DATAGOLF_SKILL_DISPLAY_RANK || null,
        count: Array.isArray(skillRatingsRankSnapshot?.payload?.players)
          ? skillRatingsRankSnapshot.payload.players.length
          : null
      },
      dataGolfHistoricalRounds: {
        source: historicalRoundsSnapshot?.source || 'unknown',
        path: historicalRoundsSnapshot?.path || null,
        tour: DATAGOLF_HISTORICAL_TOUR || null,
        eventId: DATAGOLF_HISTORICAL_EVENT_ID || null,
        year: historicalYear || null,
        count: historicalRoundsSnapshot?.payload && typeof historicalRoundsSnapshot.payload === 'object'
          ? Object.keys(historicalRoundsSnapshot.payload).length
          : null
      }
    },
    historicalMetricCorrelations,
    currentGeneratedMetricCorrelations,
    currentGeneratedTop20Correlations,
    historicalCoreTop20Correlations,
    historicalCoreTop20Blend: HISTORICAL_CORE_TOP20_BLEND,
    currentGeneratedTop20Logistic,
    currentGeneratedTop20CvSummary,
    cvReliability,
    blendSettings: {
      similarCourseIds: normalizeIdList(sharedConfig.similarCourseIds),
      puttingCourseIds: normalizeIdList(sharedConfig.puttingCourseIds),
      similarCoursesWeight: clamp01(sharedConfig.similarCoursesWeight, 0.3),
      puttingCoursesWeight: clamp01(sharedConfig.puttingCoursesWeight, 0.35)
    },
    suggestedTop20MetricWeights,
    suggestedTop20GroupWeights,
    conservativeSuggestedTop20GroupWeights,
    tunedTop20GroupWeights,
    availableYears,
    roundsByYearSummary: Object.fromEntries(Object.entries(roundsByYear).map(([year, rounds]) => [year, rounds.length])),
    resultsByYearSummary: Object.fromEntries(Object.entries(resultsByYear).map(([year, results]) => [year, results.length])),
    resultsCurrent,
    rawTemplateResults: templateResults,
    rawTemplateResultsCurrentYear: templateResults.map(result => ({
      name: result.name === String(CURRENT_EVENT_ID) ? 'CONFIGURATION_SHEET' : result.name,
      evaluation: result.yearly[CURRENT_SEASON] || null
    })),
    validationIntegration: {
      validationCourseType,
      validationTemplateName,
      validationPriorWeight: VALIDATION_PRIOR_WEIGHT,
      deltaTrendPriorWeight: DELTA_TREND_PRIOR_WEIGHT,
      approachDeltaPriorWeight: APPROACH_DELTA_PRIOR_WEIGHT,
      approachMode: VALIDATION_APPROACH_MODE,
      approachUsagePolicy: {
        currentSeason: 'ytd',
        lastSeason: 'l12',
        olderSeasons: 'l24',
        currentSeasonSource: approachDataCurrentSource,
        leakageFlagRules: {
          asOfDate: 'current season YTD snapshot',
          approximation: 'historical snapshot or CSV fallback',
          none: 'approach metrics excluded'
        }
      },
      deltaTrendsPath: validationData.deltaTrendsPath || null,
      deltaTrendSummary,
      skillRatingsValidation: {
        value: skillRatingsValidationValue,
        rank: skillRatingsValidationRank
      },
      playerDecompositionValidation
    },
    approachDeltaPrior: {
      label: APPROACH_DELTA_PRIOR_LABEL,
      weight: APPROACH_DELTA_PRIOR_WEIGHT,
      mode: approachDeltaPriorMode || 'unavailable',
      sourcePath: approachDeltaPriorMode === 'current_event' ? (APPROACH_DELTA_PATH || null) : null,
      filesUsed: approachDeltaPriorFiles,
      meta: approachDeltaPriorMeta || null,
      rowsTotal: approachDeltaRowsAll.length,
      rowsUsed: approachDeltaRows.length,
      correlations: approachDeltaCorrelations,
      alignmentMap: Array.from(approachDeltaAlignmentMap.entries()).map(([label, correlation]) => ({ label, correlation })),
      playerSummary: approachDeltaPlayerSummary
    },
    multiYearTemplateComparison: templateResults.map(result => ({
      name: result.name,
      evaluation: result.evaluation,
      yearly: result.yearly
    })),
    step1_bestTemplate: {
      name: bestTemplate.name,
      evaluation: baselineEvaluation,
      evaluationCurrentYear: bestTemplate.evaluationCurrent || null,
      evaluationAllYears: bestTemplate.evaluation,
      groupWeights: bestTemplate.groupWeights
    },
    step3_optimized: {
      evaluation: bestOptimized,
      evaluationCurrentYear: optimizedEvaluationCurrent,
      groupWeights: bestOptimized.weights,
      metricWeights: bestOptimized.metricWeights || bestTemplate.metricWeights,
      alignmentScore: bestOptimized.alignmentScore,
      top20CompositeScore: bestOptimized.top20Score,
      combinedObjectiveScore: bestOptimized.combinedScore,
      objectiveWeights: WEIGHT_OBJECTIVE,
      loeoPenaltyWeight: OPT_LOEO_PENALTY || 0,
      loeoTopN: OPT_LOEO_TOP_N || 0,
      loeoScore: typeof bestOptimized.loeoScore === 'number' ? bestOptimized.loeoScore : null,
      rankingsCurrentYear: formatRankingPlayers(optimizedRankingCurrent.players),
      metricStatsDiagnostics,
      baselineTemplate: bestTemplate.name,
      baselineGroupWeights: bestTemplate.groupWeights,
      groupWeightDelta: computeWeightDeltas(bestTemplate.groupWeights, bestOptimized.weights)
    },
    step4a_multiYearBaseline: baselineMultiYearResults,
    step4a_noApproachBaseline: noApproachMultiYearResults,
    step4b_multiYearOptimized: optimizedMultiYearResults,
    step4a_eventKFold: baselineEventKFold,
    step4b_eventKFold: optimizedEventKFold,
    eventKFoldSummary: {
      baseline: baselineEventKFoldSummary,
      optimized: optimizedEventKFoldSummary,
      interpretation: eventKFoldInterpretation
    },
    recommendation: {
      approach: recommendationApproach,
      baselineTemplate: bestTemplate.name,
      optimizedWeights: bestOptimized.weights,
      improvement,
      kfoldVerdict: eventKFoldInterpretation?.verdict || 'unavailable',
      kfoldOptimizedConfidence: typeof kfoldOptimizedConfidence === 'number' ? kfoldOptimizedConfidence : null,
      kfoldGateApplied,
      kfoldGateThreshold: KFOLD_GATE_CONFIDENCE,
      note: recommendationNote
    },
    standardTemplateSelection: {
      key: effectiveStandardTemplateKey,
      source: effectiveStandardTemplateSource,
      raw: effectiveStandardTemplateRaw,
      validationCourseType: validationCourseType || null
    }
  };

  const baseName = normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback)
    || `event-${CURRENT_EVENT_ID}`;
  const outputTagRaw = String(process.env.OUTPUT_TAG || '').trim();
  const kfoldTag = resolveKFoldTag(process.env.EVENT_KFOLD_K);
  const outputTagForBase = IS_POST_TOURNAMENT_RUN
    ? [kfoldTag.tag, outputTagRaw].filter(Boolean).join('_')
    : (outputTagRaw || null);
  const outputBaseName = buildOutputBaseName({
    tournamentSlug: canonicalTournamentSlug || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
    tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
    eventId: CURRENT_EVENT_ID,
    seed: OPT_SEED_RAW || null,
    outputTag: outputTagForBase
  });
  summaryOutputBaseName = outputBaseName;
  summaryTournamentSlug = canonicalTournamentSlug || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback) || null;

  const outputPath = buildArtifactPath({
    artifactType: OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_JSON,
    outputBaseName,
    tournamentSlug: canonicalTournamentSlug || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
    tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
    modeRoot: OUTPUT_DIR
  });
  const backupJsonPath = backupIfExists(outputPath);
  if (backupJsonPath) {
    console.log(`🗄️  Backed up previous JSON results to: ${backupJsonPath}`);
  }
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  resultsJsonPath = outputPath;

  
  const validationTypeToUpdate = effectiveStandardTemplateKey;
  const validationTemplateResult = validationTemplateName
    ? templateResults.find(result => result.name === validationTemplateName)
    : null;
  const standardTemplateResult = validationTypeToUpdate
    ? templateResults.find(result => result.name === validationTypeToUpdate)
    : null;
  const validationEval = validationTemplateResult?.evaluationCurrent || validationTemplateResult?.evaluation || null;
  const standardEval = standardTemplateResult?.evaluationCurrent || standardTemplateResult?.evaluation || null;
  const validationImprovementPct = (validationEval && standardEval && Math.abs(standardEval.correlation) > 0)
    ? (validationEval.correlation - standardEval.correlation) / Math.abs(standardEval.correlation)
    : null;
  const validationIsRecommendation = validationTemplateName && bestTemplate.name === validationTemplateName;
  const shouldUpdateStandardTemplate = typeof validationImprovementPct === 'number'
    ? validationImprovementPct >= 0.01
    : false;

  const buildHumanSummaryLines = () => {
    const lines = [];
    const formatPct = value => (typeof value === 'number' ? `${value.toFixed(1)}%` : 'n/a');
    const formatNum = (value, digits = 4) => (typeof value === 'number' ? value.toFixed(digits) : 'n/a');
    const baselineTop20 = baselineEvaluation?.top20WeightedScore ?? null;
    const optimizedTop20 = bestOptimized?.top20WeightedScore ?? null;
    const baselineCorr = baselineEvaluation?.correlation ?? null;
    const optimizedCorr = bestOptimized?.correlation ?? null;
    const seedToken = OPT_SEED_RAW ? `OPT_SEED=${OPT_SEED_RAW}` : 'OPT_SEED=<seed>';
    const envPrefix = [
      TOURNAMENT_NAME ? `TOURNAMENT_NAME=\"${TOURNAMENT_NAME}\"` : null,
      CURRENT_EVENT_ID ? `CURRENT_EVENT_ID=${CURRENT_EVENT_ID}` : null,
      CURRENT_SEASON ? `CURRENT_SEASON=${CURRENT_SEASON}` : null,
      OUTPUT_DIR ? `OUTPUT_DIR=\"${OUTPUT_DIR}\"` : null,
      seedToken
    ].filter(Boolean).join(' ');
    const runArgs = [
      '--event', CURRENT_EVENT_ID ? String(CURRENT_EVENT_ID) : null,
      '--season', CURRENT_SEASON ? String(CURRENT_SEASON) : null,
      '--name', TOURNAMENT_NAME ? `"${TOURNAMENT_NAME}"` : null,
      IS_POST_TOURNAMENT_RUN ? '--post' : null,
      LOGGING_ENABLED ? '--log' : null
    ].filter(Boolean).join(' ');
    const kfoldHasSummary = baselineEventKFoldSummary && optimizedEventKFoldSummary
      && baselineEventKFoldSummary.matchedPlayers
      && optimizedEventKFoldSummary.matchedPlayers;
    const kfoldCorrDelta = kfoldHasSummary
      ? optimizedEventKFoldSummary.correlation - baselineEventKFoldSummary.correlation
      : null;
    const kfoldRmseDelta = kfoldHasSummary
      ? optimizedEventKFoldSummary.rmse - baselineEventKFoldSummary.rmse
      : null;
    const kfoldTop20WDelta = kfoldHasSummary
      ? optimizedEventKFoldSummary.top20WeightedScore - baselineEventKFoldSummary.top20WeightedScore
      : null;
    const optimizedConfidenceScore = optimizedEventKFoldSummary?.confidence?.score;
    const optimizedConfidenceText = typeof optimizedConfidenceScore === 'number'
      ? `${(optimizedConfidenceScore * 100).toFixed(0)}%`
      : 'n/a';

    const avgTop20Weighted = resultsMap => {
      const values = Object.values(resultsMap || {})
        .map(entry => entry?.top20WeightedScore)
        .filter(value => typeof value === 'number' && Number.isFinite(value));
      if (!values.length) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    const baselineMultiAvg = avgTop20Weighted(baselineMultiYearResults);
    const optimizedMultiAvg = avgTop20Weighted(optimizedMultiYearResults);
    const baselineFailures = Object.values(baselineMultiYearResults || {}).filter(entry => {
      const stress = evaluateStressTest(entry, { minPlayers: 20, minCorr: 0.1, minTop20Weighted: 60 });
      return stress?.status === 'fail';
    }).length;
    const optimizedFailures = Object.values(optimizedMultiYearResults || {}).filter(entry => {
      const stress = evaluateStressTest(entry, { minPlayers: 20, minCorr: 0.1, minTop20Weighted: 60 });
      return stress?.status === 'fail';
    }).length;

    lines.push('HUMAN READABLE SUMMARY');
    lines.push('  • Correlation ≈ “ranking agreement” (higher is better).');
    lines.push('  • RMSE/MAE ≈ “how far off the predicted finish positions are” (lower is better).');
    lines.push('  • Top-20% = how often the model’s Top‑20 includes actual Top‑20 finishers.');
    lines.push('');
    lines.push(`  Current‑year baseline vs optimized:`);
    lines.push(`    - Correlation: ${formatNum(baselineCorr)} → ${formatNum(optimizedCorr)} (${formatNum((optimizedCorr ?? 0) - (baselineCorr ?? 0), 4)})`);
    lines.push(`    - Top‑20 weighted: ${formatPct(baselineTop20)} → ${formatPct(optimizedTop20)}`);
    lines.push(`    - Verdict: ${optimizedCorr > baselineCorr ? 'Optimized improved current‑year fit.' : 'Optimized did not improve current‑year fit.'}`);
    lines.push('');
    lines.push('  Multi‑year validation (stability across years):');
    lines.push(`    - Avg Top‑20 weighted: ${formatPct(baselineMultiAvg)} → ${formatPct(optimizedMultiAvg)}`);
    lines.push(`    - Stress fails (lower is better): ${baselineFailures} → ${optimizedFailures}`);
    lines.push('');

    if (baselineEventKFoldSummary && optimizedEventKFoldSummary && baselineEventKFoldSummary.matchedPlayers && optimizedEventKFoldSummary.matchedPlayers) {
      const corrDelta = optimizedEventKFoldSummary.correlation - baselineEventKFoldSummary.correlation;
      const rmseDelta = optimizedEventKFoldSummary.rmse - baselineEventKFoldSummary.rmse;
      const top20WDelta = optimizedEventKFoldSummary.top20WeightedScore - baselineEventKFoldSummary.top20WeightedScore;
      lines.push('  Event K‑fold (generalization across events):');
      lines.push(`    - Δ Corr=${formatNum(corrDelta)}, Δ RMSE=${formatNum(rmseDelta, 2)}, Δ Top‑20W=${formatNum(top20WDelta, 1)}%`);
      lines.push(`    - Verdict: ${kfoldGateApplied ? 'Regression detected; avoid using optimized weights.' : 'No regression detected.'}`);
    } else {
      lines.push('  Event K‑fold: not enough data to interpret.');
    }

    lines.push('');
    lines.push(`  Recommendation: ${recommendationApproach}`);
    if (recommendationNote) {
      lines.push(`  Note: ${recommendationNote}`);
    }

    if (kfoldGateApplied) {
      const kfoldSummaryLine = kfoldHasSummary
        ? `    - K-fold deltas: Δ Corr=${formatNum(kfoldCorrDelta)}, Δ RMSE=${formatNum(kfoldRmseDelta, 2)}, Δ Top-20W=${formatNum(kfoldTop20WDelta, 1)}%`
        : '    - K-fold deltas: n/a (insufficient data)';
      const confidenceLine = `    - Optimized fold confidence: ${optimizedConfidenceText} (gate=${(KFOLD_GATE_CONFIDENCE * 100).toFixed(0)}%)`;
      lines.push('');
      lines.push('  Layman recommendation (regression detected):');
      lines.push('    - Do NOT upsert/write templates. Stick with baseline weights.');
      lines.push('    - Regression means the optimized weights did worse when generalized across events.');
      lines.push(kfoldSummaryLine);
      lines.push(confidenceLine);
      lines.push('    - Re-run a few alternates to confirm stability before changing weights.');
      lines.push('    - If alternates still regress, keep baseline and wait for more data.');
      lines.push('');
      lines.push('  Alternate tests (copy/paste):');
      lines.push(`    - ${envPrefix} APPROACH_GROUP_CAP=0.35 OUTPUT_TAG=exp_cap node core/optimizer.js${runArgs ? ` ${runArgs}` : ''}`);
      lines.push(`    - ${envPrefix} APPROACH_BLEND_WEIGHTS=\"0.6,0.3,0.1\" OUTPUT_TAG=exp_blend node core/optimizer.js${runArgs ? ` ${runArgs}` : ''}`);
      lines.push(`    - ${envPrefix} OPT_LOEO_PENALTY=0.25 OPT_LOEO_TOP_N=50 OUTPUT_TAG=exp_loeo node core/optimizer.js${runArgs ? ` ${runArgs}` : ''}`);
      lines.push(`    - ${envPrefix} EVENT_KFOLD_K=5 OUTPUT_TAG=kfold5 node core/optimizer.js${runArgs ? ` ${runArgs}` : ''}`);
    }

    return lines;
  };
  const humanSummaryLines = buildHumanSummaryLines();

  const textLines = [];
  textLines.push('='.repeat(100));
  textLines.push('ADAPTIVE WEIGHT OPTIMIZER - FINAL RESULTS');
  textLines.push('='.repeat(100));
  textLines.push(`DRY RUN: ${DRY_RUN ? 'ON (template files not modified)' : 'OFF (templates written)'}`);
  textLines.push('RUN FINGERPRINT: see JSON output (runFingerprint)');
  if (OPT_SEED_RAW) {
    textLines.push(`OPT_SEED: ${OPT_SEED_RAW}`);
  }
  textLines.push('');
  textLines.push('STEP 1: HISTORICAL METRIC CORRELATIONS');
  textLines.push('Functions: buildHistoricalMetricSamples, computeHistoricalMetricCorrelations (optimizer.js)');
  textLines.push('HISTORICAL METRIC CORRELATIONS (avg across years):');
  HISTORICAL_METRICS.forEach(metric => {
    const avg = historicalMetricCorrelations.average[metric.key];
    const corrValue = avg ? avg.correlation : 0;
    const samples = avg ? avg.samples : 0;
    textLines.push(`  ${metric.label}: Corr=${corrValue.toFixed(4)}, Samples=${samples}`);
  });
  textLines.push('');
  textLines.push('HISTORICAL METRIC CORRELATIONS (per year):');
  Object.entries(historicalMetricCorrelations.perYear).sort().forEach(([year, metrics]) => {
    textLines.push(`  ${year}:`);
    HISTORICAL_METRICS.forEach(metric => {
      const entry = metrics[metric.key];
      if (!entry) return;
      textLines.push(`    ${metric.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
    });
  });
  textLines.push('');
  textLines.push(`STEP 1b: CURRENT-SEASON EVENT-ONLY METRICS (${CURRENT_SEASON}, event only)`);
  textLines.push('Functions: runRanking (optimizer.js) -> buildPlayerData (utilities/dataPrep.js) -> generatePlayerRankings (modelCore.js)');
  textLines.push('Additional: computeGeneratedMetricCorrelations, computeGeneratedMetricTopNCorrelations, trainTopNLogisticModel, crossValidateTopNLogisticByEvent, buildSuggestedMetricWeights, buildSuggestedGroupWeights (optimizer.js)');
  textLines.push(`APPROACH DELTA PRIOR (${APPROACH_DELTA_PRIOR_LABEL}):`);
  if (approachDeltaPriorMode === 'rolling_average') {
    textLines.push(`  Mode: rolling_average (files=${approachDeltaPriorFiles.length}, max=${APPROACH_DELTA_ROLLING_EVENTS})`);
    textLines.push(`  Rows used: ${approachDeltaRows.length}/${approachDeltaRowsAll.length}`);
    const rollingEntries = Array.from(approachDeltaAlignmentMap.entries())
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10);
    if (rollingEntries.length === 0) {
      textLines.push('  No rolling alignment map computed.');
    } else {
      rollingEntries.forEach(([label, value]) => {
        textLines.push(`  ${label}: Score=${value.toFixed(4)}`);
      });
    }
    if (approachDeltaPlayerSummary?.trendWeighted?.topMovers?.length) {
      textLines.push('  Player delta movers (trend-weighted, top 10):');
      approachDeltaPlayerSummary.trendWeighted.topMovers.forEach((entry, idx) => {
        const name = entry.playerName || entry.dgId || 'Unknown';
        textLines.push(`    ${idx + 1}. ${name}: Score=${entry.score.toFixed(4)}`);
      });
      textLines.push('  Player delta movers (trend-weighted, bottom 10):');
      approachDeltaPlayerSummary.trendWeighted.bottomMovers.forEach((entry, idx) => {
        const name = entry.playerName || entry.dgId || 'Unknown';
        textLines.push(`    ${idx + 1}. ${name}: Score=${entry.score.toFixed(4)}`);
      });
    }
    if (approachDeltaPlayerSummary?.predictiveWeighted?.topMovers?.length) {
      textLines.push('  Player delta movers (predictive-weighted, top 10):');
      approachDeltaPlayerSummary.predictiveWeighted.topMovers.forEach((entry, idx) => {
        const name = entry.playerName || entry.dgId || 'Unknown';
        textLines.push(`    ${idx + 1}. ${name}: Score=${entry.score.toFixed(4)}`);
      });
      textLines.push('  Player delta movers (predictive-weighted, bottom 10):');
      approachDeltaPlayerSummary.predictiveWeighted.bottomMovers.forEach((entry, idx) => {
        const name = entry.playerName || entry.dgId || 'Unknown';
        textLines.push(`    ${idx + 1}. ${name}: Score=${entry.score.toFixed(4)}`);
      });
    }
  } else if (!approachDeltaCorrelations.length) {
    textLines.push('  No approach delta correlations computed (missing results or delta file).');
  } else {
    textLines.push(`  Weight: ${APPROACH_DELTA_PRIOR_WEIGHT.toFixed(2)}`);
    textLines.push(`  Source: ${APPROACH_DELTA_PATH || 'n/a'}`);
    textLines.push(`  Rows used: ${approachDeltaRows.length}/${approachDeltaRowsAll.length}`);
    approachDeltaCorrelations.slice(0, 10).forEach(entry => {
      textLines.push(`  ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
    });
  }
  textLines.push('');
  textLines.push(`EVENT-ONLY means season ${CURRENT_SEASON} only (current event rounds only).`);
  const reportSimilarCourseIds = normalizeIdList(sharedConfig.similarCourseIds);
  const reportPuttingCourseIds = normalizeIdList(sharedConfig.puttingCourseIds);
  const reportSimilarBlend = clamp01(sharedConfig.similarCoursesWeight, 0.3);
  const reportPuttingBlend = clamp01(sharedConfig.puttingCoursesWeight, 0.35);
  const reportEventIds = [String(CURRENT_EVENT_ID), ...reportSimilarCourseIds.map(String), ...reportPuttingCourseIds.map(String)];
  const reportEventIdList = Array.from(new Set(reportEventIds)).join(', ');
  textLines.push(`EVENT-ONLY GENERATED METRIC CORRELATIONS (${CURRENT_SEASON}, event only):`);
  if (eventOnlyGeneratedMetricCorrelations.length === 0) {
    textLines.push(`  No ${CURRENT_SEASON} event-only metric correlations computed.`);
  } else {
    eventOnlyGeneratedMetricCorrelations.forEach(entry => {
      textLines.push(`  ${entry.index}. ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
    });
  }
  textLines.push('');
  textLines.push(`EVENT-ONLY GENERATED METRIC TOP-20 SIGNAL (${CURRENT_SEASON}, event only):`);
  if (eventOnlyGeneratedTop20Correlations.length === 0) {
    textLines.push(`  No ${CURRENT_SEASON} event-only top-20 correlations computed.`);
  } else {
    eventOnlyGeneratedTop20Correlations.forEach(entry => {
      textLines.push(`  ${entry.index}. ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
    });
  }
  textLines.push('');
  textLines.push('');
  textLines.push(`STEP 1c: CURRENT-SEASON GENERATED METRICS (${CURRENT_SEASON}, event + similar + putting)`);
  textLines.push(`CURRENT-SEASON means season ${CURRENT_SEASON} only (event + similar + putting events).`);
  textLines.push(`Metric events (current season): [${reportEventIdList}]`);
  textLines.push(`Blend settings: similarCourseEvents=${reportSimilarCourseIds.length}, similarBlend=${reportSimilarBlend.toFixed(2)}, puttingCourseEvents=${reportPuttingCourseIds.length}, puttingBlend=${reportPuttingBlend.toFixed(2)} (SG Putting only)`);
  textLines.push(`CURRENT-SEASON GENERATED METRIC CORRELATIONS (${CURRENT_SEASON}, event + similar + putting):`);
  if (currentGeneratedMetricCorrelations.length === 0) {
    textLines.push(`  No ${CURRENT_SEASON} metric correlations computed.`);
  } else {
    currentGeneratedMetricCorrelations.forEach(entry => {
      textLines.push(`  ${entry.index}. ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
    });
  }
  textLines.push('');
  textLines.push(`CURRENT-SEASON GENERATED METRIC TOP-20 SIGNAL (${CURRENT_SEASON}, event + similar + putting):`);
  if (currentGeneratedTop20Correlations.length === 0) {
    textLines.push(`  No ${CURRENT_SEASON} top-20 correlations computed.`);
  } else {
    currentGeneratedTop20Correlations.forEach(entry => {
      textLines.push(`  ${entry.index}. ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
    });
  }
  textLines.push('');
  textLines.push('HISTORICAL CORE METRIC TOP-20 SIGNAL (all years, event only):');
  textLines.push(`Blend weight into top-20 signal: ${(HISTORICAL_CORE_TOP20_BLEND * 100).toFixed(0)}%`);
  if (historicalCoreTop20Correlations.length === 0) {
    textLines.push('  No historical core top-20 correlations computed.');
  } else {
    historicalCoreTop20Correlations.forEach(entry => {
      textLines.push(`  ${entry.index}. ${entry.label}: Corr=${entry.correlation.toFixed(4)}, Samples=${entry.samples}`);
    });
  }
  textLines.push('');
  textLines.push(`CURRENT-SEASON TOP-20 LOGISTIC MODEL (${CURRENT_SEASON}, event + similar + putting):`);
  if (!currentGeneratedTop20Logistic || !currentGeneratedTop20Logistic.success) {
    const reason = currentGeneratedTop20Logistic?.message || 'Not enough data';
    textLines.push(`  Logistic model unavailable: ${reason}`);
  } else {
    textLines.push(`  Samples: ${currentGeneratedTop20Logistic.samples}`);
    textLines.push(`  Accuracy: ${(currentGeneratedTop20Logistic.accuracy * 100).toFixed(1)}%`);
    textLines.push(`  LogLoss: ${currentGeneratedTop20Logistic.logLoss.toFixed(4)}`);
    textLines.push('  Top 10 Weighted Metrics:');
    currentGeneratedTop20Logistic.weightRanking.forEach((entry, idx) => {
      textLines.push(`    ${idx + 1}. ${entry.label}: weight=${entry.weight.toFixed(4)}`);
    });
  }
  textLines.push('');
  textLines.push(`EVENT-BASED TOP-20 CV SUMMARY (${CURRENT_SEASON}):`);
  if (!currentGeneratedTop20CvSummary || !currentGeneratedTop20CvSummary.success) {
    const reason = currentGeneratedTop20CvSummary?.message || 'Not enough events';
    const eventCount = currentGeneratedTop20CvSummary?.eventCount;
    textLines.push(`  CV unavailable: ${reason}${typeof eventCount === 'number' ? ` (events=${eventCount})` : ''}`);
  } else {
    textLines.push(`  Events: ${currentGeneratedTop20CvSummary.eventCount}`);
    textLines.push(`  Samples: ${currentGeneratedTop20CvSummary.totalSamples}`);
    if (currentGeneratedTop20CvSummary.note) {
      textLines.push(`  Note: ${currentGeneratedTop20CvSummary.note}`);
    }
    textLines.push(`  Best L2: ${currentGeneratedTop20CvSummary.bestL2}`);
    textLines.push(`  Avg LogLoss: ${currentGeneratedTop20CvSummary.avgLogLoss.toFixed(4)}`);
    textLines.push(`  Avg Accuracy: ${(currentGeneratedTop20CvSummary.avgAccuracy * 100).toFixed(1)}%`);
    textLines.push(`  Folds Used: ${currentGeneratedTop20CvSummary.foldsUsed}`);
  }
  textLines.push('');
  textLines.push(`SUGGESTED METRIC WEIGHTS (TOP-20) - SOURCE: ${suggestedTop20MetricWeights.source}`);
  if (!suggestedTop20MetricWeights.weights.length) {
    textLines.push('  No suggested metric weights available.');
  } else {
    suggestedTop20MetricWeights.weights.slice(0, 15).forEach((entry, idx) => {
      const corrText = typeof entry.top20Correlation === 'number' ? entry.top20Correlation.toFixed(4) : 'n/a';
      const logisticText = typeof entry.logisticWeight === 'number' ? entry.logisticWeight.toFixed(4) : 'n/a';
      textLines.push(`  ${idx + 1}. ${entry.label}: weight=${entry.weight.toFixed(4)}, top20Corr=${corrText}, logisticWeight=${logisticText}`);
    });
  }
  textLines.push('');
  textLines.push(`SUGGESTED GROUP WEIGHTS (TOP-20) - SOURCE: ${suggestedTop20GroupWeights.source}`);
  if (!suggestedTop20GroupWeights.weights.length) {
    textLines.push('  No suggested group weights available.');
  } else {
    suggestedTop20GroupWeights.weights.forEach((entry, idx) => {
      textLines.push(`  ${idx + 1}. ${entry.groupName}: weight=${entry.weight.toFixed(4)}`);
    });
  }
  textLines.push('');
  textLines.push(`CV RELIABILITY (event-based): ${(cvReliability * 100).toFixed(1)}%`);
  textLines.push(`CONSERVATIVE GROUP WEIGHTS (CV-adjusted, model share ${(conservativeSuggestedTop20GroupWeights.modelShare * 100).toFixed(1)}%):`);
  if (!conservativeSuggestedTop20GroupWeights.weights.length) {
    textLines.push('  No CV-adjusted group weights available.');
  } else {
    conservativeSuggestedTop20GroupWeights.weights.forEach((entry, idx) => {
      textLines.push(`  ${idx + 1}. ${entry.groupName}: weight=${entry.weight.toFixed(4)}`);
    });
  }
  textLines.push('');
  textLines.push(`STEP 1d: CURRENT-YEAR TEMPLATE BASELINE (${CURRENT_SEASON})`);
  textLines.push('Functions: runRanking, evaluateRankings, computeTemplateCorrelationAlignment (optimizer.js)');
  textLines.push('PAST PERFORMANCE WEIGHTING (course history regression):');
  textLines.push(`  Enabled: ${pastPerformanceWeightSummary.enabled ? 'yes' : 'no'}`);
  textLines.push(`  Course Num: ${pastPerformanceWeightSummary.courseNum || 'n/a'}`);
  if (pastPerformanceWeightSummary.regression) {
    const slope = Number(pastPerformanceWeightSummary.regression.slope);
    const pValue = Number(pastPerformanceWeightSummary.regression.pValue);
    textLines.push(`  Regression: slope=${Number.isFinite(slope) ? slope.toFixed(4) : 'n/a'}, p=${Number.isFinite(pValue) ? pValue.toFixed(6) : 'n/a'}`);
  } else {
    textLines.push('  Regression: n/a');
  }
  const computedWeightText = typeof pastPerformanceWeightSummary.computedWeight === 'number'
    ? pastPerformanceWeightSummary.computedWeight.toFixed(2)
    : 'n/a';
  const usedWeightText = typeof pastPerformanceWeightSummary.usedWeight === 'number'
    ? pastPerformanceWeightSummary.usedWeight.toFixed(2)
    : 'n/a';
  textLines.push(`  Computed Weight: ${computedWeightText}`);
  textLines.push(`  Used Weight (config): ${usedWeightText}`);
  const regressionSourceLabel = pastPerformanceWeightSummary.source || 'n/a';
  const regressionPathLabel = pastPerformanceWeightSummary.path ? path.basename(pastPerformanceWeightSummary.path) : null;
  textLines.push(`  Regression Source: ${regressionSourceLabel}${regressionPathLabel ? ` (${regressionPathLabel})` : ''}`);
  if (courseContextUpdateSummary) {
    const updateStatus = courseContextUpdateSummary.updated ? 'yes' : 'no';
    textLines.push(`  Course Context Updates: ${updateStatus} (${courseContextUpdateSummary.updatedCount || 0} entries)`);
    if (courseContextUpdateSummary.reason) {
      textLines.push(`  Update Note: ${courseContextUpdateSummary.reason}`);
    }
  }
  textLines.push('');
  textLines.push('VALIDATION / DELTA TREND INTEGRATION SUMMARY:');
  textLines.push(`  Validation Course Type: ${validationCourseType || 'n/a'}`);
  textLines.push(`  Validation Template: ${validationTemplateName || 'n/a'}`);
  textLines.push(`  Validation Prior Weight: ${VALIDATION_PRIOR_WEIGHT}`);
  textLines.push(`  Delta Trend Prior Weight: ${DELTA_TREND_PRIOR_WEIGHT}`);
  textLines.push(`  Delta Trends Source: ${validationData.deltaTrendsPath || 'n/a'}`);
  if (deltaTrendSummary) {
    textLines.push(`  Guardrail Totals: ${deltaTrendSummary.totalConstrained}`);
    textLines.push(`  Guardrails by Status: STABLE=${deltaTrendSummary.statusCounts.STABLE || 0}, WATCH=${deltaTrendSummary.statusCounts.WATCH || 0}, CHRONIC=${deltaTrendSummary.statusCounts.CHRONIC || 0}`);
    textLines.push(`  Guardrail Ranges: STABLE=±${(DELTA_TREND_RANGE.STABLE * 100).toFixed(0)}%, WATCH=±${(DELTA_TREND_RANGE.WATCH * 100).toFixed(0)}%, CHRONIC=±${(DELTA_TREND_RANGE.CHRONIC * 100).toFixed(0)}%`);
  } else {
    textLines.push('  Guardrail Totals: n/a');
  }
  textLines.push('');
  if (configBaselineEvaluation) {
    textLines.push('CONFIGURATION_SHEET BASELINE (event-specific config weights):');
    textLines.push(`Template: CONFIGURATION_SHEET`);
    textLines.push(`Correlation: ${configBaselineEvaluation.correlation.toFixed(4)}`);
    textLines.push(`R²: ${configBaselineEvaluation.rSquared.toFixed(4)}`);
    textLines.push(`RMSE: ${configBaselineEvaluation.rmse.toFixed(2)}`);
    textLines.push(`MAE: ${configBaselineEvaluation.mae.toFixed(2)}`);
    textLines.push(`Mean Error: ${configBaselineEvaluation.meanError.toFixed(2)}`);
    textLines.push(`Std Dev Error: ${configBaselineEvaluation.stdDevError.toFixed(2)}`);
    textLines.push(`Top-10 Accuracy: ${typeof configBaselineEvaluation.top10 === 'number' ? `${configBaselineEvaluation.top10.toFixed(1)}%` : 'n/a'}`);
    textLines.push(`Top-20 Accuracy: ${typeof configBaselineEvaluation.top20 === 'number' ? `${configBaselineEvaluation.top20.toFixed(1)}%` : 'n/a'}`);
    textLines.push(`Top-20 Weighted Score: ${typeof configBaselineEvaluation.top20WeightedScore === 'number' ? `${configBaselineEvaluation.top20WeightedScore.toFixed(1)}%` : 'n/a'}`);
    textLines.push(`Matched Players: ${configBaselineEvaluation.matchedPlayers}`);
    if (configBaselineEvaluation.top20Details) {
      textLines.push(`Top-20 Overlap: ${configBaselineEvaluation.top20Details.overlapCount}/20`);
      textLines.push('  Predicted Top-20 source: generatePlayerRankings (config weights)');
      textLines.push(`  Predicted Top-20: ${configBaselineEvaluation.top20Details.predicted.join(', ')}`);
      textLines.push(`  Actual Top-20: ${configBaselineEvaluation.top20Details.actual.join(', ')}`);
      textLines.push(`  Overlap: ${configBaselineEvaluation.top20Details.overlap.join(', ')}`);
    }
    textLines.push('');
  }
  textLines.push('TEMPLATES TESTED (Step 1d):');
  Object.keys(templateConfigs).sort().forEach(name => {
    textLines.push(`  - ${name}`);
  });
  textLines.push('');
  textLines.push(`RAW TEMPLATE RESULTS (${CURRENT_SEASON}, per template):`);
  templateResults.forEach(result => {
    const displayName = result.name === String(CURRENT_EVENT_ID) ? 'CONFIGURATION_SHEET' : result.name;
    const yearlyEval = result.yearly[CURRENT_SEASON];
    if (!yearlyEval) {
      textLines.push(`  ${displayName}: no evaluation data for ${CURRENT_SEASON}`);
      return;
    }
    const top10Text = typeof yearlyEval.top10 === 'number' ? `, Top-10=${yearlyEval.top10.toFixed(1)}%` : '';
    const top20Text = typeof yearlyEval.top20 === 'number' ? `, Top-20=${yearlyEval.top20.toFixed(1)}%` : '';
    const top20WeightedText = typeof yearlyEval.top20WeightedScore === 'number' ? `, Top-20 Weighted=${yearlyEval.top20WeightedScore.toFixed(1)}%` : '';
    textLines.push(
      `  ${displayName}: Corr=${yearlyEval.correlation.toFixed(4)}, R²=${yearlyEval.rSquared.toFixed(4)}, RMSE=${yearlyEval.rmse.toFixed(2)}, MAE=${yearlyEval.mae.toFixed(2)}, Mean Err=${yearlyEval.meanError.toFixed(2)}, Std Err=${yearlyEval.stdDevError.toFixed(2)}${top10Text}${top20Text}${top20WeightedText}, Players=${yearlyEval.matchedPlayers}`
    );
  });
  textLines.push('');
  textLines.push('BEST TEMPLATE (for comparison):');
  textLines.push(`Template: ${bestTemplate.name}`);
  textLines.push(`Correlation: ${baselineEvaluation.correlation.toFixed(4)}`);
  textLines.push(`R²: ${baselineEvaluation.rSquared.toFixed(4)}`);
  textLines.push(`RMSE: ${baselineEvaluation.rmse.toFixed(2)}`);
  textLines.push(`MAE: ${baselineEvaluation.mae.toFixed(2)}`);
  textLines.push(`Mean Error: ${baselineEvaluation.meanError.toFixed(2)}`);
  textLines.push(`Std Dev Error: ${baselineEvaluation.stdDevError.toFixed(2)}`);
  textLines.push(`Top-10 Accuracy: ${typeof baselineEvaluation.top10 === 'number' ? `${baselineEvaluation.top10.toFixed(1)}%` : 'n/a'}`);
  textLines.push(`Top-20 Accuracy: ${typeof baselineEvaluation.top20 === 'number' ? `${baselineEvaluation.top20.toFixed(1)}%` : 'n/a'}`);
  textLines.push(`Top-20 Weighted Score: ${typeof baselineEvaluation.top20WeightedScore === 'number' ? `${baselineEvaluation.top20WeightedScore.toFixed(1)}%` : 'n/a'}`);
  textLines.push(`Matched Players: ${baselineEvaluation.matchedPlayers}`);
  if (baselineEvaluation.top20Details) {
    textLines.push(`Top-20 Overlap: ${baselineEvaluation.top20Details.overlapCount}/20`);
    textLines.push('  Predicted Top-20 source: generatePlayerRankings (best template weights)');
    textLines.push(`  Predicted Top-20: ${baselineEvaluation.top20Details.predicted.join(', ')}`);
    textLines.push(`  Actual Top-20: ${baselineEvaluation.top20Details.actual.join(', ')}`);
    textLines.push(`  Overlap: ${baselineEvaluation.top20Details.overlap.join(', ')}`);
  }
  textLines.push('');
  textLines.push('RESULTS CURRENT (derived/loaded):');
  textLines.push('  Source: Historical Data fin_text (event + season)');
  [...resultsCurrent]
    .sort((a, b) => {
      if (a.finishPosition !== b.finishPosition) return a.finishPosition - b.finishPosition;
      return String(a.dgId).localeCompare(String(b.dgId));
    })
    .forEach(result => {
    const name = result.playerName ? ` - ${result.playerName}` : '';
    textLines.push(`  ${result.dgId}: ${result.finishPosition}${name}`);
  });
  textLines.push('');
  textLines.push('STEP 2: TOP-20 GROUP WEIGHT TUNING');
  textLines.push('Functions: selectOptimizableGroups, runRanking, evaluateRankings (optimizer.js)');
  textLines.push(`Scope: event ${CURRENT_EVENT_ID} across all years (current-field only)`);
  textLines.push('TUNED TOP-20 GROUP WEIGHTS (BEST CANDIDATE):');
  if (!tunedTop20GroupWeights) {
    textLines.push('  No tuned group weights available.');
  } else {
    const bestEval = tunedTop20GroupWeights.evaluation;
    textLines.push(`  Top-10: ${typeof bestEval.top10 === 'number' ? `${bestEval.top10.toFixed(1)}%` : 'n/a'}`);
    textLines.push(`  Top-20: ${typeof bestEval.top20 === 'number' ? `${bestEval.top20.toFixed(1)}%` : 'n/a'}`);
    textLines.push(`  RMSE: ${bestEval.rmse.toFixed(2)} | Corr: ${bestEval.correlation.toFixed(4)} | Players: ${bestEval.matchedPlayers}`);
    Object.entries(tunedTop20GroupWeights.groupWeights).forEach(([groupName, weight]) => {
      textLines.push(`  ${groupName}: ${weight.toFixed(4)}`);
    });
    textLines.push(`  Metric Weights (used unchanged from ${step2BaseTemplateName}):`);
    Object.entries(step2MetricWeights).forEach(([metricKey, weight]) => {
      textLines.push(`  ${metricKey}: ${weight.toFixed(4)}`);
    });
  }
  textLines.push('');
  textLines.push('STEP 3: WEIGHT OPTIMIZATION (2026 with approach metrics)');
  textLines.push('Functions: adjustMetricWeights, computeMetricAlignmentScore, runRanking, evaluateRankings (optimizer.js)');
  textLines.push('Objective: current-year results only (current-year field)');
  textLines.push(`Baseline Template: ${bestTemplate.name}`);
  textLines.push(`Best Correlation: ${bestOptimized.correlation.toFixed(4)}`);
  textLines.push(`Metric Alignment Score (Top-20 KPI blend): ${bestOptimized.alignmentScore.toFixed(4)}`);
  textLines.push(`Top-20 Composite Score: ${(bestOptimized.top20Score * 100).toFixed(1)}%`);
  textLines.push(`Combined Objective Score: ${bestOptimized.combinedScore.toFixed(4)} (corr ${WEIGHT_OBJECTIVE.correlation}, top20 ${WEIGHT_OBJECTIVE.top20}, alignment ${WEIGHT_OBJECTIVE.alignment})`);
  textLines.push(`Best R²: ${bestOptimized.rSquared.toFixed(4)}`);
  textLines.push(`Best RMSE: ${bestOptimized.rmse.toFixed(2)}`);
  textLines.push(`Best MAE: ${bestOptimized.mae.toFixed(2)}`);
  textLines.push(`Best Mean Error: ${bestOptimized.meanError.toFixed(2)}`);
  textLines.push(`Best Std Dev Error: ${bestOptimized.stdDevError.toFixed(2)}`);
  textLines.push(`Improvement: ${((bestOptimized.correlation - baselineEvaluation.correlation) / Math.abs(baselineEvaluation.correlation) * 100).toFixed(2)}%`);
  textLines.push(`Top-10 Accuracy: ${typeof bestOptimized.top10 === 'number' ? `${bestOptimized.top10.toFixed(1)}%` : 'n/a'}`);
  textLines.push(`Top-20 Accuracy: ${typeof bestOptimized.top20 === 'number' ? `${bestOptimized.top20.toFixed(1)}%` : 'n/a'}`);
  textLines.push(`Top-20 Weighted Score: ${typeof bestOptimized.top20WeightedScore === 'number' ? `${bestOptimized.top20WeightedScore.toFixed(1)}%` : 'n/a'}`);
  textLines.push(`Matched Players (current year): ${bestOptimized.matchedPlayers}`);
  textLines.push('');
  textLines.push('Optimized Group Weights:');
  Object.entries(bestOptimized.weights).forEach(([metric, weight]) => {
    textLines.push(`  ${metric}: ${(weight * 100).toFixed(1)}%`);
  });
  textLines.push('');
  textLines.push('Optimized Metric Weights:');
  Object.entries(bestOptimized.metricWeights || bestTemplate.metricWeights).forEach(([metric, weight]) => {
    textLines.push(`  ${metric}: ${weight.toFixed(4)}`);
  });
  textLines.push('');
  textLines.push('Metric Stats Diagnostics (current-year ranking):');
  textLines.push(`  Thresholds: stdDev<=${metricStatsDiagnostics.thresholds.stdDevThreshold}, count<${metricStatsDiagnostics.thresholds.minCount}`);
  if (!metricStatsDiagnostics.flagged.length) {
    textLines.push('  No metrics flagged under the thresholds.');
  } else {
    metricStatsDiagnostics.flagged.forEach(entry => {
      const mean = typeof entry.mean === 'number' ? entry.mean.toFixed(4) : 'n/a';
      const stdDev = typeof entry.stdDev === 'number' ? entry.stdDev.toFixed(4) : 'n/a';
      const min = typeof entry.min === 'number' ? entry.min.toFixed(4) : 'n/a';
      const max = typeof entry.max === 'number' ? entry.max.toFixed(4) : 'n/a';
      const count = typeof entry.count === 'number' ? entry.count : 'n/a';
      textLines.push(`  ${entry.group} :: ${entry.metric} | mean=${mean}, stdDev=${stdDev}, min=${min}, max=${max}, count=${count} [${entry.reasons.join(', ')}]`);
    });
  }
  textLines.push('');
  textLines.push(`Optimized Rankings (Current Year ${CURRENT_SEASON}):`);
  formatRankingPlayers(optimizedRankingCurrent.players).forEach(player => {
    const name = player.name ? ` - ${player.name}` : '';
    const refined = typeof player.refinedWeightedScore === 'number' ? player.refinedWeightedScore.toFixed(4) : 'n/a';
    const weighted = typeof player.weightedScore === 'number' ? player.weightedScore.toFixed(4) : 'n/a';
    textLines.push(`  ${player.rank ?? 'n/a'}: ${player.dgId}${name} | refined=${refined}, weighted=${weighted}`);
  });
  textLines.push('');
  textLines.push('STEP 4a: MULTI-YEAR VALIDATION (Baseline)');
  textLines.push(`Approach mode: ${VALIDATION_APPROACH_MODE}`);
  textLines.push('Functions: runRanking, aggregateYearlyEvaluations (optimizer.js)');
  Object.entries(baselineMultiYearResults).sort().forEach(([year, result]) => {
    const approachUsage = result.approachUsage || {};
    const approachText = approachUsage.period
      ? `, Approach=${approachUsage.period}/${approachUsage.source || 'n/a'}, Leakage=${approachUsage.leakageFlag || 'n/a'}`
      : '';
    const top10Text = typeof result.top10 === 'number' ? `, Top-10=${result.top10.toFixed(1)}%` : '';
    const top20Text = typeof result.top20 === 'number' ? `, Top-20=${result.top20.toFixed(1)}%` : '';
    const top20WeightedText = typeof result.top20WeightedScore === 'number' ? `, Top-20 Weighted=${result.top20WeightedScore.toFixed(1)}%` : '';
    const top10OverlapText = result.top10Details ? `, Top-10 Overlap=${result.top10Details.overlapCount}/10` : '';
    const top20OverlapText = result.top20Details ? `, Top-20 Overlap=${result.top20Details.overlapCount}/20` : '';
    const subsetEval = result.adjusted?.subset || null;
    const percentileEval = result.adjusted?.percentile || null;
    const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? `, Subset RMSE=${subsetEval.rmse.toFixed(2)}` : '';
    const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `, Subset Top-20=${subsetEval.top20.toFixed(1)}%` : '';
    const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? `, Pct RMSE=${percentileEval.rmse.toFixed(2)}` : '';
    const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `, Pct Top-20=${percentileEval.top20.toFixed(1)}%` : '';
    const stress = evaluateStressTest(result, {
      minPlayers: 20,
      minCorr: 0.1,
      minTop20Weighted: 60
    });
    const stressText = stress.status
      ? `, Stress=${stress.status.toUpperCase()}${stress.reason ? ` (${stress.reason})` : ''}`
      : '';
    textLines.push(
      `  ${year}: Corr=${result.correlation.toFixed(4)}, R²=${result.rSquared.toFixed(4)}, RMSE=${result.rmse.toFixed(2)}, MAE=${result.mae.toFixed(2)}, Mean Err=${result.meanError.toFixed(2)}, Std Err=${result.stdDevError.toFixed(2)}${top10Text}${top20Text}${top20WeightedText}${subsetRmseText}${subsetTop20Text}${pctRmseText}${pctTop20Text}${stressText}${top10OverlapText}${top20OverlapText}, Players=${result.matchedPlayers}${approachText}`
    );
  });
  textLines.push('');
  textLines.push('STEP 4a: MULTI-YEAR VALIDATION (No-Approach Baseline)');
  textLines.push('Approach mode: none (forced)');
  textLines.push('Functions: runRanking, aggregateYearlyEvaluations (optimizer.js)');
  Object.entries(noApproachMultiYearResults).sort().forEach(([year, result]) => {
    const approachUsage = result.approachUsage || {};
    const approachText = approachUsage.period
      ? `, Approach=${approachUsage.period}/${approachUsage.source || 'n/a'}, Leakage=${approachUsage.leakageFlag || 'n/a'}`
      : '';
    const top10Text = typeof result.top10 === 'number' ? `, Top-10=${result.top10.toFixed(1)}%` : '';
    const top20Text = typeof result.top20 === 'number' ? `, Top-20=${result.top20.toFixed(1)}%` : '';
    const top20WeightedText = typeof result.top20WeightedScore === 'number' ? `, Top-20 Weighted=${result.top20WeightedScore.toFixed(1)}%` : '';
    const top10OverlapText = result.top10Details ? `, Top-10 Overlap=${result.top10Details.overlapCount}/10` : '';
    const top20OverlapText = result.top20Details ? `, Top-20 Overlap=${result.top20Details.overlapCount}/20` : '';
    const subsetEval = result.adjusted?.subset || null;
    const percentileEval = result.adjusted?.percentile || null;
    const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? `, Subset RMSE=${subsetEval.rmse.toFixed(2)}` : '';
    const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `, Subset Top-20=${subsetEval.top20.toFixed(1)}%` : '';
    const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? `, Pct RMSE=${percentileEval.rmse.toFixed(2)}` : '';
    const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `, Pct Top-20=${percentileEval.top20.toFixed(1)}%` : '';
    const stress = evaluateStressTest(result, {
      minPlayers: 20,
      minCorr: 0.1,
      minTop20Weighted: 60
    });
    const stressText = stress.status
      ? `, Stress=${stress.status.toUpperCase()}${stress.reason ? ` (${stress.reason})` : ''}`
      : '';
    textLines.push(
      `  ${year}: Corr=${result.correlation.toFixed(4)}, R²=${result.rSquared.toFixed(4)}, RMSE=${result.rmse.toFixed(2)}, MAE=${result.mae.toFixed(2)}, Mean Err=${result.meanError.toFixed(2)}, Std Err=${result.stdDevError.toFixed(2)}${top10Text}${top20Text}${top20WeightedText}${subsetRmseText}${subsetTop20Text}${pctRmseText}${pctTop20Text}${stressText}${top10OverlapText}${top20OverlapText}, Players=${result.matchedPlayers}${approachText}`
    );
  });
  textLines.push('');
  textLines.push('STEP 4b: MULTI-YEAR VALIDATION (Optimized)');
  textLines.push(`Approach mode: ${VALIDATION_APPROACH_MODE}`);
  textLines.push('Functions: runRanking, aggregateYearlyEvaluations (optimizer.js)');
  Object.entries(optimizedMultiYearResults).sort().forEach(([year, result]) => {
    const approachUsage = result.approachUsage || {};
    const approachText = approachUsage.period
      ? `, Approach=${approachUsage.period}/${approachUsage.source || 'n/a'}, Leakage=${approachUsage.leakageFlag || 'n/a'}`
      : '';
    const top10Text = typeof result.top10 === 'number' ? `, Top-10=${result.top10.toFixed(1)}%` : '';
    const top20Text = typeof result.top20 === 'number' ? `, Top-20=${result.top20.toFixed(1)}%` : '';
    const top20WeightedText = typeof result.top20WeightedScore === 'number' ? `, Top-20 Weighted=${result.top20WeightedScore.toFixed(1)}%` : '';
    const top10OverlapText = result.top10Details ? `, Top-10 Overlap=${result.top10Details.overlapCount}/10` : '';
    const top20OverlapText = result.top20Details ? `, Top-20 Overlap=${result.top20Details.overlapCount}/20` : '';
    const subsetEval = result.adjusted?.subset || null;
    const percentileEval = result.adjusted?.percentile || null;
    const subsetRmseText = subsetEval && typeof subsetEval.rmse === 'number' ? `, Subset RMSE=${subsetEval.rmse.toFixed(2)}` : '';
    const subsetTop20Text = subsetEval && typeof subsetEval.top20 === 'number' ? `, Subset Top-20=${subsetEval.top20.toFixed(1)}%` : '';
    const pctRmseText = percentileEval && typeof percentileEval.rmse === 'number' ? `, Pct RMSE=${percentileEval.rmse.toFixed(2)}` : '';
    const pctTop20Text = percentileEval && typeof percentileEval.top20 === 'number' ? `, Pct Top-20=${percentileEval.top20.toFixed(1)}%` : '';
    const stress = evaluateStressTest(result, {
      minPlayers: 20,
      minCorr: 0.1,
      minTop20Weighted: 60
    });
    const stressText = stress.status
      ? `, Stress=${stress.status.toUpperCase()}${stress.reason ? ` (${stress.reason})` : ''}`
      : '';
    textLines.push(
      `  ${year}: Corr=${result.correlation.toFixed(4)}, R²=${result.rSquared.toFixed(4)}, RMSE=${result.rmse.toFixed(2)}, MAE=${result.mae.toFixed(2)}, Mean Err=${result.meanError.toFixed(2)}, Std Err=${result.stdDevError.toFixed(2)}${top10Text}${top20Text}${top20WeightedText}${subsetRmseText}${subsetTop20Text}${pctRmseText}${pctTop20Text}${stressText}${top10OverlapText}${top20OverlapText}, Players=${result.matchedPlayers}${approachText}`
    );
  });
  textLines.push('');
  textLines.push('APPROACH USAGE SUMMARY (Multi-Year Validation)');
  const approachTableLines = formatApproachUsageTable(baselineMultiYearResults);
  if (approachTableLines.length === 0) {
    textLines.push('  No approach usage data available.');
  } else {
    approachTableLines.forEach(line => textLines.push(line));
  }
  textLines.push('');
    textLines.push('EVENT K-FOLD SETTINGS');
    textLines.push(`  EVENT_KFOLD_K: ${resolveKFoldTag(process.env.EVENT_KFOLD_K).tag}`);
    textLines.push(`  EVENT_KFOLD_SEED: ${process.env.EVENT_KFOLD_SEED || (OPT_SEED_RAW || `${CURRENT_EVENT_ID}-${CURRENT_SEASON}`)}`);
    textLines.push(`  OPT_SEED: ${OPT_SEED_RAW || 'n/a'}`);
    textLines.push('');
  textLines.push('STEP 4a: EVENT K-FOLD VALIDATION (Baseline)');
  Object.entries(baselineEventKFold).sort().forEach(([year, result]) => {
    if (!result || result.status !== 'ok') {
      textLines.push(`  ${year}: unavailable (${result?.reason || 'n/a'})`);
      return;
    }
    const approachUsage = result.approachUsage || {};
    const approachText = approachUsage.period
      ? `, Approach=${approachUsage.period}/${approachUsage.source || 'n/a'}, Leakage=${approachUsage.leakageFlag || 'n/a'}`
      : '';
    const evaluation = result.evaluation || {};
    const top10Text = typeof evaluation.top10 === 'number' ? `, Top-10=${evaluation.top10.toFixed(1)}%` : '';
    const top20Text = typeof evaluation.top20 === 'number' ? `, Top-20=${evaluation.top20.toFixed(1)}%` : '';
    const top20WeightedText = typeof evaluation.top20WeightedScore === 'number' ? `, Top-20 Weighted=${evaluation.top20WeightedScore.toFixed(1)}%` : '';
    textLines.push(
      `  ${year}: mode=${result.mode || 'n/a'}, folds=${result.foldsUsed}/${result.foldCount || 'n/a'}, Corr=${evaluation.correlation?.toFixed(4) || 'n/a'}, RMSE=${evaluation.rmse?.toFixed(2) || 'n/a'}${top10Text}${top20Text}${top20WeightedText}, Players=${evaluation.matchedPlayers || 'n/a'}${approachText}`
    );
    if (Array.isArray(result.folds) && result.folds.length > 0) {
      result.folds.forEach(fold => {
        const foldCorr = typeof fold.correlation === 'number' ? fold.correlation.toFixed(4) : 'n/a';
        const foldRmse = typeof fold.rmse === 'number' ? fold.rmse.toFixed(2) : 'n/a';
        const foldTop10 = typeof fold.top10 === 'number' ? `${fold.top10.toFixed(1)}%` : 'n/a';
        const foldTop20 = typeof fold.top20 === 'number' ? `${fold.top20.toFixed(1)}%` : 'n/a';
        const foldTop20W = typeof fold.top20WeightedScore === 'number' ? `${fold.top20WeightedScore.toFixed(1)}%` : 'n/a';
        textLines.push(
          `    Fold ${fold.fold}: events=${fold.eventCount}, trainRows=${fold.trainingRows}, testRows=${fold.testRows}, players=${fold.matchedPlayers}, Corr=${foldCorr}, RMSE=${foldRmse}, Top-10=${foldTop10}, Top-20=${foldTop20}, Top-20W=${foldTop20W}`
        );
      });
    }
  });
  textLines.push('');
  textLines.push('STEP 4b: EVENT K-FOLD VALIDATION (Optimized)');
  Object.entries(optimizedEventKFold).sort().forEach(([year, result]) => {
    if (!result || result.status !== 'ok') {
      textLines.push(`  ${year}: unavailable (${result?.reason || 'n/a'})`);
      return;
    }
    const approachUsage = result.approachUsage || {};
    const approachText = approachUsage.period
      ? `, Approach=${approachUsage.period}/${approachUsage.source || 'n/a'}, Leakage=${approachUsage.leakageFlag || 'n/a'}`
      : '';
    const evaluation = result.evaluation || {};
    const top10Text = typeof evaluation.top10 === 'number' ? `, Top-10=${evaluation.top10.toFixed(1)}%` : '';
    const top20Text = typeof evaluation.top20 === 'number' ? `, Top-20=${evaluation.top20.toFixed(1)}%` : '';
    const top20WeightedText = typeof evaluation.top20WeightedScore === 'number' ? `, Top-20 Weighted=${evaluation.top20WeightedScore.toFixed(1)}%` : '';
    textLines.push(
      `  ${year}: mode=${result.mode || 'n/a'}, folds=${result.foldsUsed}/${result.foldCount || 'n/a'}, Corr=${evaluation.correlation?.toFixed(4) || 'n/a'}, RMSE=${evaluation.rmse?.toFixed(2) || 'n/a'}${top10Text}${top20Text}${top20WeightedText}, Players=${evaluation.matchedPlayers || 'n/a'}${approachText}`
    );
    if (Array.isArray(result.folds) && result.folds.length > 0) {
      result.folds.forEach(fold => {
        const foldCorr = typeof fold.correlation === 'number' ? fold.correlation.toFixed(4) : 'n/a';
        const foldRmse = typeof fold.rmse === 'number' ? fold.rmse.toFixed(2) : 'n/a';
        const foldTop10 = typeof fold.top10 === 'number' ? `${fold.top10.toFixed(1)}%` : 'n/a';
        const foldTop20 = typeof fold.top20 === 'number' ? `${fold.top20.toFixed(1)}%` : 'n/a';
        const foldTop20W = typeof fold.top20WeightedScore === 'number' ? `${fold.top20WeightedScore.toFixed(1)}%` : 'n/a';
        textLines.push(
          `    Fold ${fold.fold}: events=${fold.eventCount}, trainRows=${fold.trainingRows}, testRows=${fold.testRows}, players=${fold.matchedPlayers}, Corr=${foldCorr}, RMSE=${foldRmse}, Top-10=${foldTop10}, Top-20=${foldTop20}, Top-20W=${foldTop20W}`
        );
      });
    }
  });
  textLines.push('');
  textLines.push('EVENT K-FOLD INTERPRETATION');
  if (!baselineEventKFoldSummary || !optimizedEventKFoldSummary || baselineEventKFoldSummary.matchedPlayers === 0 || optimizedEventKFoldSummary.matchedPlayers === 0) {
    textLines.push('  Insufficient event K-fold data to interpret (check folds used / matched players).');
  } else {
    const formatDist = (stats, decimals = 4) => {
      if (!stats || !stats.count) return 'n/a';
      const median = stats.median?.toFixed(decimals) ?? 'n/a';
      const p25 = stats.p25?.toFixed(decimals) ?? 'n/a';
      const p75 = stats.p75?.toFixed(decimals) ?? 'n/a';
      const iqr = stats.iqr?.toFixed(decimals) ?? 'n/a';
      return `median=${median}, IQR=${iqr} (p25=${p25}, p75=${p75})`;
    };
    const corrDelta = optimizedEventKFoldSummary.correlation - baselineEventKFoldSummary.correlation;
    const rmseDelta = optimizedEventKFoldSummary.rmse - baselineEventKFoldSummary.rmse;
    const top20WDelta = optimizedEventKFoldSummary.top20WeightedScore - baselineEventKFoldSummary.top20WeightedScore;
    let verdict = 'No material change vs baseline.';
    if (corrDelta > 0.02 && rmseDelta < 0 && top20WDelta > 0) {
      verdict = 'Strong improvement: higher rank agreement, lower error, better Top-20 weighted score.';
    } else if (corrDelta > 0.01 && rmseDelta <= 0) {
      verdict = 'Improvement: better correlation with equal or lower error.';
    } else if (corrDelta > 0.01 && rmseDelta > 0) {
      verdict = 'Mixed: correlation improved but errors increased.';
    } else if (corrDelta < -0.01) {
      verdict = 'Regression: optimized weights underperform baseline across folds.';
    }
    textLines.push(`  ${verdict}`);
    textLines.push(`  Δ Corr: ${corrDelta.toFixed(4)} | Δ RMSE: ${rmseDelta.toFixed(2)} | Δ Top-20W: ${top20WDelta.toFixed(1)}%`);
    textLines.push(`  Baseline: Corr=${baselineEventKFoldSummary.correlation.toFixed(4)}, RMSE=${baselineEventKFoldSummary.rmse.toFixed(2)}, Top-20W=${baselineEventKFoldSummary.top20WeightedScore.toFixed(1)}%`);
    textLines.push(`  Optimized: Corr=${optimizedEventKFoldSummary.correlation.toFixed(4)}, RMSE=${optimizedEventKFoldSummary.rmse.toFixed(2)}, Top-20W=${optimizedEventKFoldSummary.top20WeightedScore.toFixed(1)}%`);
    textLines.push(`  Baseline fold dist (Corr): ${formatDist(baselineEventKFoldSummary.foldStats?.correlation, 4)}`);
    textLines.push(`  Optimized fold dist (Corr): ${formatDist(optimizedEventKFoldSummary.foldStats?.correlation, 4)}`);
    textLines.push(`  Baseline fold dist (RMSE): ${formatDist(baselineEventKFoldSummary.foldStats?.rmse, 2)}`);
    textLines.push(`  Optimized fold dist (RMSE): ${formatDist(optimizedEventKFoldSummary.foldStats?.rmse, 2)}`);
    if (baselineEventKFoldSummary.confidence) {
      textLines.push(`  Baseline confidence: ${(baselineEventKFoldSummary.confidence.score * 100).toFixed(0)}% - ${baselineEventKFoldSummary.confidence.note}`);
    }
    if (optimizedEventKFoldSummary.confidence) {
      textLines.push(`  Optimized confidence: ${(optimizedEventKFoldSummary.confidence.score * 100).toFixed(0)}% - ${optimizedEventKFoldSummary.confidence.note}`);
    }
    textLines.push('  Interpretation: Higher confidence means fold results are more stable and reliable.');
  }
  textLines.push('');
  textLines.push('RECOMMENDATION:');
  if (kfoldGateApplied) {
    textLines.push(`K-fold regression detected; ${recommendationApproach}`);
    textLines.push(`Note: ${recommendationNote}`);
  } else if (improvement > 0.01) {
    textLines.push(`${recommendationApproach} (improvement: ${(improvement).toFixed(4)})`);
  } else if (improvement > 0) {
    textLines.push(`${recommendationApproach} (${(improvement).toFixed(4)}), consider baseline`);
  } else {
    textLines.push(`${recommendationApproach}`);
  }
  textLines.push('');
  textLines.push('STANDARD TEMPLATE SELECTION:');
  textLines.push(`  Selected: ${effectiveStandardTemplateKey || 'none'}`);
  textLines.push(`  Source: ${effectiveStandardTemplateSource}`);
  if (effectiveStandardTemplateRaw) {
    textLines.push(`  Raw: ${effectiveStandardTemplateRaw}`);
  }
  if (validationCourseType) {
    textLines.push(`  Validation Course Type: ${validationCourseType}`);
  }
  textLines.push('');
  textLines.push('TEMPLATE WRITE SUMMARY:');
  if (eventTemplateAction) {
    const actionLabel = eventTemplateAction === 'dryRun' ? 'dry-run output' : 'write';
    textLines.push(`Event template (${optimizedTemplateName}): ${actionLabel}`);
    eventTemplateTargets.forEach(target => textLines.push(`  - ${target}`));
  } else {
    textLines.push(`Event template (${optimizedTemplateName}): not written`);
  }
  if (validationTemplateActions.length > 0) {
    validationTemplateActions.forEach(entry => {
      const actionLabel = entry.action === 'dryRun' ? 'dry-run output' : 'write';
      textLines.push(`Standard template (${entry.name}): ${actionLabel}`);
      textLines.push(`  - ${entry.target}`);
    });
  } else {
    if (validationIsRecommendation && typeof validationImprovementPct === 'number' && validationImprovementPct < 0.01) {
      textLines.push('Standard templates: no updates (validation improvement < 1%)');
    } else {
      textLines.push('Standard templates: no updates');
    }
  }
  textLines.push('');
  textLines.push('---');
  textLines.push('');
  humanSummaryLines.forEach(line => textLines.push(line));
  textLines.push('');
  const textOutputPath = buildArtifactPath({
    artifactType: OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_TXT,
    outputBaseName,
    tournamentSlug: canonicalTournamentSlug || normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback),
    tournamentName: TOURNAMENT_NAME || tournamentNameFallback,
    modeRoot: OUTPUT_DIR
  });
  const backupTextPath = backupIfExists(textOutputPath);
  if (backupTextPath) {
    console.log(`🗄️  Backed up previous text results to: ${backupTextPath}`);
  }
  fs.writeFileSync(textOutputPath, textLines.join('\n'));
  resultsTextPath = textOutputPath;

  const optimizedTop20Desc = typeof bestOptimized.top20 === 'number' ? `${bestOptimized.top20.toFixed(1)}%` : 'n/a';
  const optimizedTop20WeightedDesc = typeof bestOptimized.top20WeightedScore === 'number' ? `${bestOptimized.top20WeightedScore.toFixed(1)}%` : 'n/a';

  const invertedLabelSet = buildInvertedLabelSet(currentGeneratedTop20Correlations);
  const metricWeightsWithInversions = applyInversionsToMetricWeights(
    metricConfig,
    bestOptimized.metricWeights || bestTemplate.metricWeights,
    invertedLabelSet
  );

  const optimizedTemplate = {
    name: courseTemplateKey,
    eventId: String(CURRENT_EVENT_ID),
    description: `${TOURNAMENT_NAME || 'Event'} ${CURRENT_SEASON || ''} Optimized: ${bestOptimized.correlation.toFixed(4)} corr, ${optimizedTop20Desc} Top-20, ${optimizedTop20WeightedDesc} Top-20 Weighted`,
    groupWeights: bestOptimized.weights,
    metricWeights: nestMetricWeights(metricWeightsWithInversions)
  };

  const baselineTemplateForCompare = {
    groupWeights: baselineTemplate.groupWeights,
    metricWeights: baselineTemplate.metricWeights
  };
  const optimizedTemplateForCompare = {
    groupWeights: bestOptimized.weights,
    metricWeights: bestOptimized.metricWeights || bestTemplate.metricWeights
  };
  const optimizedBeatsBaseline = compareEvaluations(bestOptimized, baselineEvaluation) > 0;
  const recommendationAllowsWrite = recommendationApproach === 'Use optimized weights';
  const shouldWriteEventTemplate = optimizedBeatsBaseline
    && recommendationAllowsWrite
    && templatesAreDifferent(
    optimizedTemplateForCompare,
    baselineTemplateForCompare,
    metricConfig,
    1e-4
  );
  const allowDryRunTemplateOutputs = DRY_RUN;
  const shouldAttemptEventWrite = shouldWriteEventTemplate && (WRITE_TEMPLATES || allowDryRunTemplateOutputs);
  if (!shouldWriteEventTemplate) {
    const reason = !recommendationAllowsWrite
      ? 'recommendation gate'
      : 'optimized weights match baseline';
    console.log(`ℹ️  Event template not written (${reason}).`);
  }

  const allowStandardTemplateUpdates = (WRITE_TEMPLATES || DRY_RUN);
  const validationTemplatesToWrite = (allowStandardTemplateUpdates && validationTypeToUpdate && shouldUpdateStandardTemplate)
    ? [buildValidationTemplateForType({
        type: validationTypeToUpdate,
        metricConfig,
        validationData,
        templateConfigs,
        eventId: CURRENT_EVENT_ID,
        sourceLabel: validationTemplateSourceLabel
      })]
      .filter(Boolean)
    : [];

  const writeBackTargets = [
    path.resolve(ROOT_DIR, 'utilities', 'weightTemplates.js')
  ];

  writeBackTargets.forEach(filePath => {
    if (shouldAttemptEventWrite) {
      const result = upsertTemplateInFile(filePath, optimizedTemplate, { replaceByEventId: true, dryRun: DRY_RUN });
      if (result.updated) {
        if (DRY_RUN && result.content) {
          const dryRunPath = path.resolve(dryRunOutputDir || OUTPUT_DIR, `dryrun_${path.basename(filePath)}`);
          fs.writeFileSync(dryRunPath, result.content, 'utf8');
          console.log(`🧪 Dry-run template output saved to: ${dryRunPath}`);
          eventTemplateAction = 'dryRun';
          eventTemplateTargets.push(dryRunPath);
        } else {
          console.log(`✅ Template written to: ${filePath}`);
          eventTemplateAction = 'write';
          eventTemplateTargets.push(filePath);
        }
      } else {
        console.warn(`⚠️  Template not written (unable to update): ${filePath}`);
      }
    }

    if (validationTemplatesToWrite.length > 0) {
      validationTemplatesToWrite.forEach(validationTemplate => {
        const existingTemplate = templateConfigs?.[validationTemplate.name] || null;
        const differs = templatesAreDifferent(validationTemplate, existingTemplate, metricConfig, 1e-4);
        if (!differs) {
          console.log(`ℹ️  Validation template matches existing ${validationTemplate.name}; skipping update.`);
          return;
        }
        const validationResult = upsertTemplateInFile(filePath, validationTemplate, { replaceByEventId: false, dryRun: DRY_RUN });
        if (validationResult.updated) {
          if (DRY_RUN && validationResult.content) {
            const dryRunPath = path.resolve(dryRunOutputDir || OUTPUT_DIR, `dryrun_${validationTemplate.name}_${path.basename(filePath)}`);
            fs.writeFileSync(dryRunPath, validationResult.content, 'utf8');
            console.log(`🧪 Dry-run validation template saved to: ${dryRunPath}`);
            validationTemplateActions.push({
              name: validationTemplate.name,
              action: 'dryRun',
              target: dryRunPath
            });
          } else {
            console.log(`✅ Validation template written to: ${filePath} (${validationTemplate.name})`);
            validationTemplateActions.push({
              name: validationTemplate.name,
              action: 'write',
              target: filePath
            });
          }
        } else {
          console.warn(`⚠️  Validation template not written (unable to update): ${filePath} (${validationTemplate.name})`);
        }
      });
    }
  });

  console.log('\n🧾 Template write summary:');
  if (eventTemplateAction) {
    const actionLabel = eventTemplateAction === 'dryRun' ? 'dry-run output' : 'write';
    console.log(`   Event template (${optimizedTemplate.name}): ${actionLabel}`);
    eventTemplateTargets.forEach(target => console.log(`     - ${target}`));
  } else {
    console.log(`   Event template (${optimizedTemplate.name}): not written`);
  }

  if (validationTemplateActions.length > 0) {
    validationTemplateActions.forEach(entry => {
      const actionLabel = entry.action === 'dryRun' ? 'dry-run output' : 'write';
      console.log(`   Standard template (${entry.name}): ${actionLabel}`);
      console.log(`     - ${entry.target}`);
    });
  } else {
    console.log('   Standard templates: no updates');
  }

  console.log(`✅ JSON results also saved to: ${outputPath}`);
  console.log(`✅ Text results saved to: ${textOutputPath}\n`);

  try {
    const { runValidation } = require('./validationRunner');
    if (typeof runValidation === 'function') {
      const validationSlug = normalizeTournamentSlug(TOURNAMENT_NAME || tournamentNameFallback) || baseName;
      console.log(`🔄 Running validation runner (post-tournament, slug=${validationSlug})...`);
      const validationWriteTemplates = WRITE_VALIDATION_TEMPLATES;
      const validationDryRun = validationWriteTemplates && DRY_RUN;
      const validationResult = await runValidation({
        season: CURRENT_SEASON,
        dataRootDir: DATA_ROOT_DIR,
        tournamentName: TOURNAMENT_NAME,
        tournamentSlug: validationSlug,
        tournamentDir,
        eventId: CURRENT_EVENT_ID,
        writeTemplates: validationWriteTemplates,
        dryRun: validationDryRun,
        dryRunDir: null
      });
      if (validationResult?.inputSummary) {
        validationRunSummary = validationResult.inputSummary;
      }
      console.log(`✅ Validation outputs written to: ${validationResult.outputDir}`);
    }
  } catch (error) {
    console.warn(`⚠️  Validation runner failed: ${error.message}`);
  }

  emitCleanSummaryLog({ humanSummaryLines });

  const shouldSummarizeSeeds = !!OPT_SEED_RAW || (OUTPUT_DIR && path.basename(OUTPUT_DIR) === 'seed_runs');
  if (shouldSummarizeSeeds) {
    const summaryScript = path.resolve(ROOT_DIR, 'scripts', 'summarizeSeedResults.js');
    if (!fs.existsSync(summaryScript)) {
      console.warn(`⚠️  Seed summary script not found: ${summaryScript}`);
    } else {
      const outputTagRaw = String(process.env.OUTPUT_TAG || '').trim();
      if (outputTagRaw) {
        process.env.SKIP_SEED_CLEANUP = 'true';
      }
      const summaryArgs = [
        summaryScript,
        '--tournament', TOURNAMENT_NAME || tournamentNameFallback,
        '--event', String(CURRENT_EVENT_ID || ''),
        '--season', String(CURRENT_SEASON || ''),
        '--outputDir', OUTPUT_DIR
      ];
      const summaryResult = spawnSync('node', summaryArgs, { stdio: 'inherit' });
      if (summaryResult.error) {
        console.warn(`⚠️  Seed summary failed: ${summaryResult.error.message}`);
      } else if (summaryResult.status !== 0) {
        console.warn(`⚠️  Seed summary exited with code ${summaryResult.status}`);
      }
    }
  } else {
    console.log('ℹ️  Seed summary skipped (not a seed run).');
  }
}

runAdaptiveOptimizer().catch(error => {
  console.error(`\n❌ Optimizer failed: ${error.message}`);
  process.exit(1);
});