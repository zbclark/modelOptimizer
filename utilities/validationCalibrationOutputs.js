/**
 * Module: validationCalibrationOutputs
 * Purpose: Formatting + write helpers for validation calibration artifacts.
 */

const fs = require('fs');
const path = require('path');
const { ensureDirectory } = require('./fileUtils');

const writeCalibrationReport = (outputDir, calibrationData, outputName = 'Calibration_Report') => {
  if (!outputDir || !calibrationData || !outputName) return { jsonPath: null, csvPath: null };
  ensureDirectory(outputDir);
  const jsonPath = path.resolve(outputDir, `${outputName}.json`);
  const csvPath = path.resolve(outputDir, `${outputName}.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify(calibrationData, null, 2));

  const toCsvRow = values => values
    .map(value => (value === null || value === undefined ? '' : JSON.stringify(value)))
    .join(',');

  const lines = [];
  lines.push(toCsvRow(['🎯 POST-TOURNAMENT CALIBRATION ANALYSIS']));
  lines.push('');
  lines.push(toCsvRow(['WINNER PREDICTION ACCURACY']));
  lines.push(toCsvRow(['Metric', 'Accuracy', 'Count']));

  const top5Pct = calibrationData.totalTop5 > 0
    ? (calibrationData.predictedTop5InTop20 / calibrationData.totalTop5) * 100
    : 0;
  const top10Pct = calibrationData.totalTop10 > 0
    ? (calibrationData.predictedTop10InTop30 / calibrationData.totalTop10) * 100
    : 0;

  lines.push(toCsvRow([
    'Top 5 finishers in Top 20 predictions',
    `${top5Pct.toFixed(1)}%`,
    `${calibrationData.predictedTop5InTop20}/${calibrationData.totalTop5}`
  ]));
  lines.push(toCsvRow([
    'Top 10 finishers in Top 30 predictions',
    `${top10Pct.toFixed(1)}%`,
    `${calibrationData.predictedTop10InTop30}/${calibrationData.totalTop10}`
  ]));

  lines.push('');
  lines.push(toCsvRow(['TOURNAMENT BREAKDOWN']));
  lines.push(toCsvRow(['Tournament', 'Top Finishers', 'Avg Miss (T5)', 'Top 5 Accuracy', 'Notes']));

  const tournaments = Array.isArray(calibrationData.tournaments)
    ? [...calibrationData.tournaments]
    : [];
  tournaments.sort((a, b) => (a?.accuracyMetrics?.avgMissTop5 || 0) - (b?.accuracyMetrics?.avgMissTop5 || 0));

  tournaments.forEach(tournament => {
    const top5 = tournament.topFinishers.filter(entry => entry.actualFinish <= 5);
    const top5Pred = top5.filter(entry => entry.predictedRank <= 20).length;
    const top5Acc = top5.length > 0 ? (top5Pred / top5.length) * 100 : null;
    const notes = top5.length === 0
      ? 'N/A'
      : (top5Pred === top5.length ? '✓ Perfect' : (top5Pred > 0 ? '~ Partial' : '✗ Missed'));

    lines.push(toCsvRow([
      tournament.name,
      tournament.topFinishers.length,
      tournament.accuracyMetrics.avgMissTop5.toFixed(1),
      top5Acc === null ? 'N/A' : `${top5Acc.toFixed(0)}%`,
      notes
    ]));
  });

  lines.push('');
  if (calibrationData?.calibrationBuckets?.buckets?.length) {
    lines.push(toCsvRow(['RANK CALIBRATION (DECILES)']));
    lines.push(toCsvRow(['Predicted Rank Percentile', 'Count', 'Top 5 Rate', 'Top 10 Rate', 'Top 20 Rate']));

    calibrationData.calibrationBuckets.buckets.forEach(bucket => {
      const count = bucket.count || 0;
      const top5Rate = count > 0 ? (bucket.top5 / count) * 100 : 0;
      const top10Rate = count > 0 ? (bucket.top10 / count) * 100 : 0;
      const top20Rate = count > 0 ? (bucket.top20 / count) * 100 : 0;
      const label = `${Math.round(bucket.minPct * 100)}-${Math.round(bucket.maxPct * 100)}%`;
      lines.push(toCsvRow([
        label,
        count,
        `${top5Rate.toFixed(1)}%`,
        `${top10Rate.toFixed(1)}%`,
        `${top20Rate.toFixed(1)}%`
      ]));
    });

    lines.push('');
  }

  if (calibrationData?.plattCalibration) {
    const top10 = calibrationData.plattCalibration.top10 || {};
    const top20 = calibrationData.plattCalibration.top20 || {};
    lines.push(toCsvRow(['PLATT CALIBRATION (rank percentile → probability)']));
    lines.push(toCsvRow(['Target', 'Samples', 'a', 'b', 'LogLoss', 'Brier', 'BaseRate']));

    if (top10.available) {
      lines.push(toCsvRow([
        'Top 10',
        top10.samples,
        top10.a.toFixed(4),
        top10.b.toFixed(4),
        top10.logLoss.toFixed(4),
        top10.brier.toFixed(4),
        top10.baseRate.toFixed(4)
      ]));
    } else {
      lines.push(toCsvRow(['Top 10', top10.reason || 'unavailable']));
    }

    if (top20.available) {
      lines.push(toCsvRow([
        'Top 20',
        top20.samples,
        top20.a.toFixed(4),
        top20.b.toFixed(4),
        top20.logLoss.toFixed(4),
        top20.brier.toFixed(4),
        top20.baseRate.toFixed(4)
      ]));
    } else {
      lines.push(toCsvRow(['Top 20', top20.reason || 'unavailable']));
    }

    const describePlatt = (label, entry) => {
      if (!entry || !entry.available) return `${label}: unavailable (${entry?.reason || 'no_samples'})`;
      const baseRate = entry.baseRate;
      const baselineBrier = baseRate * (1 - baseRate);
      const baselineLogLoss = -(baseRate * Math.log(baseRate || 1e-9) + (1 - baseRate) * Math.log(1 - baseRate || 1e-9));
      const brierDelta = entry.brier - baselineBrier;
      const logLossDelta = entry.logLoss - baselineLogLoss;
      const brierNote = brierDelta <= 0 ? 'better than baseline' : 'worse than baseline';
      const logLossNote = logLossDelta <= 0 ? 'better than baseline' : 'worse than baseline';
      return `${label}: ${entry.samples} samples; base rate ${baseRate.toFixed(3)}. LogLoss ${entry.logLoss.toFixed(3)} (${logLossNote}), Brier ${entry.brier.toFixed(3)} (${brierNote}).`;
    };
    lines.push(toCsvRow([
      'Summary',
      `${describePlatt('Top 10', top10)} ${describePlatt('Top 20', top20)}`
    ]));

    lines.push('');
  }

  fs.writeFileSync(csvPath, lines.join('\n'));

  return { jsonPath, csvPath };
};

module.exports = {
  writeCalibrationReport
};
