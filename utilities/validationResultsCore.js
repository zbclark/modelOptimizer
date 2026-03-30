/**
 * Module: validationResultsCore
 * Purpose: Read/transform tournament results for validation (no writes).
 */

const fs = require('fs');
const path = require('path');
const { loadCsv } = require('./csvLoader');
const { readJsonFile } = require('./fileUtils');
const { getDataGolfHistoricalRounds } = require('./dataGolfClient');
const {
  extractHistoricalRowsFromSnapshotPayload,
  normalizeHistoricalRoundRow
} = require('./historicalRowsUtils');
const {
  normalizeFinishPosition,
  parseNumericValue
} = require('./parsingUtils');
const {
  parseCsvRows,
  findHeaderRowIndex,
  buildHeaderIndexMap
} = require('./csvUtils');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATAGOLF_CACHE_ROOT_DIR = path.resolve(ROOT_DIR, 'data', 'cache');
const HISTORICAL_ROUNDS_CACHE_DIR = path.resolve(DATAGOLF_CACHE_ROOT_DIR, 'historical_rounds');
const DATAGOLF_CACHE_DIR = (() => {
  const raw = String(process.env.DATAGOLF_CACHE_DIR || '').trim();
  if (raw) return path.resolve(raw);
  return HISTORICAL_ROUNDS_CACHE_DIR;
})();
const DATAGOLF_API_KEY = String(process.env.DATAGOLF_API_KEY || '').trim();
const DATAGOLF_HISTORICAL_TTL_HOURS = (() => {
  const raw = parseFloat(String(process.env.DATAGOLF_HISTORICAL_TTL_HOURS || '').trim());
  return Number.isNaN(raw) ? 72 : Math.max(1, raw);
})();
const DATAGOLF_HISTORICAL_TOUR = String(process.env.DATAGOLF_HISTORICAL_TOUR || 'pga')
  .trim()
  .toLowerCase();

const applyFinishFallback = entries => {
  const numericPositions = entries
    .map(entry => entry.finishPosition)
    .filter(value => typeof value === 'number' && !Number.isNaN(value));
  const fallback = numericPositions.length ? Math.max(...numericPositions) + 1 : null;

  return entries
    .map(entry => {
      const finishPosition = (typeof entry.finishPosition === 'number' && !Number.isNaN(entry.finishPosition))
        ? entry.finishPosition
        : fallback;
      return { ...entry, finishPosition };
    })
    .filter(entry => entry.dgId && typeof entry.finishPosition === 'number' && !Number.isNaN(entry.finishPosition));
};

const pickFirstValue = (row, keys) => {
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
};

const buildResultsFromResultRows = rows => {
  const results = [];

  (rows || []).forEach(row => {
    const dgIdRaw = pickFirstValue(row, ['DG ID', 'dgId', 'dg_id', 'dg id', 'Player ID', 'player_id']);
    if (!dgIdRaw) return;
    const dgId = String(dgIdRaw).trim();
    if (!dgId) return;
    const playerName = String(
      pickFirstValue(row, ['Player Name', 'player_name', 'playerName', 'Player', 'Name']) || ''
    ).trim();
    const finishRaw = pickFirstValue(row, ['Finish Position', 'finishPosition', 'finish', 'fin_text', 'fin', 'Finish']);
    const finishPosition = normalizeFinishPosition(finishRaw);
    results.push({
      dgId,
      playerName: playerName || 'Unknown',
      finishPosition: typeof finishPosition === 'number' ? finishPosition : null
    });
  });

  return applyFinishFallback(results);
};

const loadTournamentResultsFromJson = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return { source: 'missing', results: [] };
  const payload = readJsonFile(filePath);
  if (!payload || typeof payload !== 'object') return { source: 'invalid_json', results: [] };
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.results) ? payload.results : (Array.isArray(payload?.resultsCurrent) ? payload.resultsCurrent : []));
  const results = buildResultsFromResultRows(rows);
  return { source: 'json', results };
};

