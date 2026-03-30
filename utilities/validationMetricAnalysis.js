const { loadCsv } = require('./csvLoader');
const { parseApproachNumber } = require('./approachDelta');
const { formatTimestamp } = require('./timeUtils');
const { computeMetricCorrelation } = require('./evaluationMetrics');
const { normalizeFinishPosition, parseNumericValue } = require('./parsingUtils');
const { METRIC_ORDER, APPROACH_EVENT_METRIC_MAP } = require('./validationConstants');
const { normalizeMetricLabel } = require('./metricLabels');
const {
  parseCsvRows,
  normalizeHeader,
  findHeaderRowIndex,
  buildHeaderIndexMap
} = require('./csvUtils');

const resolveMetricFallbackLabel = metricName => {
  const raw = String(metricName || '').trim();
  if (!raw) return null;
  if (raw.startsWith('Scoring: ')) {
    return raw.replace(/^Scoring:\s*/i, '').trim();
  }
  if (raw.startsWith('Course Management: ')) {
    return raw.replace(/^Course Management:\s*/i, '').trim();
  }
  return raw;
};

const roundMetricValueForAnalysis = value => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Number(value.toFixed(3));
};

const buildResultsMetricMap = resultsRows => {
  const map = new Map();
  (resultsRows || []).forEach(row => {
    const dgId = String(row?.['DG ID'] || row?.dgId || row?.dg_id || '').trim();
    if (!dgId) return;
    const metrics = {
      'Driving Distance': parseNumericValue(row?.['Driving Distance']),
      'Driving Accuracy': parseNumericValue(row?.['Driving Accuracy']),
      'SG OTT': parseNumericValue(row?.['SG OTT']),
      'SG Putting': parseNumericValue(row?.['SG Putting']),
      'SG Around Green': parseNumericValue(row?.['SG Around Green']),
      'SG T2G': parseNumericValue(row?.['SG T2G']),
      'SG Approach': parseNumericValue(row?.['SG Approach']),
      'SG Total': parseNumericValue(row?.['SG Total']),
      'Greens in Regulation': parseNumericValue(row?.['Greens in Regulation']),
      'Fairway Proximity': parseNumericValue(row?.['Fairway Proximity']),
      'Rough Proximity': parseNumericValue(row?.['Rough Proximity'])
    };
    map.set(dgId, metrics);
  });
  return map;
};

const buildHistoricalMetricMap = (historyCsvPath, eventId, season) => {
  if (!historyCsvPath) return new Map();
  const rows = loadCsv(historyCsvPath, { skipFirstColumn: true });
  const eventIdStr = String(eventId || '').trim();
  const seasonStr = season ? String(season).trim() : null;
  const buckets = new Map();

  rows.forEach(row => {
    const dgId = String(row?.dg_id || '').trim();
    if (!dgId) return;
    const rowEvent = String(row?.event_id || '').trim();
    if (eventIdStr && rowEvent !== eventIdStr) return;
    if (seasonStr) {
      const rowSeason = String(row?.season || row?.year || '').trim();
      if (rowSeason !== seasonStr) return;
    }

    const bucket = buckets.get(dgId) || {
      scoreSum: 0,
      birdiesSum: 0,
      scrambleSum: 0,
      greatShotsSum: 0,
      poorShotsSum: 0,
      counts: {
        score: 0,
        birdies: 0,
        scrambling: 0,
        greatShots: 0,
        poorShots: 0
      }
    };

    const scoreValue = parseNumericValue(row?.score);
    if (typeof scoreValue === 'number') {
      bucket.scoreSum += scoreValue;
      bucket.counts.score += 1;
    }

    const birdies = parseNumericValue(row?.birdies);
    const eagles = parseNumericValue(row?.eagles_or_better);
    const birdiesOrBetter = typeof birdies === 'number'
      ? birdies + (typeof eagles === 'number' ? eagles : 0)
      : parseNumericValue(row?.birdies_or_better);
    if (typeof birdiesOrBetter === 'number') {
      bucket.birdiesSum += birdiesOrBetter;
      bucket.counts.birdies += 1;
    }

    const scrambling = parseNumericValue(row?.scrambling);
    if (typeof scrambling === 'number') {
      bucket.scrambleSum += scrambling;
      bucket.counts.scrambling += 1;
    }

    const greatShots = parseNumericValue(row?.great_shots);
    if (typeof greatShots === 'number') {
      bucket.greatShotsSum += greatShots;
      bucket.counts.greatShots += 1;
    }

    const poorShots = parseNumericValue(row?.poor_shots);
    if (typeof poorShots === 'number') {
      bucket.poorShotsSum += poorShots;
      bucket.counts.poorShots += 1;
    }

    buckets.set(dgId, bucket);
  });

  const map = new Map();
  buckets.forEach((bucket, dgId) => {
    map.set(dgId, {
      'Scoring Average': bucket.counts.score > 0 ? bucket.scoreSum / bucket.counts.score : null,
      'Birdies or Better': bucket.counts.birdies > 0 ? bucket.birdiesSum / bucket.counts.birdies : null,
      'Scrambling': bucket.counts.scrambling > 0 ? bucket.scrambleSum / bucket.counts.scrambling : null,
      'Great Shots': bucket.counts.greatShots > 0 ? bucket.greatShotsSum / bucket.counts.greatShots : null,
      'Poor Shot Avoidance': bucket.counts.poorShots > 0 ? bucket.poorShotsSum / bucket.counts.poorShots : null
    });
  });

  return map;
};

