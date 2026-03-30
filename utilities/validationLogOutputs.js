const fs = require('fs');
const path = require('path');
const { ensureDirectory } = require('./fileUtils');
const { formatTimestamp } = require('./timeUtils');
const { OUTPUT_NAMES } = require('./validationOutputNames');

const writeModelDeltaTrends = (outputDir, modelDeltaTrends) => {
  ensureDirectory(outputDir);
  const jsonPath = path.resolve(outputDir, `${OUTPUT_NAMES.modelDeltaTrends}.json`);
  const csvPath = path.resolve(outputDir, `${OUTPUT_NAMES.modelDeltaTrends}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify(modelDeltaTrends, null, 2));

  const toCsvRow = values => values
    .map(value => (value === null || value === undefined ? '' : JSON.stringify(value)))
    .join(',');

  const lines = [];
  lines.push(toCsvRow(['MODEL DELTA TRENDS - All Metrics (Model - Actual)']));
  lines.push(toCsvRow(['Green = stable (low bias), Yellow = watch, Red = chronic bias']));
  lines.push('');
  lines.push(toCsvRow([
    'Metric',
    'Count',
    'Mean Δ',
    'Mean |Δ|',
    'Std Dev',
    'Bias Z',
    'Over %',
    'Under %',
    'Status'
  ]));

  modelDeltaTrends.metrics.forEach(entry => {
    lines.push(toCsvRow([
      entry.metric,
      entry.count,
      entry.meanDelta.toFixed(3),
      entry.meanAbsDelta.toFixed(3),
      entry.stdDev.toFixed(3),
      entry.biasZ.toFixed(2),
      `${entry.overPct.toFixed(2)}%`,
      `${entry.underPct.toFixed(2)}%`,
      entry.status
    ]));
  });

  fs.writeFileSync(csvPath, lines.join('\n'));
  return { jsonPath, csvPath };
};

const writeProcessingLog = (outputDir, details) => {
  ensureDirectory(outputDir);
  const jsonPath = path.resolve(outputDir, `${OUTPUT_NAMES.processingLog}.json`);
  const outputs = Array.isArray(details?.outputs)
    ? details.outputs.map(entry => ({
        ...entry,
        overwritten: !!entry?.existedBefore && entry?.written !== false
      }))
    : [];
  const payload = {
    generatedAt: formatTimestamp(new Date()),
    ...details,
    outputs
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  return { jsonPath };
};

module.exports = {
  writeModelDeltaTrends,
  writeProcessingLog
};