const loadTournamentResultsFromResultsCsv = resultsCsvPath => {
  if (!resultsCsvPath || !fs.existsSync(resultsCsvPath)) return { source: 'missing', results: [] };
  const rows = parseCsvRows(resultsCsvPath);
  if (!rows.length) return { source: 'results_csv', results: [] };
  const headerIndex = findHeaderRowIndex(rows, ['dg id', 'player name', 'finish position']);
  if (headerIndex === -1) return { source: 'results_csv', results: [] };
  const headers = rows[headerIndex];
  const headerMap = buildHeaderIndexMap(headers);
  const dgIdIdx = headerMap.get('dg id') ?? headerMap.get('dg_id') ?? headerMap.get('dgid');
  const nameIdx = headerMap.get('player name') ?? headerMap.get('player') ?? headerMap.get('name');
  const finishIdx = headerMap.get('finish position') ?? headerMap.get('finish') ?? headerMap.get('position');

  const results = rows.slice(headerIndex + 1)
    .map(row => {
      const dgIdRaw = dgIdIdx !== undefined ? row[dgIdIdx] : null;
      if (dgIdRaw === undefined || dgIdRaw === null || String(dgIdRaw).trim() === '') return null;
      const dgId = String(dgIdRaw).trim();
      const playerName = nameIdx !== undefined ? String(row[nameIdx] || '').trim() : '';
      const finishRaw = finishIdx !== undefined ? row[finishIdx] : null;
      const finishPosition = normalizeFinishPosition(finishRaw);
      return {
        dgId,
        playerName: playerName || 'Unknown',
        finishPosition: typeof finishPosition === 'number' ? finishPosition : null
      };
    })
    .filter(Boolean);

  return { source: 'results_csv', results: applyFinishFallback(results) };
};

