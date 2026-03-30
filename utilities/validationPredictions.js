const fs = require('fs');

const { readJsonFile } = require('./fileUtils');
const {
  parseCsvRows,
  findHeaderRowIndex,
  buildHeaderIndexMap
} = require('./csvUtils');

const buildPredictionsFromJson = payload => {
  const players = Array.isArray(payload?.players) ? payload.players : null;
  if (!players || players.length === 0) return [];
  return players
    .map((player, idx) => {
      const dgId = String(player?.dgId || '').trim();
      if (!dgId) return null;
      const name = player?.name || player?.playerName || null;
      const rankValue = typeof player?.rank === 'number' ? player.rank : (idx + 1);
      return {
        dgId,
        name,
        rank: rankValue
      };
    })
    .filter(Boolean);
};

const buildPredictionsFromCsv = rankingsCsvPath => {
  if (!rankingsCsvPath || !fs.existsSync(rankingsCsvPath)) return [];
  const rows = parseCsvRows(rankingsCsvPath);
  const headerIndex = findHeaderRowIndex(rows, ['dg id', 'player name', 'rank']);
  if (headerIndex === -1) return [];
  const headers = rows[headerIndex];
  const headerMap = buildHeaderIndexMap(headers);

  const dgIdIdx = headerMap.get('dg id');
  const nameIdx = headerMap.get('player name');
  const rankIdx = headerMap.get('rank') ?? headerMap.get('model rank');

  return rows
    .slice(headerIndex + 1)
    .map((row, idx) => {
      const dgId = dgIdIdx !== undefined ? String(row[dgIdIdx] || '').trim() : '';
      if (!dgId) return null;
      const name = nameIdx !== undefined ? String(row[nameIdx] || '').trim() : '';
      const rawRank = rankIdx !== undefined ? String(row[rankIdx] || '').trim() : '';
      const rankValue = rawRank ? parseInt(rawRank, 10) : (idx + 1);
      return {
        dgId,
        name: name || null,
        rank: Number.isNaN(rankValue) ? (idx + 1) : rankValue
      };
    })
    .filter(Boolean);
};

const loadTournamentPredictions = ({ rankingsJsonPath, rankingsCsvPath } = {}) => {
  if (rankingsJsonPath && fs.existsSync(rankingsJsonPath)) {
    const payload = readJsonFile(rankingsJsonPath);
    const predictions = buildPredictionsFromJson(payload);
    if (predictions.length > 0) {
      return { source: 'rankings_json', predictions };
    }
  }

  if (rankingsCsvPath && fs.existsSync(rankingsCsvPath)) {
    const predictions = buildPredictionsFromCsv(rankingsCsvPath);
    if (predictions.length > 0) {
      return { source: 'rankings_csv', predictions };
    }
  }

  return { source: 'missing', predictions: [] };
};

module.exports = {
  loadTournamentPredictions
};