const extractRankingMetrics = rankingsCsvPath => {
  if (!rankingsCsvPath) return { players: [], metricLabels: [] };
  const rows = parseCsvRows(rankingsCsvPath);
  const headerIndex = findHeaderRowIndex(rows, ['dg id', 'player name', 'rank']);
  if (headerIndex === -1) return { players: [], metricLabels: [] };
  const headers = rows[headerIndex];
  const headerMap = buildHeaderIndexMap(headers);
  const dgIdIdx = headerMap.get('dg id');
  const nameIdx = headerMap.get('player name');
  const rankIdx = headerMap.get('rank') ?? headerMap.get('model rank');

  const ignoreColumns = new Set([
    'expected peformance notes',
    'expected performance notes',
    'performance analysis',
    'rank',
    'dg id',
    'player name',
    'top 5',
    'top 10',
    'weighted score',
    'past perf. mult.',
    'past perf mult',
    'refined weighted score',
    'war',
    'delta trend score',
    'delta predictive score'
  ]);

  const allowedMetrics = new Set(METRIC_ORDER.map(metric => normalizeMetricLabel(metric)));
  const metricLabelMap = new Map();
  headers.forEach((header, idx) => {
    const normalized = normalizeHeader(header);
    if (!normalized || ignoreColumns.has(normalized) || normalized.endsWith('trend')) return;
    const canonical = normalizeMetricLabel(header);
    if (!allowedMetrics.has(canonical)) return;
    if (!metricLabelMap.has(canonical)) {
      metricLabelMap.set(canonical, { label: canonical, idx });
    }
  });

  const metricLabels = METRIC_ORDER
    .map(metricName => {
      const direct = metricLabelMap.get(metricName);
      if (direct) return direct;
      const fallback = resolveMetricFallbackLabel(metricName);
      if (fallback && metricLabelMap.has(fallback)) {
        return { label: metricName, idx: metricLabelMap.get(fallback).idx };
      }
      return null;
    })
    .filter(Boolean);

  const players = rows.slice(headerIndex + 1)
    .map((row, idx) => {
      const dgId = dgIdIdx !== undefined ? String(row[dgIdIdx] || '').trim() : '';
      const name = nameIdx !== undefined ? String(row[nameIdx] || '').trim() : '';
      const rankValue = rankIdx !== undefined ? parseInt(String(row[rankIdx] || '').trim(), 10) : NaN;
      if (!dgId || !name) return null;
      const metrics = {};
      metricLabels.forEach(metric => {
        metrics[metric.label] = parseNumericValue(row[metric.idx]);
      });
      return {
        dgId,
        name,
        rank: Number.isNaN(rankValue) ? (idx + 1) : rankValue,
        metrics
      };
    })
    .filter(Boolean);

  return {
    players,
    metricLabels: metricLabels.map(metric => metric.label)
  };
};