const buildResultsFromHistoricalRows = (rows, eventId, season) => {
  const eventIdStr = String(eventId || '').trim();
  const seasonStr = season ? String(season).trim() : null;
  const players = new Map();
  let eventName = null;
  let courseName = null;

  (rows || []).forEach(row => {
    const dgId = String(row?.dg_id || '').trim();
    if (!dgId) return;
    const rowEvent = String(row?.event_id || '').trim();
    if (eventIdStr && rowEvent !== eventIdStr) return;
    if (seasonStr) {
      const rowSeason = String(row?.season || row?.year || '').trim();
      if (rowSeason !== seasonStr) return;
    }

    if (!eventName && row?.event_name) eventName = row.event_name;
    if (!courseName && (row?.course_name || row?.course)) courseName = row.course_name || row.course;

    const finishText = row?.fin_text || row?.finish || row?.finishPosition || row?.fin;
    const finishPosition = normalizeFinishPosition(finishText);
    const player = players.get(dgId) || {
      dgId,
      playerName: row?.player_name || row?.playerName || row?.name || null,
      finishPosition: null,
      finishText: null,
      scoreSum: 0,
      parSum: 0,
      rounds: 0,
      metrics: {
        sg_total: 0,
        sg_t2g: 0,
        sg_app: 0,
        sg_arg: 0,
        sg_ott: 0,
        sg_putt: 0,
        sg_bs: 0,
        driving_dist: 0,
        driving_acc: 0,
        gir: 0,
        prox_fw: 0,
        prox_rgh: 0,
        scoring_avg: 0,
        birdies_or_better: 0,
        scrambling: 0,
        great_shots: 0,
        poor_shot_avoid: 0
      },
      metricCounts: {
        scoring_avg: 0,
        birdies_or_better: 0,
        scrambling: 0,
        great_shots: 0,
        poor_shot_avoid: 0
      }
    };

    if (typeof finishPosition === 'number' && !Number.isNaN(finishPosition)) {
      if (player.finishPosition === null || finishPosition < player.finishPosition) {
        player.finishPosition = finishPosition;
        player.finishText = finishText ? String(finishText).trim() : String(finishPosition);
      }
    }

    const scoreValue = parseNumericValue(row?.score);
    const parValue = parseNumericValue(row?.course_par || row?.par);
    if (typeof scoreValue === 'number') player.scoreSum += scoreValue;
    if (typeof parValue === 'number') player.parSum += parValue;

    if (typeof scoreValue === 'number') {
      player.metrics.scoring_avg += scoreValue;
      player.metricCounts.scoring_avg += 1;
    }

    const birdies = parseNumericValue(row?.birdies);
    const eagles = parseNumericValue(row?.eagles_or_better);
    const birdiesOrBetter = typeof birdies === 'number'
      ? birdies + (typeof eagles === 'number' ? eagles : 0)
      : parseNumericValue(row?.birdies_or_better);
    if (typeof birdiesOrBetter === 'number') {
      player.metrics.birdies_or_better += birdiesOrBetter;
      player.metricCounts.birdies_or_better += 1;
    }

    const scrambling = parseNumericValue(row?.scrambling);
    if (typeof scrambling === 'number') {
      player.metrics.scrambling += scrambling;
      player.metricCounts.scrambling += 1;
    }

    const greatShots = parseNumericValue(row?.great_shots);
    if (typeof greatShots === 'number') {
      player.metrics.great_shots += greatShots;
      player.metricCounts.great_shots += 1;
    }

    const poorShots = parseNumericValue(row?.poor_shots);
    if (typeof poorShots === 'number') {
      player.metrics.poor_shot_avoid += poorShots;
      player.metricCounts.poor_shot_avoid += 1;
    }

    player.metrics.sg_total += parseNumericValue(row?.sg_total) || 0;
    player.metrics.sg_t2g += parseNumericValue(row?.sg_t2g) || 0;
    player.metrics.sg_app += parseNumericValue(row?.sg_app) || 0;
    player.metrics.sg_arg += parseNumericValue(row?.sg_arg) || 0;
    player.metrics.sg_ott += parseNumericValue(row?.sg_ott) || 0;
    player.metrics.sg_putt += parseNumericValue(row?.sg_putt) || 0;
    player.metrics.sg_bs += parseNumericValue(row?.sg_bs) || 0;
    player.metrics.driving_dist += parseNumericValue(row?.driving_dist) || 0;
    player.metrics.driving_acc += parseNumericValue(row?.driving_acc) || 0;
    player.metrics.gir += parseNumericValue(row?.gir) || 0;
    player.metrics.prox_fw += parseNumericValue(row?.prox_fw) || 0;
    player.metrics.prox_rgh += parseNumericValue(row?.prox_rgh) || 0;
    player.rounds += 1;

    players.set(dgId, player);
  });

  const results = Array.from(players.values()).map(player => {
    const rounds = player.rounds || 1;
    const totalScore = player.scoreSum && player.parSum
      ? player.scoreSum - player.parSum
      : null;
    return {
      dgId: player.dgId,
      playerName: player.playerName || 'Unknown',
      finishPosition: player.finishPosition,
      finishText: player.finishText || (player.finishPosition !== null ? String(player.finishPosition) : ''),
      score: totalScore,
      metrics: {
        sg_total: player.metrics.sg_total / rounds,
        sg_t2g: player.metrics.sg_t2g / rounds,
        sg_app: player.metrics.sg_app / rounds,
        sg_arg: player.metrics.sg_arg / rounds,
        sg_ott: player.metrics.sg_ott / rounds,
        sg_putt: player.metrics.sg_putt / rounds,
        sg_bs: player.metrics.sg_bs / rounds,
        driving_dist: player.metrics.driving_dist / rounds,
        driving_acc: player.metrics.driving_acc / rounds,
        gir: player.metrics.gir / rounds,
        prox_fw: player.metrics.prox_fw / rounds,
        prox_rgh: player.metrics.prox_rgh / rounds,
        scoring_avg: player.metricCounts.scoring_avg > 0
          ? player.metrics.scoring_avg / player.metricCounts.scoring_avg
          : null,
        birdies_or_better: player.metricCounts.birdies_or_better > 0
          ? player.metrics.birdies_or_better / player.metricCounts.birdies_or_better
          : null,
        scrambling: player.metricCounts.scrambling > 0
          ? player.metrics.scrambling / player.metricCounts.scrambling
          : null,
        great_shots: player.metricCounts.great_shots > 0
          ? player.metrics.great_shots / player.metricCounts.great_shots
          : null,
        poor_shot_avoid: player.metricCounts.poor_shot_avoid > 0
          ? player.metrics.poor_shot_avoid / player.metricCounts.poor_shot_avoid
          : null
      }
    };
  });

  return {
    eventName,
    courseName,
    results: applyFinishFallback(results)
  };
};

const loadTournamentResultsFromHistoricalCsv = (historyCsvPath, eventId, season) => {
  if (!historyCsvPath || !fs.existsSync(historyCsvPath)) return { source: 'missing', results: [] };
  const rows = loadCsv(historyCsvPath, { skipFirstColumn: true });
  const build = buildResultsFromHistoricalRows(rows, eventId, season);
  return {
    source: 'historical_csv',
    results: build?.results || []
  };
};

