/**
 * Module: validationOutputs
 * Purpose: Formatting + write helpers for validation artifacts.
 */

const path = require('path');
const { formatTimestamp } = require('./timeUtils');
const { readJsonFile, writeJsonFile } = require('./fileUtils');
const { OUTPUT_ARTIFACTS } = require('./outputPaths');
const { OUTPUT_NAMES } = require('./validationOutputNames');
const {
  writeTournamentResultsCsv,
  writeTournamentResultsSnapshot,
  writeResultsSheetCsv
} = require('./validationResultsOutputs');
const {
  writeModelDeltaTrends,
  writeProcessingLog
} = require('./validationLogOutputs');
const { writeCourseTypeClassification } = require('./validationClassificationOutputs');
const { writeMetricAnalysis } = require('./validationMetricOutputs');
const { buildCorrelationSummary } = require('./validationSummaries');
const {
  writeCorrelationSummary,
  writeWeightCalibrationGuide,
  writeWeightTemplatesOutput,
  updateBaselineTemplatesFile
} = require('./validationTemplateOutputs');
const { writeSeasonPostEventSummary } = require('./validationPostEventOutputs');
const { writeCalibrationReport } = require('./validationCalibrationOutputs');
const { writeApproachSnapshotIfUpdated } = require('./approachSnapshots');

const STANDARD_TEMPLATE_TYPES = new Set(['POWER', 'TECHNICAL', 'BALANCED']);

const updateCourseContextCourseTypes = ({ courseContextPath, classificationPayload, logger = console, dryRun = false } = {}) => {
  if (!courseContextPath || !classificationPayload || !Array.isArray(classificationPayload.entries)) {
    return { updated: false, updates: [], skipped: [] };
  }

  const courseContext = readJsonFile(courseContextPath);
  if (!courseContext || typeof courseContext !== 'object') {
    logger.warn('ℹ️  Course context unavailable; skipping courseType updates.');
    return { updated: false, updates: [], skipped: [{ reason: 'missing_context' }] };
  }

  if (!courseContext.byEventId || typeof courseContext.byEventId !== 'object') {
    courseContext.byEventId = {};
  }

  const updates = [];
  const skipped = [];
  let updated = false;

  classificationPayload.entries.forEach(entry => {
    const eventId = entry?.eventId !== undefined && entry?.eventId !== null
      ? String(entry.eventId).trim()
      : '';
    const courseTypeRaw = entry?.courseType ? String(entry.courseType).trim().toUpperCase() : '';
    if (!eventId || !courseTypeRaw || !STANDARD_TEMPLATE_TYPES.has(courseTypeRaw)) return;

    const contextEntry = courseContext.byEventId[eventId];
    if (!contextEntry) {
      skipped.push({ eventId, courseType: courseTypeRaw, reason: 'missing_event_entry' });
      return;
    }

    const existingType = contextEntry.courseType ? String(contextEntry.courseType).trim().toUpperCase() : null;
    if (existingType === courseTypeRaw) return;

    contextEntry.courseType = courseTypeRaw;
    updates.push({ eventId, from: existingType, to: courseTypeRaw });
    updated = true;
  });

  if (updated) {
    courseContext.updatedAt = formatTimestamp(new Date());
  }

  if (updated && !dryRun) {
    writeJsonFile(courseContextPath, courseContext);
    logger.log(`✓ Updated course_context courseType for ${updates.length} event(s).`);
  } else if (updated && dryRun) {
    logger.log(`🧪 Dry-run: would update course_context courseType for ${updates.length} event(s).`);
  } else {
    logger.log('ℹ️  Course context courseType already aligned; no updates needed.');
  }

  return { updated, updates, skipped };
};

const writeCorrelationSummaryOutputs = ({
  outputDir,
  validationSubdirs,
  outputArtifacts,
  summariesByType,
  byType,
  season,
  trackOutput,
  recordOutput
} = {}) => {
  if (!outputDir || !outputArtifacts) {
    return { correlationSummaries: null };
  }

  const powerCorrelationJsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_JSON,
    templateName: 'POWER'
  });
  const powerCorrelationCsvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_CSV,
    templateName: 'POWER'
  });
  const technicalCorrelationJsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_JSON,
    templateName: 'TECHNICAL'
  });
  const technicalCorrelationCsvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_CSV,
    templateName: 'TECHNICAL'
  });
  const balancedCorrelationJsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_JSON,
    templateName: 'BALANCED'
  });
  const balancedCorrelationCsvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_TEMPLATE_CORRELATION_SUMMARY_CSV,
    templateName: 'BALANCED'
  });

  if (trackOutput) {
    trackOutput('powerCorrelationSummary.json', powerCorrelationJsonPath);
    trackOutput('powerCorrelationSummary.csv', powerCorrelationCsvPath);
    trackOutput('technicalCorrelationSummary.json', technicalCorrelationJsonPath);
    trackOutput('technicalCorrelationSummary.csv', technicalCorrelationCsvPath);
    trackOutput('balancedCorrelationSummary.json', balancedCorrelationJsonPath);
    trackOutput('balancedCorrelationSummary.csv', balancedCorrelationCsvPath);
  }

  const correlationOutputDir = validationSubdirs?.templateCorrelations || outputDir;
  const correlationSummaries = {
    POWER: writeCorrelationSummary(
      correlationOutputDir,
      OUTPUT_NAMES.powerCorrelationSummary,
      summariesByType?.POWER || buildCorrelationSummary(byType?.POWER || []),
      {
        type: 'POWER',
        season,
        tournaments: byType?.POWER?.map(entry => entry.tournament).filter(Boolean) || []
      }
    ),
    TECHNICAL: writeCorrelationSummary(
      correlationOutputDir,
      OUTPUT_NAMES.technicalCorrelationSummary,
      summariesByType?.TECHNICAL || buildCorrelationSummary(byType?.TECHNICAL || []),
      {
        type: 'TECHNICAL',
        season,
        tournaments: byType?.TECHNICAL?.map(entry => entry.tournament).filter(Boolean) || []
      }
    ),
    BALANCED: writeCorrelationSummary(
      correlationOutputDir,
      OUTPUT_NAMES.balancedCorrelationSummary,
      summariesByType?.BALANCED || buildCorrelationSummary(byType?.BALANCED || []),
      {
        type: 'BALANCED',
        season,
        tournaments: byType?.BALANCED?.map(entry => entry.tournament).filter(Boolean) || []
      }
    )
  };

  if (recordOutput) {
    recordOutput('powerCorrelationSummary.json', correlationSummaries?.POWER?.jsonPath);
    recordOutput('powerCorrelationSummary.csv', correlationSummaries?.POWER?.csvPath);
    recordOutput('technicalCorrelationSummary.json', correlationSummaries?.TECHNICAL?.jsonPath);
    recordOutput('technicalCorrelationSummary.csv', correlationSummaries?.TECHNICAL?.csvPath);
    recordOutput('balancedCorrelationSummary.json', correlationSummaries?.BALANCED?.jsonPath);
    recordOutput('balancedCorrelationSummary.csv', correlationSummaries?.BALANCED?.csvPath);
  }

  return { correlationSummaries };
};