const buildMetricAnalysis = ({
  rankingsCsvPath,
  results,
  resultsRows,
  historyCsvPath,
  eventId,
  season,
  tournamentSlug,
  courseType,
  approachEventOnlyMap = null,
  version = 3
}) => {
  const extracted = extractRankingMetrics(rankingsCsvPath);
  let metricLabels = Array.isArray(extracted.metricLabels) ? extracted.metricLabels : [];
  let players = Array.isArray(extracted.players) ? extracted.players : [];
  const finishers = (resultsRows || [])
    .map(row => {
      const dgId = String(row?.['DG ID'] || row?.dgId || row?.dg_id || '').trim();
      if (!dgId) return null;
      const finishRaw = row?.['Finish Position'] ?? row?.finishPosition ?? row?.finish ?? row?.position;
      const finishPosition = normalizeFinishPosition(finishRaw);
      if (typeof finishPosition !== 'number' || Number.isNaN(finishPosition)) return null;
      return { dgId, finishPosition };
    })
    .filter(Boolean);
  const resultsById = new Map(finishers.map(entry => [String(entry.dgId), entry.finishPosition]));
  const resultsMetricMap = buildResultsMetricMap(resultsRows || []);
  const historyMetricMap = buildHistoricalMetricMap(historyCsvPath, eventId, season);
  if (!metricLabels.length) {
    metricLabels = METRIC_ORDER.slice();
  }
  if (!players.length) {
    const fallbackRows = (resultsRows || []).length
      ? resultsRows
      : (Array.isArray(results) ? results : []);
    players = fallbackRows
      .map(row => {
        const dgId = String(row?.['DG ID'] || row?.dgId || row?.dg_id || '').trim();
        if (!dgId) return null;
        const name = row?.['Player Name'] || row?.playerName || row?.player_name || row?.name || '';
        return {
          dgId,
          name: String(name || '').trim() || 'Unknown',
          rank: null,
          metrics: {}
        };
      })
      .filter(Boolean);
  }
  const metrics = [];

  metricLabels.forEach(label => {
    const values = [];
    const positions = [];
    const top10Values = [];
    players.forEach(player => {
      const finish = resultsById.get(String(player.dgId));
      if (typeof finish !== 'number' || Number.isNaN(finish)) return;
      const dgId = String(player.dgId);
      const fromResults = resultsMetricMap.get(dgId)?.[label];
      const fromHistory = historyMetricMap.get(dgId)?.[label];
      const approachKey = APPROACH_EVENT_METRIC_MAP[label];
      const fromApproach = approachKey && approachEventOnlyMap
        ? parseApproachNumber(approachEventOnlyMap.get(dgId)?.[approachKey], false)
        : null;
      const raw = typeof fromApproach === 'number'
        ? fromApproach
        : (typeof fromResults === 'number'
          ? fromResults
          : (typeof fromHistory === 'number' ? fromHistory : player.metrics?.[label]));
      const rounded = roundMetricValueForAnalysis(raw);
      if (typeof rounded !== 'number' || Number.isNaN(rounded)) return;
      values.push(rounded);
      positions.push(finish);
      if (finish <= 10) top10Values.push(rounded);
    });

    let correlation = 0;
    if (values.length >= 5) {
      correlation = computeMetricCorrelation(label, positions, values);
    }

    const fieldAvg = values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    const top10Avg = top10Values.length > 0
      ? top10Values.reduce((sum, value) => sum + value, 0) / top10Values.length
      : 0;
    const delta = top10Avg - fieldAvg;

    metrics.push({
      metric: label,
      top10Avg,
      fieldAvg,
      delta,
      correlation,
      top10Count: top10Values.length,
      fieldCount: values.length
    });
  });

  return {
    version,
    tournament: tournamentSlug || null,
    courseType: courseType || null,
    top10Finishers: finishers.filter(entry => entry.finishPosition <= 10).length,
    totalFinishers: finishers.length,
    generatedAt: formatTimestamp(new Date()),
    metrics
  };
};

module.exports = {
  parseApproachNumber,
  roundMetricValueForAnalysis,
  resolveMetricFallbackLabel,
  buildResultsMetricMap,
  buildHistoricalMetricMap,
  extractRankingMetrics,
  buildMetricAnalysis
};
