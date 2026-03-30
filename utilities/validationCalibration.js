const { formatTimestamp } = require('./timeUtils');

const sigmoid = value => {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
};

const buildPlattSamples = (predictionsList, resultsList, threshold) => {
  const predictionMap = new Map();
  (predictionsList || []).forEach((pred, idx) => {
    const dgId = String(pred?.dgId || '').trim();
    if (!dgId) return;
    const rankValue = typeof pred.rank === 'number' ? pred.rank : (idx + 1);
    predictionMap.set(dgId, rankValue);
  });

  const resultsById = new Map();
  (resultsList || []).forEach(entry => {
    const dgId = String(entry?.dgId || '').trim();
    const finishPos = entry?.finishPosition;
    if (!dgId || typeof finishPos !== 'number' || Number.isNaN(finishPos)) return;
    resultsById.set(dgId, finishPos);
  });

  const denom = Math.max(1, predictionMap.size - 1);
  const samples = [];
  predictionMap.forEach((rankValue, dgId) => {
    const finishPos = resultsById.get(dgId);
    if (typeof finishPos !== 'number' || Number.isNaN(finishPos)) return;
    const percentile = Math.min(1, Math.max(0, (rankValue - 1) / denom));
    samples.push({
      x: percentile,
      y: finishPos <= threshold ? 1 : 0
    });
  });
  return samples;
};

const fitPlattScaling = (samples, options = {}) => {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { available: false, reason: 'no_samples' };
  }
  const maxIterations = Math.max(50, Math.floor(options.maxIterations || 800));
  const learningRate = Math.max(0.001, Number(options.learningRate || 0.1));
  const lambda = Math.max(0, Number(options.lambda || 0.01));

  let a = 0;
  let b = 0;
  const n = samples.length;

  for (let i = 0; i < maxIterations; i++) {
    let gradA = 0;
    let gradB = 0;
    samples.forEach(sample => {
      const z = a * sample.x + b;
      const p = sigmoid(z);
      const error = p - sample.y;
      gradA += error * sample.x;
      gradB += error;
    });

    gradA = (gradA / n) + (lambda * a);
    gradB = (gradB / n) + (lambda * b);

    a -= learningRate * gradA;
    b -= learningRate * gradB;

    if (Math.abs(gradA) < 1e-6 && Math.abs(gradB) < 1e-6) break;
  }

  let logLoss = 0;
  let brier = 0;
  samples.forEach(sample => {
    const p = sigmoid(a * sample.x + b);
    const clipped = Math.min(1 - 1e-9, Math.max(1e-9, p));
    logLoss += -(sample.y * Math.log(clipped) + (1 - sample.y) * Math.log(1 - clipped));
    brier += Math.pow(p - sample.y, 2);
  });

  return {
    available: true,
    a,
    b,
    samples: n,
    logLoss: logLoss / n,
    brier: brier / n,
    baseRate: samples.reduce((sum, s) => sum + s.y, 0) / n
  };
};

