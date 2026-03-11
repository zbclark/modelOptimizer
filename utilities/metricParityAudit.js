const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const ensureDirectory = dirPath => {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const normalizeNumber = value => {
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .replace(/[%,$]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9.\-]/g, '');
  if (!cleaned) return null;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseRankingCsv = filePath => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Rankings CSV not found: ${filePath}`);
  }
  const rawCsv = fs.readFileSync(filePath, 'utf8');
  const csvLines = rawCsv.split(/\r?\n/);
  let headerLineIdx = 0;
  for (let i = 0; i < csvLines.length; i++) {
    const line = csvLines[i].trim().toLowerCase();
    if (!line) continue;
    if (line.includes('dg id') && line.includes('player name')) {
      headerLineIdx = i;
      break;
    }
  }
  const slicedCsv = csvLines.slice(headerLineIdx).join('\n');
  const records = parse(slicedCsv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
  });
  return { records, headerLineIdx };
};

const buildPlayersFromRecords = (records, metricFields = []) => {
  const players = [];
  (records || []).forEach(row => {
    const dgId = String(
      row['DG ID'] ||
      row['DGID'] ||
      row['DG Id'] ||
      row['DGID '] ||
      row['DG_ID'] ||
      row['DGId'] ||
      row['DG id'] ||
      row['DG_ID '] ||
      ''
    ).trim();
    const fallbackDgId = !dgId && Object.values(row).length >= 3
      ? String(Object.values(row)[2] || '').trim()
      : '';
    const resolvedDgId = dgId || fallbackDgId;
    if (!resolvedDgId) return;

    const player = {
      dgId: resolvedDgId,
      name: row['Player Name'] || row['Player'] || row['Name'] || '',
      rank: normalizeNumber(row['Rank']),
      weightedScore: normalizeNumber(row['Weighted Score']),
      refinedWeightedScore: normalizeNumber(row['Refined Weighted Score'])
    };

    player.metrics = {};
    metricFields.forEach(field => {
      player.metrics[field] = normalizeNumber(row[field]);
    });

    players.push(player);
  });

  return players;
};

const loadDataGolfRankings = rankingsPath => {
  if (!rankingsPath || !fs.existsSync(rankingsPath)) {
    throw new Error(`DataGolf rankings not found: ${rankingsPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(rankingsPath, 'utf8'));
  const entries = Array.isArray(raw?.rankings) ? raw.rankings : [];
  return entries.map(entry => ({
    dgId: String(entry.dg_id ?? ''),
    name: entry.player_name || '',
    datagolfRank: normalizeNumber(entry.datagolf_rank),
    dgSkillEstimate: normalizeNumber(entry.dg_skill_estimate),
    primaryTour: entry.primary_tour || null
  })).filter(entry => entry.dgId);
};

const resolveRankingCsvInDir = dirPath => {
  if (!dirPath || !fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath)
    .filter(name => name.endsWith('_pre_event_rankings.csv'))
    .map(name => ({
      name,
      path: path.resolve(dirPath, name),
      stat: fs.statSync(path.resolve(dirPath, name))
    }));
  if (!files.length) return null;
  files.sort((a, b) => (b.stat.mtimeMs || 0) - (a.stat.mtimeMs || 0));
  return files[0].path;
};

const computeMean = values => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const computeStdDev = (values, mean) => {
  if (!values.length) return 0;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
};

const computeZScores = values => {
  const filtered = values.filter(value => typeof value === 'number');
  const mean = computeMean(filtered);
  const stdDev = computeStdDev(filtered, mean);
  return { mean, stdDev };
};

const computePearson = (pairs = []) => {
  const filtered = pairs.filter(pair => typeof pair?.x === 'number' && typeof pair?.y === 'number');
  if (!filtered.length) return null;
  const xs = filtered.map(pair => pair.x);
  const ys = filtered.map(pair => pair.y);
  const meanX = computeMean(xs);
  const meanY = computeMean(ys);
  const stdX = computeStdDev(xs, meanX);
  const stdY = computeStdDev(ys, meanY);
  if (!stdX || !stdY) return null;
  const cov = filtered.reduce((sum, pair) => sum + (pair.x - meanX) * (pair.y - meanY), 0) / filtered.length;
  return cov / (stdX * stdY);
};

const computeTopNOverlap = (modelEntries, dgEntries, topN) => {
  const modelTop = modelEntries
    .filter(entry => typeof entry.rank === 'number')
    .sort((a, b) => a.rank - b.rank)
    .slice(0, topN);
  const dgTop = dgEntries
    .filter(entry => typeof entry.datagolfRank === 'number')
    .sort((a, b) => a.datagolfRank - b.datagolfRank)
    .slice(0, topN);

  const modelIds = new Set(modelTop.map(entry => entry.dgId));
  const dgIds = new Set(dgTop.map(entry => entry.dgId));
  const overlap = [...modelIds].filter(id => dgIds.has(id));
  return {
    modelTop,
    dgTop,
    overlapIds: overlap,
    overlapCount: overlap.length
  };
};

module.exports = {
  ensureDirectory,
  normalizeNumber,
  parseRankingCsv,
  buildPlayersFromRecords,
  loadDataGolfRankings,
  resolveRankingCsvInDir,
  computeZScores,
  computePearson,
  computeTopNOverlap
};
