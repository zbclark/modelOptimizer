const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const { cleanMetricValue, calculateMetricTrends } = require('../core/modelCore');

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

const parseCsvRows = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    relax_column_count: true,
    skip_empty_lines: false
  });
};

const parseApproachNumber = (value, isPercent = false) => {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[%,$]/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (isPercent) return parsed > 1 ? parsed / 100 : parsed;
  return parsed;
};

const formatSheetMetricValue = (value, index) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0.000';
  if (SHEET_LIKE_PERCENTAGE_INDICES.has(index)) {
    const pctValue = value <= 1.5 ? value * 100 : value;
    return `${pctValue.toFixed(2)}%`;
  }
  return Number(value.toFixed(3)).toFixed(3);
};

const deriveBirdiesOrBetterFromRow = row => {
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
};

const buildActualMetricsFromHistory = (rows, eventId, season) => {
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
};

const buildActualTrendsFromHistory = (rows, eventId, season) => {
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
};

const buildApproachDeltaMap = (rows = []) => {
  const map = new Map();
  (rows || []).forEach(row => {
    const dgId = String(row?.dg_id || row?.dgId || '').trim();
    if (!dgId) return;
    map.set(dgId, row);
  });
  return map;
};

const buildResultsMetricSpecs = () => {
  const excludedMetrics = new Set([
    'Birdies or Better',
    'Birdie Chances Created'
  ]);
  return GENERATED_METRIC_LABELS
    .map((label, index) => ({ label, index }))
    .filter(spec => !excludedMetrics.has(spec.label));
};

const parseRankingCsvModelValues = (filePath, metricSpecs) => {
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
};

const buildApproachDeltaMetricSpecs = () => {
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
};

const buildPerformanceNotes = ({ finishPosition, modelRank, actualTrends, approachDeltaRow, actualMetrics, modelMetrics }) => {
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
};

const buildPostEventResultsCsv = ({
  rankingsById,
  resultsById,
  actualMetricsById,
  actualTrendsById,
  approachDeltaById
}) => {
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
};

module.exports = {
  GENERATED_METRIC_LABELS,
  buildApproachDeltaMap,
  buildApproachDeltaMetricSpecs,
  buildActualMetricsFromHistory,
  buildActualTrendsFromHistory,
  buildPostEventResultsCsv,
  buildResultsMetricSpecs,
  buildPerformanceNotes,
  formatSheetMetricValue,
  parseRankingCsvModelValues
};