const buildCalibrationData = ({ tournamentName, predictions = [], results = [] }) => {
  const predictionMap = new Map();
  (predictions || []).forEach((pred, idx) => {
    const dgId = String(pred?.dgId || '').trim();
    if (!dgId) return;
    const rankValue = typeof pred.rank === 'number' ? pred.rank : (idx + 1);
    predictionMap.set(dgId, rankValue);
  });

  const actualResults = (results || [])
    .filter(entry => typeof entry?.finishPosition === 'number' && !Number.isNaN(entry.finishPosition))
    .map(entry => ({
      dgId: String(entry.dgId || '').trim(),
      name: entry.playerName || entry.name || '',
      finishPos: entry.finishPosition
    }))
    .filter(entry => entry.dgId && entry.finishPos !== null);

  const topFinishers = actualResults
    .filter(entry => entry.finishPos <= 10)
    .sort((a, b) => a.finishPos - b.finishPos);

  const buildCalibrationBuckets = (predictionsList, resultsList, bucketCount = 10) => {
    const predictionRanks = new Map();
    (predictionsList || []).forEach((pred, idx) => {
      const dgId = String(pred?.dgId || '').trim();
      if (!dgId) return;
      const rankValue = typeof pred.rank === 'number' ? pred.rank : (idx + 1);
      predictionRanks.set(dgId, rankValue);
    });

    const resultsById = new Map();
    (resultsList || []).forEach(entry => {
      const dgId = String(entry?.dgId || '').trim();
      const finishPos = entry?.finishPosition;
      if (!dgId || typeof finishPos !== 'number' || Number.isNaN(finishPos)) return;
      resultsById.set(dgId, finishPos);
    });

    const totalPredictions = predictionRanks.size;
    const denom = Math.max(1, totalPredictions - 1);
    const buckets = Array.from({ length: bucketCount }, (_, idx) => ({
      bucket: idx,
      minPct: idx / bucketCount,
      maxPct: (idx + 1) / bucketCount,
      count: 0,
      top5: 0,
      top10: 0,
      top20: 0
    }));

    predictionRanks.forEach((rankValue, dgId) => {
      const finishPos = resultsById.get(dgId);
      if (typeof finishPos !== 'number' || Number.isNaN(finishPos)) return;
      const percentile = Math.min(1, Math.max(0, (rankValue - 1) / denom));
      const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor(percentile * bucketCount)));
      const bucket = buckets[bucketIndex];
      bucket.count += 1;
      if (finishPos <= 5) bucket.top5 += 1;
      if (finishPos <= 10) bucket.top10 += 1;
      if (finishPos <= 20) bucket.top20 += 1;
    });

    return {
      bucketCount,
      totalPredictions,
      matchedCount: buckets.reduce((sum, entry) => sum + entry.count, 0),
      buckets
    };
  };

  const tournamentAnalysis = {
    name: tournamentName || 'Tournament',
    topFinishers: [],
    calibrationBuckets: buildCalibrationBuckets(predictions, results),
    plattCalibration: {
      top10: fitPlattScaling(buildPlattSamples(predictions, results, 10)),
      top20: fitPlattScaling(buildPlattSamples(predictions, results, 20))
    },
    accuracyMetrics: {
      top5Predicted: 0,
      top10Predicted: 0,
      top20Predicted: 0,
      avgMissTop5: 0,
      avgMissTop10: 0
    }
  };

  let totalTop5 = 0;
  let predictedTop5InTop20 = 0;
  let totalTop10 = 0;
  let predictedTop10InTop30 = 0;

  topFinishers.forEach(actual => {
    const predictedRank = predictionMap.has(actual.dgId) ? predictionMap.get(actual.dgId) : 999;
    const miss = Math.abs(predictedRank - actual.finishPos);
    const inTopXPredicted = predictedRank <= 20
      ? 'Top 20'
      : (predictedRank <= 50 ? 'Top 50' : 'Outside Top 50');

    tournamentAnalysis.topFinishers.push({
      name: actual.name,
      dgId: actual.dgId,
      actualFinish: actual.finishPos,
      predictedRank,
      missScore: miss,
      inTopXPredicted
    });

    if (predictedRank <= 20) tournamentAnalysis.accuracyMetrics.top5Predicted += 1;
    if (predictedRank <= 30) tournamentAnalysis.accuracyMetrics.top10Predicted += 1;
    if (predictedRank <= 50) tournamentAnalysis.accuracyMetrics.top20Predicted += 1;

    if (actual.finishPos <= 5) {
      totalTop5 += 1;
      if (predictedRank <= 20) predictedTop5InTop20 += 1;
    }
    if (actual.finishPos <= 10) {
      totalTop10 += 1;
      if (predictedRank <= 30) predictedTop10InTop30 += 1;
    }
  });

  const avgMissTop5 = (() => {
    const top5 = tournamentAnalysis.topFinishers.filter(entry => entry.actualFinish <= 5);
    if (!top5.length) return 0;
    const total = top5.reduce((sum, entry) => sum + entry.missScore, 0);
    return total / top5.length;
  })();

  const avgMissTop10 = (() => {
    const top10 = tournamentAnalysis.topFinishers.filter(entry => entry.actualFinish <= 10);
    if (!top10.length) return 0;
    const total = top10.reduce((sum, entry) => sum + entry.missScore, 0);
    return total / top10.length;
  })();

  tournamentAnalysis.accuracyMetrics.avgMissTop5 = avgMissTop5;
  tournamentAnalysis.accuracyMetrics.avgMissTop10 = avgMissTop10;

  return {
    tournaments: [tournamentAnalysis],
    calibrationBuckets: tournamentAnalysis.calibrationBuckets,
    plattCalibration: tournamentAnalysis.plattCalibration,
    totalTop5,
    predictedTop5InTop20,
    totalTop10,
    predictedTop10InTop30,
    generatedAt: formatTimestamp(new Date())
  };
};

const mergeCalibrationData = (target, source) => {
  if (!source) return target;
  const mergeBuckets = (targetBuckets, sourceBuckets) => {
    if (!sourceBuckets || !Array.isArray(sourceBuckets.buckets)) return targetBuckets;
    if (!targetBuckets || !Array.isArray(targetBuckets.buckets)) return { ...sourceBuckets };

    const bucketCount = Math.max(
      targetBuckets.bucketCount || 0,
      sourceBuckets.bucketCount || 0,
      targetBuckets.buckets.length,
      sourceBuckets.buckets.length
    );
    const merged = Array.from({ length: bucketCount }, (_, idx) => ({
      bucket: idx,
      minPct: idx / bucketCount,
      maxPct: (idx + 1) / bucketCount,
      count: 0,
      top5: 0,
      top10: 0,
      top20: 0
    }));

    const addBucket = entry => {
      if (!entry) return;
      const index = typeof entry.bucket === 'number' ? entry.bucket : null;
      if (index === null || index < 0 || index >= merged.length) return;
      merged[index].count += entry.count || 0;
      merged[index].top5 += entry.top5 || 0;
      merged[index].top10 += entry.top10 || 0;
      merged[index].top20 += entry.top20 || 0;
    };

    (targetBuckets.buckets || []).forEach(addBucket);
    (sourceBuckets.buckets || []).forEach(addBucket);

    return {
      bucketCount,
      totalPredictions: (targetBuckets.totalPredictions || 0) + (sourceBuckets.totalPredictions || 0),
      matchedCount: merged.reduce((sum, entry) => sum + entry.count, 0),
      buckets: merged
    };
  };

  target.tournaments.push(...(source.tournaments || []));
  target.totalTop5 += source.totalTop5 || 0;
  target.predictedTop5InTop20 += source.predictedTop5InTop20 || 0;
  target.totalTop10 += source.totalTop10 || 0;
  target.predictedTop10InTop30 += source.predictedTop10InTop30 || 0;
  target.calibrationBuckets = mergeBuckets(target.calibrationBuckets, source.calibrationBuckets);
  return target;
};

module.exports = {
  sigmoid,
  buildPlattSamples,
  fitPlattScaling,
  buildCalibrationData,
  mergeCalibrationData
};