const loadTournamentResultsFromHistoricalApi = async (eventId, season) => {
  const eventIdStr = String(eventId || '').trim();
  const seasonValue = season ? String(season).trim() : null;
  if (!eventIdStr || !seasonValue) return { source: 'missing', results: [] };

  const snapshot = await getDataGolfHistoricalRounds({
    apiKey: DATAGOLF_API_KEY,
    cacheDir: DATAGOLF_CACHE_DIR,
    ttlMs: DATAGOLF_HISTORICAL_TTL_HOURS * 60 * 60 * 1000,
    allowStale: true,
    tour: DATAGOLF_HISTORICAL_TOUR,
    eventId: 'all',
    year: seasonValue,
    fileFormat: 'json'
  });

  if (!snapshot?.payload) return { source: snapshot?.source || 'missing', results: [] };

  const directEvent = snapshot.payload?.[eventIdStr] || null;
  const directScores = Array.isArray(directEvent?.scores) ? directEvent.scores : null;
  if (directScores && directScores.length > 0) {
    const resultsByPlayer = {};
    directScores.forEach(entry => {
      const dgId = String(entry?.dg_id || '').trim();
      if (!dgId) return;
      const finishPosition = normalizeFinishPosition(entry?.fin_text ?? entry?.finish ?? entry?.position);
      if (!finishPosition || Number.isNaN(finishPosition)) return;
      const playerName = String(entry?.player_name || entry?.name || '').trim();
      if (!resultsByPlayer[dgId] || finishPosition < resultsByPlayer[dgId].finishPosition) {
        resultsByPlayer[dgId] = { finishPosition, playerName };
      }
    });

    const results = Object.entries(resultsByPlayer).map(([dgId, entry]) => ({
      dgId,
      playerName: entry.playerName || 'Unknown',
      finishPosition: entry.finishPosition
    }));

    return {
      source: snapshot.source || 'historical_api',
      results: applyFinishFallback(results),
      snapshot,
      usedPayload: 'event_scores'
    };
  }

  const rows = extractHistoricalRowsFromSnapshotPayload(snapshot.payload)
    .map(normalizeHistoricalRoundRow)
    .filter(Boolean);

  const resultsByPlayer = {};
  rows.forEach(row => {
    const dgId = String(row.dg_id || '').trim();
    if (!dgId) return;
    const rowEvent = String(row.event_id || '').trim();
    if (rowEvent !== eventIdStr) return;
    const rowSeason = String(row.season || row.year || '').trim();
    if (seasonValue && rowSeason !== seasonValue) return;
    const finishPosition = normalizeFinishPosition(row.fin_text);
    if (!finishPosition || Number.isNaN(finishPosition)) return;
    const playerName = String(row.player_name || '').trim();
    if (!resultsByPlayer[dgId] || finishPosition < resultsByPlayer[dgId].finishPosition) {
      resultsByPlayer[dgId] = { finishPosition, playerName };
    }
  });

  const results = Object.entries(resultsByPlayer).map(([dgId, entry]) => ({
    dgId,
    playerName: entry.playerName || 'Unknown',
    finishPosition: entry.finishPosition
  }));

  return {
    source: snapshot.source || 'historical_api',
    results: applyFinishFallback(results),
    snapshot
  };
};

const buildResultsFromHistoricalSnapshotPayload = (payload, eventId, season) => {
  if (!payload) return null;
  const rows = extractHistoricalRowsFromSnapshotPayload(payload)
    .map(normalizeHistoricalRoundRow)
    .filter(Boolean);
  if (!rows.length) return null;
  const build = buildResultsFromHistoricalRows(rows, eventId, season);
  return build?.results?.length ? build : null;
};

const resolveHistoricalRoundsCachePath = ({ cacheDir, tour, eventId = 'all', season, fileFormat = 'json' }) => {
  if (!cacheDir || !season) return null;
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeEventId = String(eventId ?? 'all').trim().toLowerCase() || 'all';
  const safeSeason = String(season).trim();
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = `${safeTour}_${safeEventId}_${safeSeason || 'year'}_${safeFormat}`.replace(/[^a-z0-9._-]/g, '_');
  return path.resolve(cacheDir, `datagolf_historical_rounds_${cacheSuffix}.json`);
};

module.exports = {
  applyFinishFallback,
  pickFirstValue,
  buildResultsFromResultRows,
  loadTournamentResultsFromJson,
  loadTournamentResultsFromResultsCsv,
  buildResultsFromHistoricalRows,
  loadTournamentResultsFromHistoricalCsv,
  loadTournamentResultsFromHistoricalApi,
  buildResultsFromHistoricalSnapshotPayload,
  resolveHistoricalRoundsCachePath,
  DATAGOLF_CACHE_DIR,
  DATAGOLF_HISTORICAL_TOUR
};
