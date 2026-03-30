/**
 * Module: evaluationMetrics
 * Purpose: Shared metric/evaluation helpers.
 */

const isLowerBetterMetric = label => {
  const normalized = String(label || '').toLowerCase();
  if (!normalized) return false;
  return normalized.includes('proximity')
    || normalized.includes('scoring average')
    || normalized.includes('poor shot');
};

const rankValues = values => {
  const entries = values.map((value, index) => ({ value, index }));
  entries.sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  let currentRank = 1;
  for (let i = 0; i < entries.length; i += 1) {
    if (i > 0 && entries[i].value !== entries[i - 1].value) {
      currentRank = i + 1;
    }
    ranks[entries[i].index] = currentRank;
  }
  return ranks;
};

const calculatePearsonCorrelation = (xValues, yValues) => {
  if (!xValues.length) return 0;
  const n = xValues.length;
  const meanX = xValues.reduce((sum, value) => sum + value, 0) / n;
  const meanY = yValues.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xValues[i] - meanX;
    const dy = yValues[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : numerator / denom;
};

const calculateSpearmanCorrelation = (xValues, yValues) => {
  if (!Array.isArray(xValues) || !Array.isArray(yValues)) return 0;
  if (xValues.length === 0 || xValues.length !== yValues.length) return 0;
  const rankedX = rankValues(xValues);
  const rankedY = rankValues(yValues);
  return calculatePearsonCorrelation(rankedX, rankedY);
};

const computeMetricCorrelation = (metricName, positions, values) => {
  if (!Array.isArray(positions) || !Array.isArray(values)) return 0;
  if (positions.length === 0 || positions.length !== values.length) return 0;
  const adjustedValues = isLowerBetterMetric(metricName)
    ? values.map(value => -value)
    : values;
  const invertedPositions = positions.map(position => -position);
  return calculateSpearmanCorrelation(invertedPositions, adjustedValues);
};

const calculateRmse = (predicted, actual) => {
  if (!predicted.length || predicted.length !== actual.length) return 0;
  const sumSq = predicted.reduce((sum, value, idx) => sum + Math.pow(value - actual[idx], 2), 0);
  return Math.sqrt(sumSq / predicted.length);
};

const buildFinishPositionMap = results => {
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
};

const calculateTopNHitRate = (predictions, resultsById, n) => {
  if (!predictions || !predictions.length || !resultsById || resultsById.size === 0) return 0;
  const sorted = [...predictions].sort((a, b) => (a.rank || 0) - (b.rank || 0));
  const topPredicted = sorted.slice(0, n);
  const matches = topPredicted.filter(pred => {
    const finish = resultsById.get(String(pred.dgId));
    return typeof finish === 'number' && !Number.isNaN(finish) && finish <= n;
  }).length;
  return topPredicted.length ? (matches / topPredicted.length) * 100 : 0;
};

const evaluateTournamentPredictions = (predictions, results) => {
  const { map: resultsById } = buildFinishPositionMap(results);
  const matchedPlayers = [];
  const predictedRanks = [];
  const actualFinishes = [];

  (predictions || []).forEach((pred, idx) => {
    const finish = resultsById.get(String(pred.dgId));
    if (typeof finish !== 'number' || Number.isNaN(finish)) return;
    const rankValue = typeof pred.rank === 'number' ? pred.rank : (idx + 1);
    predictedRanks.push(rankValue);
    actualFinishes.push(finish);
    matchedPlayers.push({
      name: pred.name,
      dgId: pred.dgId,
      predictedRank: rankValue,
      actualFinish: finish,
      error: Math.abs(rankValue - finish)
    });
  });

  if (predictedRanks.length === 0) {
    return {
      matchedPlayers: [],
      metrics: {
        spearman: 0,
        rmse: 0,
        top5: 0,
        top10: 0,
        top20: 0,
        top50: 0
      }
    };
  }

  return {
    matchedPlayers,
    metrics: {
      spearman: calculateSpearmanCorrelation(predictedRanks, actualFinishes),
      rmse: calculateRmse(predictedRanks, actualFinishes),
      top5: calculateTopNHitRate(predictions, resultsById, 5),
      top10: calculateTopNHitRate(predictions, resultsById, 10),
      top20: calculateTopNHitRate(predictions, resultsById, 20),
      top50: calculateTopNHitRate(predictions, resultsById, 50)
    }
  };
};

module.exports = {
  isLowerBetterMetric,
  computeMetricCorrelation,
  evaluateTournamentPredictions
};