const writeWeightOutputSummaries = ({
  outputDir,
  outputArtifacts,
  summariesByType,
  templatesByType,
  typeCounts,
  configInfo,
  typeTournaments,
  top20BlendByTournament,
  trackOutput,
  recordOutput
} = {}) => {
  if (!outputDir || !outputArtifacts) {
    return { weightCalibrationOutputs: null, weightTemplatesOutputs: null };
  }

  const weightCalibrationJsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_CALIBRATION_GUIDE_JSON
  });
  const weightCalibrationCsvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_CALIBRATION_GUIDE_CSV
  });
  if (trackOutput) {
    trackOutput('weightCalibrationGuide.json', weightCalibrationJsonPath);
    trackOutput('weightCalibrationGuide.csv', weightCalibrationCsvPath);
  }
  const weightCalibrationOutputs = writeWeightCalibrationGuide(
    outputDir,
    summariesByType,
    templatesByType,
    typeCounts
  );
  if (recordOutput) {
    recordOutput('weightCalibrationGuide.json', weightCalibrationOutputs?.jsonPath);
    recordOutput('weightCalibrationGuide.csv', weightCalibrationOutputs?.csvPath);
  }

  const weightTemplatesJsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_TEMPLATES_JSON
  });
  const weightTemplatesCsvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_WEIGHT_TEMPLATES_CSV
  });
  if (trackOutput) {
    trackOutput('weightTemplates.json', weightTemplatesJsonPath);
    trackOutput('weightTemplates.csv', weightTemplatesCsvPath);
  }
  const weightTemplatesOutputs = writeWeightTemplatesOutput(outputDir, summariesByType, templatesByType, {
    configInfo,
    typeTournaments,
    top20BlendByTournament
  });
  if (recordOutput) {
    recordOutput('weightTemplates.json', weightTemplatesOutputs?.jsonPath);
    recordOutput('weightTemplates.csv', weightTemplatesOutputs?.csvPath);
  }

  return { weightCalibrationOutputs, weightTemplatesOutputs };
};

const updateBaselineTemplateOutputs = ({
  blendedTemplatesByType,
  writeTemplates = false,
  dryRun = false,
  dryRunDir = null,
  postEventDir = null,
  updateComment = null,
  logger = console
} = {}) => {
  const shouldWriteTemplates = !!writeTemplates;
  const shouldDryRunTemplates = !!dryRun && !shouldWriteTemplates;
  const dryRunTemplateDir = dryRunDir || (postEventDir ? path.resolve(postEventDir, 'dryrun') : null);

  if (shouldWriteTemplates || shouldDryRunTemplates) {
    const updatedPath = updateBaselineTemplatesFile({
      blendedTemplatesByType,
      logger,
      dryRun: shouldDryRunTemplates,
      outputDir: dryRunTemplateDir,
      updateComment
    });
    if (updatedPath) {
      const label = shouldWriteTemplates ? '✓ Updated baseline templates' : '🧪 Dry-run template output saved';
      logger.log(`${label}: ${updatedPath}`);
    }
    return { updatedPath, dryRun: shouldDryRunTemplates };
  }

  logger.log('ℹ️  Baseline templates update skipped (writeTemplates=false, dryRun=false).');
  return { updatedPath: null, dryRun: false };
};

module.exports = {
  OUTPUT_NAMES,
  writeMetricAnalysis,
  writeCourseTypeClassification,
  writeCorrelationSummary,
  writeWeightCalibrationGuide,
  writeWeightTemplatesOutput,
  updateBaselineTemplatesFile,
  writeModelDeltaTrends,
  writeProcessingLog,
  writeSeasonPostEventSummary,
  writeCalibrationReport,
  writeApproachSnapshotIfUpdated,
  writeTournamentResultsCsv,
  writeTournamentResultsSnapshot,
  writeResultsSheetCsv,
  updateCourseContextCourseTypes,
  writeCorrelationSummaryOutputs,
  writeWeightOutputSummaries,
  updateBaselineTemplateOutputs
};
