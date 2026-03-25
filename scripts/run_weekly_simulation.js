const fs = require('fs');
const path = require('path');
const {
  normalizePercentile,
  normalizeSelectionMode,
  applyEdgeZPercentile,
  rankCandidates
} = require('../utilities/wageringSelectionUtils');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');

const ensureDir = dirPath => {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.replace(/^--/, '').trim();
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
};

const toNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const EDGE_SHRINK_BUCKETS = {
  top_5: [
    { maxOdds: 2, shrink: 0.6 },
    { maxOdds: 3, shrink: 0.45 },
    { maxOdds: 5, shrink: 0.4 },
    { maxOdds: 10, shrink: 0.3 },
    { maxOdds: 20, shrink: 0.25 },
    { maxOdds: 50, shrink: 0.18 },
    { maxOdds: 100, shrink: 0.12 },
    { maxOdds: Infinity, shrink: 0.08 }
  ],
  top_10: [
    { maxOdds: 2, shrink: 0.7 },
    { maxOdds: 3, shrink: 0.55 },
    { maxOdds: 5, shrink: 0.5 },
    { maxOdds: 10, shrink: 0.4 },
    { maxOdds: 20, shrink: 0.28 },
    { maxOdds: 50, shrink: 0.2 },
    { maxOdds: 100, shrink: 0.12 },
    { maxOdds: Infinity, shrink: 0.08 }
  ],
  top_20: [
    { maxOdds: 2, shrink: 0.75 },
    { maxOdds: 3, shrink: 0.6 },
    { maxOdds: 5, shrink: 0.5 },
    { maxOdds: 10, shrink: 0.4 },
    { maxOdds: 20, shrink: 0.3 },
    { maxOdds: 50, shrink: 0.2 },
    { maxOdds: 100, shrink: 0.12 },
    { maxOdds: Infinity, shrink: 0.08 }
  ],
  win: [
    { maxOdds: 5, shrink: 0.35 },
    { maxOdds: 10, shrink: 0.3 },
    { maxOdds: 20, shrink: 0.25 },
    { maxOdds: 50, shrink: 0.18 },
    { maxOdds: 100, shrink: 0.14 },
    { maxOdds: Infinity, shrink: 0.1 }
  ],
  make_cut: [
    { maxOdds: 2, shrink: 0.7 },
    { maxOdds: 3, shrink: 0.55 },
    { maxOdds: 5, shrink: 0.35 },
    { maxOdds: Infinity, shrink: 0.2 }
  ],
  mc: [
    { maxOdds: 2, shrink: 0.7 },
    { maxOdds: 3, shrink: 0.55 },
    { maxOdds: 5, shrink: 0.35 },
    { maxOdds: Infinity, shrink: 0.2 }
  ]
};

const resolveEdgeShrink = ({ market, odds, defaultShrink }) => {
  const normalizedMarket = normalizeMarketType(market);
  const schedule = EDGE_SHRINK_BUCKETS[normalizedMarket];
  if (!schedule || !Number.isFinite(odds)) return defaultShrink;
  const match = schedule.find(bucket => odds <= bucket.maxOdds);
  return Number.isFinite(match?.shrink) ? match.shrink : defaultShrink;
};

const readCsv = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(header => header.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j += 1) {
      const char = line[j];
      if (char === '"') {
        if (inQuotes && line[j + 1] === '"') {
          current += '"';
          j += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    values.push(current);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    rows.push(row);
  }
  return rows;
};

const writeCsv = (filePath, rows, headers) => {
  ensureDir(path.dirname(filePath));
  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map(header => {
      const raw = row[header] ?? '';
      const text = String(raw);
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    });
    lines.push(values.join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
};

const resolveWageringInputsDir = () => path.resolve(DATA_DIR, 'wagering');


const collectOddsEvalFiles = ({ market, oddsSource }) => {
  const wageringDir = resolveWageringInputsDir();
  if (!fs.existsSync(wageringDir)) return [];
  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const filePattern = new RegExp(`_${marketSlug}_${oddsSourceKey}_[^/]+_odds_eval\\.csv$`, 'i');
  const entries = fs.readdirSync(wageringDir)
    .map(name => path.resolve(wageringDir, name))
    .filter(entry => fs.existsSync(entry) && fs.statSync(entry).isDirectory());

  const files = [];
  entries.forEach(dir => {
    const inputsDir = path.resolve(dir, 'inputs');
    if (!fs.existsSync(inputsDir) || !fs.statSync(inputsDir).isDirectory()) return;
      const evalPattern = new RegExp(`_${marketSlug}_${oddsSourceKey}_[^_]+_odds_eval\\.csv$`, 'i');
      fs.readdirSync(inputsDir)
        .filter(file => evalPattern.test(file))
        .forEach(file => files.push(path.resolve(inputsDir, file)));
  });
  return files;
};

const extractTournamentSlug = filePath => {
  if (!filePath) return '';
  const normalized = String(filePath).replace(/\\/g, '/');
  const marker = '/data/wagering/';
  const idx = normalized.indexOf(marker);
  if (idx >= 0) {
    const remainder = normalized.slice(idx + marker.length);
    const parts = remainder.split('/').filter(Boolean);
    if (parts.length) return parts[0];
  }
  const base = path.basename(normalized);
  const match = base.match(/^(.*)_.*_odds_eval\.csv$/i);
  if (match && match[1]) {
    return match[1];
  }
  return '';
};

const normalizeMarketType = value => {
  if (!value) return '';
  const raw = String(value).trim().toLowerCase();
  if (raw.startsWith('outright_')) {
    return raw.replace(/^outright_/, '');
  }
  return raw;
};

const buildBetKey = ({ event, market, book, dgId }) => {
  const normalizedMarket = normalizeMarketType(market || '');
  const normalizedBook = String(book || '').trim().toLowerCase();
  const normalizedDgId = String(dgId || '').trim().toLowerCase();
  return `${event || ''}||${normalizedMarket}||${normalizedBook}||${normalizedDgId}`;
};

const buildOutcomeKey = ({ event, market, book, dgId }) => {
  const normalizedMarket = normalizeMarketType(market || '');
  const normalizedBook = String(book || '').trim().toLowerCase();
  const normalizedDgId = String(dgId || '').trim().toLowerCase();
  return `${event || ''}||${normalizedMarket}||${normalizedBook}||${normalizedDgId}`;
};

const readJson = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const oddsMetaCache = new Map();
const matchupOpponentCache = new Map();
const resolveOddsMeta = ({ oddsSourcePath, dgId, playerName, isHistorical }) => {
  if (!oddsSourcePath) {
    return { odds_generated_at: '', graded_at: '' };
  }
  if (oddsMetaCache.has(oddsSourcePath)) {
    const cached = oddsMetaCache.get(oddsSourcePath);
    return cached;
  }
  const payload = readJson(oddsSourcePath);
  if (!payload) {
    const empty = { odds_generated_at: '', graded_at: '' };
    oddsMetaCache.set(oddsSourcePath, empty);
    return empty;
  }

  const eventCompleted = payload.event_completed || '';
  const lastUpdated = payload.last_updated || '';
  let closeTime = '';

  if (Array.isArray(payload.odds)) {
    const normalizedPlayer = String(playerName || '').trim().toLowerCase();
    const match = payload.odds.find(entry => {
      if (!entry) return false;
      if (dgId && Number(entry.dg_id) === Number(dgId)) return true;
      const entryName = String(entry.player_name || '').trim().toLowerCase();
      if (entryName && normalizedPlayer && entryName === normalizedPlayer) return true;
      const p1Id = entry.p1_dg_id ? Number(entry.p1_dg_id) : null;
      const p2Id = entry.p2_dg_id ? Number(entry.p2_dg_id) : null;
      const p3Id = entry.p3_dg_id ? Number(entry.p3_dg_id) : null;
      if (dgId && [p1Id, p2Id, p3Id].includes(Number(dgId))) return true;
      const names = [entry.p1_player_name, entry.p2_player_name, entry.p3_player_name]
        .map(name => String(name || '').trim().toLowerCase())
        .filter(Boolean);
      return normalizedPlayer && names.includes(normalizedPlayer);
    });
    closeTime = match?.close_time || '';
  }

  const oddsGeneratedAt = isHistorical
    ? (closeTime || lastUpdated || '')
    : (lastUpdated || '');
  const gradedAt = isHistorical
    ? (closeTime || eventCompleted || '')
    : '';
  const meta = {
    odds_generated_at: oddsGeneratedAt,
    graded_at: gradedAt
  };
  oddsMetaCache.set(oddsSourcePath, meta);
  return meta;
};

const isOddsSourceMatch = (marketValue, oddsSourcePath) => {
  if (!oddsSourcePath || !marketValue) return true;
  const normalizedMarket = normalizeMarketType(marketValue);
  const normalizedPath = String(oddsSourcePath).toLowerCase();
  const tokens = new Set([
    normalizedMarket
  ]);
  if (['3ball', '3balls', '3-ball', '3_balls'].includes(normalizedMarket)) {
    tokens.add('3_balls');
  }
  if (['matchups'].includes(normalizedMarket)) {
    tokens.add('tournament_matchups');
    tokens.add('round_matchups');
    tokens.add('3_balls');
  }
  return Array.from(tokens).some(token => normalizedPath.includes(`/${token}/`));
};

const resolveMatchupLabel = ({ market, dgId, playerName, oddsSourcePath }) => {
  if (!oddsSourcePath) return playerName;
  const normalizedMarket = normalizeMarketType(market || '');
  const matchupMarkets = new Set([
    'tournament_matchups',
    'round_matchups',
    '3_balls',
    '3balls',
    '3-ball',
    '3ball',
    'matchups'
  ]);
  if (!matchupMarkets.has(normalizedMarket)) return playerName;
  if (!matchupOpponentCache.has(oddsSourcePath)) {
    const payload = readJson(oddsSourcePath);
    const map = new Map();
    const entries = payload?.match_list;
    if (Array.isArray(entries)) {
      entries.forEach(entry => {
        const p1Id = entry?.p1_dg_id ? String(entry.p1_dg_id) : null;
        const p2Id = entry?.p2_dg_id ? String(entry.p2_dg_id) : null;
        const p3Id = entry?.p3_dg_id ? String(entry.p3_dg_id) : null;
        const p1Name = String(entry?.p1_player_name || '').trim();
        const p2Name = String(entry?.p2_player_name || '').trim();
        const p3Name = String(entry?.p3_player_name || '').trim();
        if (p1Id && p2Id) {
          map.set(p1Id, p2Name);
          map.set(p2Id, p1Name);
        }
        if (p3Id) {
          const othersForP1 = [p2Name, p3Name].filter(Boolean).join(' / ');
          const othersForP2 = [p1Name, p3Name].filter(Boolean).join(' / ');
          const othersForP3 = [p1Name, p2Name].filter(Boolean).join(' / ');
          if (p1Id) map.set(p1Id, othersForP1);
          if (p2Id) map.set(p2Id, othersForP2);
          map.set(p3Id, othersForP3);
        }
      });
    }
    matchupOpponentCache.set(oddsSourcePath, map);
  }
  const opponentMap = matchupOpponentCache.get(oddsSourcePath);
  const opponent = opponentMap?.get(String(dgId || '').trim());
  if (!opponent) return playerName;
  return `${playerName} over ${opponent}`;
};

const collectOddsEvalFilesAll = () => {
  const wageringDir = resolveWageringInputsDir();
  if (!fs.existsSync(wageringDir)) return [];
  const entries = fs.readdirSync(wageringDir)
    .map(name => path.resolve(wageringDir, name))
    .filter(entry => fs.existsSync(entry) && fs.statSync(entry).isDirectory());

  const files = [];
  entries.forEach(dir => {
    const inputsDir = path.resolve(dir, 'inputs');
    if (!fs.existsSync(inputsDir) || !fs.statSync(inputsDir).isDirectory()) return;
    fs.readdirSync(inputsDir)
      .filter(file => file.endsWith('_odds_eval.csv'))
      .forEach(file => files.push(path.resolve(inputsDir, file)));
  });
  return files;
};

const collectOddsEvalFilesAllMarkets = ({ oddsSource, eventId }) => {
  const wageringDir = resolveWageringInputsDir();
  if (!fs.existsSync(wageringDir)) return [];
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const entries = fs.readdirSync(wageringDir)
    .map(name => path.resolve(wageringDir, name))
    .filter(entry => fs.existsSync(entry) && fs.statSync(entry).isDirectory());

  const files = [];
  entries.forEach(dir => {
    const inputsDir = path.resolve(dir, 'inputs');
    if (!fs.existsSync(inputsDir) || !fs.statSync(inputsDir).isDirectory()) return;
    fs.readdirSync(inputsDir)
      .filter(file => file.endsWith('_odds_eval.csv'))
      .filter(file => file.includes(`_${oddsSourceKey}`))
      .forEach(file => files.push(path.resolve(inputsDir, file)));
  });

  if (!eventId) return files;
  return files.filter(filePath => {
    const rows = readCsv(filePath);
    return rows.some(row => String(row.event_id || '').trim() === String(eventId));
  });
};

const buildOutcomeIndex = ({ eventId }) => {
  const files = collectOddsEvalFilesAll();
  const index = new Map();
  files.forEach(filePath => {
    const rows = readCsv(filePath);
    rows.forEach(row => {
      if (eventId && String(row.event_id || '').trim() !== String(eventId)) return;
      const dgId = row.player_id || row.dg_id || '';
      if (!dgId) return;
      const market = normalizeMarketType(row.market_type || '');
      const book = String(row.book || '').trim().toLowerCase();
      const oddsSourcePath = row.odds_source_path || '';
      let winFactor = row.outcome === '' ? null : Number(row.outcome);
      let betOutcomeText = '';
      let isPush = false;

      if (oddsSourcePath) {
        const payload = readJson(oddsSourcePath);
        if (payload && Array.isArray(payload.odds)) {
          const entry = payload.odds.find(item => String(item?.dg_id || '') === String(dgId));
          if (entry) {
            if (typeof entry.bet_outcome_numeric === 'number') {
              winFactor = entry.bet_outcome_numeric;
            }
            betOutcomeText = String(entry.bet_outcome_text || '');
          }
        }
      }

      if (!Number.isFinite(winFactor)) {
        const text = String(betOutcomeText || '').toLowerCase();
        const deadHeatMatch = text.match(/dead-heat:\s*(\d+)\s*for\s*(\d+)/i);
        if (deadHeatMatch) {
          const numerator = Number(deadHeatMatch[1]);
          const denominator = Number(deadHeatMatch[2]);
          if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
            winFactor = numerator / denominator;
          }
        }
        if (!Number.isFinite(winFactor)) {
          if (text.includes('paid in full') || text.includes('win')) {
            winFactor = 1;
          } else if (text.includes('loss')) {
            winFactor = 0;
          } else if (text.includes('push') || text.includes('wash') || text.includes('tie')) {
            isPush = true;
            winFactor = 0;
          }
        }
      }

      if (!Number.isFinite(winFactor)) return;
      const key = buildOutcomeKey({
        event: row.event_id || '',
        market,
        book,
        dgId
      });
      if (!index.has(key)) {
        index.set(key, {
          winFactor,
          isPush,
          odds: Number(row.odds_decimal),
          betOutcomeText
        });
      }
    });
  });
  return index;
};

const normalizeExistingRow = row => ({
  season: row.season || '',
  book: row.book || '',
  odd_source: row.odd_source || row.odds_source || '',
  tournament_slug: row.tournament_slug || row.tournamentSlug || '',
  event: row.event || row.event_id || '',
  odds_generated_at: row.odds_generated_at || row.oddsGeneratedAt || row.generated_at || row.run_timestamp || '',
  odds_graded_at: row.odds_graded_at || row.oddsGradedAt || row.graded_at || row.gradedAt || '',
  player: row.player || row.player_name || '',
  dg_id: row.dg_id || row.dgId || row.player_id || '',
  market: row.market || '',
  odds: row.odds || row.odds_decimal || '',
  stake: row.stake || '',
  'settled stake': row['settled stake'] || row.settled_stake || row.settledStake || '',
  'total return': row['total return'] || row.total_return || row.totalReturn || '',
  net: row.net || '',
  roi: row.roi || '',
  '': row[''] || row.empty || '',
  p_model: row.p_model || row.pModel || '',
  p_implied: row.p_implied || row.pImplied || '',
  edge: row.edge || ''
});

const mergeRow = (existing, incoming, allowedKeys = null) => {
  const merged = { ...existing };
  Object.entries(incoming).forEach(([key, value]) => {
    if (key === 'odds_generated_at' && merged[key]) return;
    if (allowedKeys && !allowedKeys.has(key)) return;
    if (value !== '' && value !== null && value !== undefined) {
      merged[key] = value;
      return;
    }
    if (!(key in merged)) {
      merged[key] = value;
    }
  });
  return merged;
};


const main = () => {
  const args = parseArgs();
  const season = args.season;
  const market = args.market || 'all';
  const oddsSource = args.oddsSource || args.odds_source || 'historical';
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const isHistorical = oddsSourceKey === 'historical';
  const stake = args.stake ? Number(args.stake) : 10;
  const stakeMode = String(args.stakeMode || args.stake_mode || 'edge_scaled').trim().toLowerCase();
  const edgeShrinkArg = toNumber(args.edgeShrink || args.edge_shrink);
  const edgeShrink = Number.isFinite(edgeShrinkArg)
    ? clamp(edgeShrinkArg, 0, 1)
    : (oddsSourceKey === 'live' ? 0.5 : 1);
  const edgeShrinkMode = String(args.edgeShrinkMode || args.edge_shrink_mode || (oddsSourceKey === 'live' ? 'bucket' : 'flat'))
    .trim()
    .toLowerCase();
  const maxStakePct = toNumber(args.maxStakePct || args.max_stake_pct);
  const maxOddsArg = toNumber(args.maxOdds || args.max_odds);
  const resolvedMaxOdds = Number.isFinite(maxOddsArg)
    ? maxOddsArg
    : (oddsSourceKey === 'live' ? 101 : null);
  const liveTopNArg = toNumber(args.liveTopN || args.live_top_n);
  const liveTopN = Number.isFinite(liveTopNArg) ? liveTopNArg : 7;
  const matchupTopNArg = toNumber(args.matchupTopN || args.matchup_top_n);
  const matchupTopN = Number.isFinite(matchupTopNArg) ? matchupTopNArg : 3;
  const edgeFloorArg = toNumber(args.edgeFloor || args.edge_floor);
  const edgeFloor = Number.isFinite(edgeFloorArg) ? edgeFloorArg : 0;
  const matchupMinEdgeArg = toNumber(args.matchupMinEdge || args.matchup_min_edge);
  const matchupMinEdge = Number.isFinite(matchupMinEdgeArg) ? matchupMinEdgeArg : 0.05;
  const matchupEdgeFloorArg = toNumber(args.matchupEdgeFloor || args.matchup_edge_floor);
  const matchupEdgeFloor = Number.isFinite(matchupEdgeFloorArg) ? matchupEdgeFloorArg : edgeFloor;
  const matchupMinModelArg = toNumber(args.matchupMinModel || args.matchup_min_model);
  const matchupMinModel = Number.isFinite(matchupMinModelArg) ? matchupMinModelArg : 0.56;
  const selectionModeRaw = args.selectionMode || args.selection_mode || (oddsSourceKey === 'live' ? 'probability' : 'edge');
  const selectionMode = normalizeSelectionMode(selectionModeRaw);
  const edgeZPercentileArg = toNumber(args.edgeZPercentile || args.edge_z_percentile);
  const edgeZPercentile = normalizePercentile(Number.isFinite(edgeZPercentileArg) ? edgeZPercentileArg : 0.2);
  const edgeZScope = String(args.edgeZScope || args.edge_z_scope || 'market').trim().toLowerCase();
  const edgeZRelaxArg = String(args.edgeZRelaxToFill || args.edge_z_relax_to_fill || 'true').trim().toLowerCase();
  const edgeZRelaxToFill = edgeZRelaxArg !== 'false';
  const edgeTieDeltaArg = toNumber(args.edgeTieDelta || args.edge_tie_delta);
  const edgeTieDelta = Number.isFinite(edgeTieDeltaArg) ? edgeTieDeltaArg : 0.01;
  const pModelTieDeltaArg = toNumber(args.pModelTieDelta || args.p_model_tie_delta);
  const pModelTieDelta = Number.isFinite(pModelTieDeltaArg) ? pModelTieDeltaArg : 0.02;
  const allowNegativeEdge = selectionMode === 'probability'
    || edgeFloor < 0
    || matchupEdgeFloor < 0
    || String(args.allowNegativeEdge || args.allow_negative_edge || 'false').toLowerCase() === 'true';
  const tournamentMatchupMinModelArg = toNumber(args.tournamentMatchupMinModel || args.tournament_matchup_min_model);
  const tournamentMatchupMinModel = Number.isFinite(tournamentMatchupMinModelArg) ? tournamentMatchupMinModelArg : 0.52;
  const matchupMinModel3BallsArg = toNumber(args.matchupMinModel3Balls || args.matchup_min_model_3_balls || args.matchup_min_model_3balls);
  const matchupMinModel3Balls = Number.isFinite(matchupMinModel3BallsArg) ? matchupMinModel3BallsArg : 0.80;
  const outrightMinModelArg = toNumber(args.outrightMinModel || args.outright_min_model);
  const outrightMinModel = Number.isFinite(outrightMinModelArg) ? outrightMinModelArg : 0.015;
  const outrightMaxOddsArg = toNumber(args.outrightMaxOdds || args.outright_max_odds);
  const outrightMaxOdds = Number.isFinite(outrightMaxOddsArg) ? outrightMaxOddsArg : 25;
  const top5MinModelArg = toNumber(args.top5MinModel || args.top5_min_model);
  const top5MinModel = Number.isFinite(top5MinModelArg) ? top5MinModelArg : 0.50;
  const top5MaxOddsArg = toNumber(args.top5MaxOdds || args.top5_max_odds);
  const top5MaxOdds = Number.isFinite(top5MaxOddsArg) ? top5MaxOddsArg : 6;
  const top10MinModelArg = toNumber(args.top10MinModel || args.top10_min_model);
  const top10MinModel = Number.isFinite(top10MinModelArg) ? top10MinModelArg : 0.20;
  const top10MaxOddsArg = toNumber(args.top10MaxOdds || args.top10_max_odds);
  const top10MaxOdds = Number.isFinite(top10MaxOddsArg) ? top10MaxOddsArg : 10;
  const top20MinModelArg = toNumber(args.top20MinModel || args.top20_min_model);
  const top20MinModel = Number.isFinite(top20MinModelArg) ? top20MinModelArg : 0.25;
  const top20MaxOddsArg = toNumber(args.top20MaxOdds || args.top20_max_odds);
  const top20MaxOdds = Number.isFinite(top20MaxOddsArg) ? top20MaxOddsArg : 20;
  const totalStakeArg = toNumber(args.totalStake || args.total_stake || args.eventStake || args.event_stake);
  const resolvedTotalStake = Number.isFinite(totalStakeArg)
    ? totalStakeArg
    : (oddsSourceKey === 'live' ? 100 : null);
  const eventId = args.eventId || args.event_id || null;
  const reset = String(args.reset || 'false').toLowerCase() === 'true';
  const updateExisting = String(args.updateExisting || args.update_existing || 'true').toLowerCase() !== 'false';

  if (!season) {
    console.error('❌ Missing --season.');
    process.exit(1);
  }

  const isAllMarkets = String(market || '').trim().toLowerCase() === 'all';
  const oddsEvalFiles = (oddsSourceKey === 'live' && eventId)
    ? collectOddsEvalFilesAllMarkets({ oddsSource: oddsSourceKey, eventId })
    : (isAllMarkets
      ? collectOddsEvalFilesAllMarkets({ oddsSource: oddsSourceKey, eventId })
      : collectOddsEvalFiles({ market, oddsSource: oddsSourceKey }));

  if (!oddsEvalFiles.length) {
    console.error('❌ Could not find any odds_eval CSV files under data/wagering/*/inputs.');
    process.exit(1);
  }

  const inputRows = [];
  oddsEvalFiles.forEach(filePath => {
    const rows = readCsv(filePath);
    rows.forEach(row => {
      if (String(row.season || '').trim() !== String(season)) return;
      if (eventId && String(row.event_id || '').trim() !== String(eventId)) return;
      inputRows.push({ ...row, _filePath: filePath });
    });
  });

  if (!inputRows.length) {
    console.error('❌ No odds_eval rows found for the requested season.');
    process.exit(1);
  }

  const betRows = [];
  inputRows.forEach(row => {
    const pModel = Number(row.p_model);
    const pImplied = Number(row.p_implied);
    const oddsDecimal = Number(row.odds_decimal);
    const edge = Number(row.edge);
    if (!Number.isFinite(pModel) || !Number.isFinite(pImplied)) return;
    if (!Number.isFinite(oddsDecimal) || oddsDecimal <= 0) return;
    if (!Number.isFinite(edge)) return;
    if (!allowNegativeEdge && edge <= 0) return;
    const marketValue = normalizeMarketType(row.market_type || market);
    const bookValue = String(row.book || '').trim();
    const playerName = String(row.player_name || '').trim();
    if (!playerName) return;

    const shrinkFactor = edgeShrinkMode === 'bucket'
      ? resolveEdgeShrink({ market: marketValue, odds: oddsDecimal, defaultShrink: edgeShrink })
      : edgeShrink;
    const adjustedModel = pImplied + shrinkFactor * (pModel - pImplied);
    const adjustedEdge = adjustedModel - pImplied;
    if (!Number.isFinite(adjustedModel) || !Number.isFinite(adjustedEdge)) return;
    if (!allowNegativeEdge && adjustedEdge <= 0) return;

    const oddsMeta = resolveOddsMeta({
      oddsSourcePath: row.odds_source_path,
      dgId: row.player_id,
      playerName: playerName,
      isHistorical
    });

    if (!isOddsSourceMatch(marketValue, row.odds_source_path)) return;

    const displayName = resolveMatchupLabel({
      market: marketValue,
      dgId: row.player_id,
      playerName,
      oddsSourcePath: row.odds_source_path
    });

    betRows.push({
      season: String(row.season || season),
      book: bookValue,
      odd_source: oddsSourceKey,
      tournament_slug: extractTournamentSlug(row._filePath),
      event: row.event_id || eventId || '',
      odds_generated_at: oddsMeta.odds_generated_at || row.run_timestamp || '',
      odds_graded_at: oddsMeta.graded_at || '',
      player: displayName,
      dg_id: String(row.player_id || '').trim(),
      market: marketValue,
      odds: oddsDecimal,
      stake: Number.isFinite(stake) ? Math.round(stake) : '',
      'settled stake': '',
      'total return': '',
      net: '',
      roi: '',
      '': '',
      p_model: adjustedModel,
      p_implied: pImplied,
      edge: adjustedEdge,
      edge_z: toNumber(row.edge_z)
    });
  });

  const outputDir = resolveWageringInputsDir();
  ensureDir(outputDir);
  const outputCsv = path.resolve(outputDir, 'betting-card.csv');
  const inputsJson = path.resolve(outputDir, 'inputs.json');
  const inputsCsv = path.resolve(outputDir, 'inputs.csv');

  const existingRows = (!reset && updateExisting && fs.existsSync(outputCsv))
    ? readCsv(outputCsv)
    : [];
  const normalizedExisting = existingRows
    .map(normalizeExistingRow);

  const filteredExisting = (oddsSourceKey === 'live' && eventId)
    ? normalizedExisting.filter(row => !(
      String(row.odd_source || '').toLowerCase() === 'live'
      && String(row.event || '') === String(eventId)
    ))
    : normalizedExisting;


  // Keep existing rows for running list behavior; only add new bets when they don't already exist.

  const existingEventKeys = new Set(
    filteredExisting
      .filter(row => row.tournament_slug || row.event)
      .map(row => `${row.odd_source || ''}||${row.tournament_slug || ''}||${row.event || ''}`)
  );

  const rowList = [...filteredExisting];
  const rowIndex = new Map();
  rowList.forEach((row, idx) => {
    if (!row.dg_id) return;
    const key = buildBetKey({
      event: row.event,
      market: row.market,
      book: row.book,
      dgId: row.dg_id
    });
    if (!rowIndex.has(key)) {
      rowIndex.set(key, idx);
    }
  });

  const historicalUpdateKeys = new Set([
    'odd_source',
    'odds_graded_at',
    'settled stake',
    'total return',
    'net',
    'roi'
  ]);
  const dedupeByPlayer = rows => {
    const byId = new Map();
    rows.forEach(row => {
      const dgId = String(row.dg_id || '').trim();
      if (!dgId) return;
      const current = byId.get(dgId);
      if (!current) {
        byId.set(dgId, row);
        return;
      }
      const oddsValue = Number(row.odds);
      const currentOdds = Number(current.odds);
      if (Number.isFinite(oddsValue) && (!Number.isFinite(currentOdds) || oddsValue > currentOdds)) {
        byId.set(dgId, row);
      }
    });
    return Array.from(byId.values());
  };

  const liveRows = oddsSourceKey === 'live'
    ? (() => {
      const matchupMarkets = new Set([
        'tournament_matchups',
        'round_matchups',
        '3_balls',
        '3balls',
        '3-ball',
        '3ball',
        'matchups'
      ]);
      const capped = [...betRows]
        .filter(row => (
          Number.isFinite(resolvedMaxOdds)
            ? Number(row.odds) <= resolvedMaxOdds
            : true
        ));

      const isThreeBallMarket = value => {
        const normalized = normalizeMarketType(value || '');
        return ['3_balls', '3balls', '3-ball', '3ball'].includes(normalized);
      };
      const isTournamentMatchupMarket = value => normalizeMarketType(value || '') === 'tournament_matchups';
      const isOutrightMarket = value => {
        const normalized = normalizeMarketType(value || '');
        return ['win', 'outright_win'].includes(normalized);
      };
      const isTop5Market = value => {
        const normalized = normalizeMarketType(value || '');
        return normalized === 'top_5';
      };
      const isTop10Market = value => {
        const normalized = normalizeMarketType(value || '');
        return normalized === 'top_10';
      };
      const isTop20Market = value => {
        const normalized = normalizeMarketType(value || '');
        return normalized === 'top_20';
      };
      const matchupRows = capped
        .filter(row => matchupMarkets.has(normalizeMarketType(row.market)));
      matchupRows.forEach(row => {
        row.isMatchup = true;
      });
      const nonMatchupRows = capped
        .filter(row => !matchupMarkets.has(normalizeMarketType(row.market)))
        .filter(row => {
          const oddsValue = Number(row.odds);
          const modelValue = Number(row.p_model);
          if (isOutrightMarket(row.market)) {
            if (Number.isFinite(outrightMaxOdds) && Number.isFinite(oddsValue) && oddsValue > outrightMaxOdds) return false;
            if (Number.isFinite(modelValue) && modelValue < outrightMinModel) return false;
            return true;
          }
          if (isTop5Market(row.market)) {
            if (Number.isFinite(top5MaxOdds) && Number.isFinite(oddsValue) && oddsValue > top5MaxOdds) return false;
            if (Number.isFinite(modelValue) && modelValue < top5MinModel) return false;
            return true;
          }
          if (isTop10Market(row.market)) {
            if (Number.isFinite(top10MaxOdds) && Number.isFinite(oddsValue) && oddsValue > top10MaxOdds) return false;
            if (Number.isFinite(modelValue) && modelValue < top10MinModel) return false;
            return true;
          }
          if (isTop20Market(row.market)) {
            if (Number.isFinite(top20MaxOdds) && Number.isFinite(oddsValue) && oddsValue > top20MaxOdds) return false;
            if (Number.isFinite(modelValue) && modelValue < top20MinModel) return false;
            return true;
          }
          return true;
        });
      nonMatchupRows.forEach(row => {
        row.isMatchup = false;
      });

      const applyEdgeFloor = (rows, floorValue) => {
        if (!Number.isFinite(floorValue)) return rows;
        return rows.filter(row => Number(row.edge) >= floorValue);
      };
      const applyEdgeZFilter = rows => applyEdgeZPercentile(rows, edgeZPercentile, {
        scope: edgeZScope,
        getKey: row => normalizeMarketType(row.market)
      });

      let matchupBase = matchupRows
        .filter(row => {
          const minModel = isThreeBallMarket(row.market)
            ? matchupMinModel3Balls
            : (isTournamentMatchupMarket(row.market) ? tournamentMatchupMinModel : matchupMinModel);
          return Number(row.p_model) >= minModel;
        });
      matchupBase = applyEdgeFloor(matchupBase, matchupEdgeFloor);
      matchupBase = dedupeByPlayer(matchupBase);

      let matchupCandidates = applyEdgeZFilter(matchupBase);
      matchupCandidates = dedupeByPlayer(matchupCandidates);

      let nonMatchupBase = applyEdgeFloor(nonMatchupRows, edgeFloor);
      nonMatchupBase = dedupeByPlayer(nonMatchupBase);

      let nonMatchupCandidates = applyEdgeZFilter(nonMatchupBase);
      nonMatchupCandidates = dedupeByPlayer(nonMatchupCandidates);

      const selectedBase = rankCandidates(nonMatchupCandidates, { mode: selectionMode })
        .slice(0, liveTopN);
      const selectedMatchups = rankCandidates(matchupCandidates, { mode: selectionMode })
        .slice(0, matchupTopN);

      const combined = [...selectedBase];
      const existingKeys = new Set(
        combined.map(row => buildBetKey({
          event: row.event,
          market: row.market,
          book: row.book,
          dgId: row.dg_id
        }))
      );
      selectedMatchups.forEach(row => {
        const key = buildBetKey({
          event: row.event,
          market: row.market,
          book: row.book,
          dgId: row.dg_id
        });
        if (!existingKeys.has(key)) {
          combined.push(row);
          existingKeys.add(key);
        }
      });
      const desiredTotal = liveTopN + matchupTopN;
      if (combined.length < desiredTotal) {
        let extraNeeded = desiredTotal - combined.length;
        const remainingCandidates = [...nonMatchupCandidates, ...matchupCandidates]
          .filter(row => !existingKeys.has(buildBetKey({
            event: row.event,
            market: row.market,
            book: row.book,
            dgId: row.dg_id
          })));
        const extras = rankCandidates(remainingCandidates, {
          mode: selectionMode,
          preferMatchup: true,
          edgeTieDelta,
          pModelTieDelta
        }).slice(0, extraNeeded);
        extras.forEach(row => {
          const key = buildBetKey({
            event: row.event,
            market: row.market,
            book: row.book,
            dgId: row.dg_id
          });
          if (!existingKeys.has(key)) {
            combined.push(row);
            existingKeys.add(key);
            extraNeeded -= 1;
          }
        });

        if (extraNeeded > 0 && edgeZRelaxToFill) {
          const relaxedPool = [...nonMatchupBase, ...matchupBase]
            .filter(row => !existingKeys.has(buildBetKey({
              event: row.event,
              market: row.market,
              book: row.book,
              dgId: row.dg_id
            })));
          const relaxedExtras = rankCandidates(relaxedPool, {
            mode: selectionMode,
            preferMatchup: true,
            edgeTieDelta,
            pModelTieDelta
          }).slice(0, extraNeeded);
          relaxedExtras.forEach(row => {
            const key = buildBetKey({
              event: row.event,
              market: row.market,
              book: row.book,
              dgId: row.dg_id
            });
            if (!existingKeys.has(key)) {
              combined.push(row);
              existingKeys.add(key);
            }
          });
        }
      }
      return combined;
    })()
    : betRows;

  const resolveWeightedStakes = (rows, options = {}) => {
    const totalStake = Number.isFinite(options.totalStake) ? options.totalStake : rows.length * (Number.isFinite(stake) ? stake : 0);
    if (!rows.length || !Number.isFinite(totalStake) || totalStake <= 0) return null;
    const capPct = Number.isFinite(options.maxStakePct) ? options.maxStakePct : 0.2;
    const capValue = Number.isFinite(capPct) ? totalStake * capPct : null;

    const weights = rows.map((row, index) => {
      const modelProb = toNumber(row.p_model);
      const edgeValue = toNumber(row.edge);
      const weight = Number.isFinite(modelProb) && modelProb > 0
        ? modelProb
        : (Number.isFinite(edgeValue) && edgeValue > 0 ? edgeValue : 0);
      return { index, weight };
    });

    let remaining = weights.filter(entry => entry.weight > 0);
    if (!remaining.length) return null;
    let remainingStake = totalStake;
    const allocations = new Map();

    while (remaining.length && remainingStake > 0) {
      const totalWeight = remaining.reduce((sum, entry) => sum + entry.weight, 0);
      if (totalWeight <= 0) break;

      const capped = [];
      const uncapped = [];
      const provisional = [];

      remaining.forEach(entry => {
        const portion = remainingStake * (entry.weight / totalWeight);
        if (Number.isFinite(capValue) && capValue !== null && portion > capValue) {
          allocations.set(entry.index, capValue);
          capped.push(entry);
        } else {
          provisional.push({ index: entry.index, portion });
          uncapped.push(entry);
        }
      });

      if (Number.isFinite(capValue) && capValue !== null && capped.length) {
        remainingStake = remainingStake - (capValue * capped.length);
        remaining = uncapped;
        if (remainingStake <= 0) break;
        continue;
      }

      provisional.forEach(entry => allocations.set(entry.index, entry.portion));
      break;
    }

    if (!allocations.size) return null;
    if (Number.isFinite(totalStake)) {
      const roundedEntries = Array.from(allocations.entries()).map(([index, value]) => {
        const floored = Math.floor(value);
        return {
          index,
          value,
          floored,
          frac: value - floored
        };
      });
      let sum = roundedEntries.reduce((acc, entry) => acc + entry.floored, 0);
      let diff = Math.round(totalStake - sum);
      if (diff !== 0) {
        const sorted = [...roundedEntries].sort((a, b) => b.frac - a.frac);
        if (diff > 0) {
          for (let i = 0; i < sorted.length && diff > 0; i += 1) {
            sorted[i].floored += 1;
            diff -= 1;
          }
        } else {
          const reverse = [...roundedEntries].sort((a, b) => a.frac - b.frac);
          for (let i = 0; i < reverse.length && diff < 0; i += 1) {
            if (reverse[i].floored > 0) {
              reverse[i].floored -= 1;
              diff += 1;
            }
          }
        }
      }
      allocations.clear();
      roundedEntries.forEach(entry => {
        allocations.set(entry.index, entry.floored);
      });
    }
    return { allocations, totalStake };
  };

  if (oddsSourceKey === 'live' && stakeMode !== 'flat') {
    let resolvedMaxStakePct = Number.isFinite(maxStakePct) ? maxStakePct : null;
    if (!Number.isFinite(resolvedMaxStakePct)) {
      const betCount = liveRows.length || 0;
      if (betCount > 0) {
        const scaledCap = 2 / betCount;
        resolvedMaxStakePct = clamp(scaledCap, 0.2, 0.5);
      }
    }
    const weighted = resolveWeightedStakes(liveRows, {
      totalStake: resolvedTotalStake,
      maxStakePct: Number.isFinite(resolvedMaxStakePct) ? resolvedMaxStakePct : 0.2
    });
    if (weighted) {
      liveRows.forEach((row, index) => {
        const stakeValue = weighted.allocations.get(index);
        if (Number.isFinite(stakeValue)) {
          row.stake = Math.round(stakeValue);
        }
      });
    }
  }

  const emptyRowIndexes = rowList
    .map((row, idx) => (!row.player ? idx : null))
    .filter(idx => idx !== null);

  liveRows.forEach((row, index) => {
    const key = buildBetKey({
      event: row.event,
      market: row.market,
      book: row.book,
      dgId: row.dg_id
    });
    if (rowIndex.has(key)) {
      const idx = rowIndex.get(key);
      if (isHistorical) {
        rowList[idx] = mergeRow(rowList[idx], row, historicalUpdateKeys);
      } else {
        rowList[idx] = mergeRow(rowList[idx], row);
      }
      return;
    }
    if (isHistorical) {
      return;
    }
    if (oddsSourceKey === 'live' && emptyRowIndexes.length) {
      const targetIdx = emptyRowIndexes.shift();
      rowList[targetIdx] = mergeRow(rowList[targetIdx], row);
      rowIndex.set(key, targetIdx);
      return;
    }
    rowIndex.set(key, rowList.length);
    rowList.push(row);
  });

  if (updateExisting) {
    const outcomeIndex = buildOutcomeIndex({ eventId: eventId || null });
    rowList.forEach(row => {
      if (row.net && row.roi && row['total return'] && row['settled stake']) return;
      const key = buildOutcomeKey({
        event: row.event,
        market: row.market,
        book: row.book,
        dgId: row.dg_id
      });
      const outcome = outcomeIndex.get(key);
      if (!outcome) return;
      const stakeValue = Number(row.stake);
      const oddsValue = Number(row.odds) || Number(outcome.odds);
      if (!Number.isFinite(stakeValue) || !Number.isFinite(oddsValue)) return;
      const settledStake = stakeValue;
      let totalReturn = 0;
      if (outcome.isPush) {
        totalReturn = settledStake;
      } else if (Number.isFinite(outcome.winFactor) && outcome.winFactor > 0) {
        totalReturn = settledStake * oddsValue * outcome.winFactor;
      }
      const net = totalReturn - settledStake;
      row['settled stake'] = settledStake.toFixed(2);
      row['total return'] = totalReturn.toFixed(2);
      row.net = net.toFixed(2);
      row.roi = settledStake > 0 ? (net / settledStake).toFixed(4) : '';
    });
  }

  writeCsv(outputCsv, rowList, [
    'season',
    'book',
    'odd_source',
    'tournament_slug',
    'event',
    'odds_generated_at',
    'odds_graded_at',
    'player',
    'dg_id',
    'market',
    'odds',
    'stake',
    'settled stake',
    'total return',
    'net',
    'roi',
    '',
    'p_model',
    'p_implied',
    'edge'
  ]);

  const outputJson = path.resolve(outputDir, 'betting-card.json');
  const headerKeys = [
    'season',
    'book',
    'odd_source',
    'tournament_slug',
    'event',
    'odds_generated_at',
    'odds_graded_at',
    'player',
    'dg_id',
    'market',
    'odds',
    'stake',
    'settled stake',
    'total return',
    'net',
    'roi',
    '',
    'p_model',
    'p_implied',
    'edge'
  ];
  const jsonPayload = {
    source: 'data/wagering/betting-card.csv',
    updated_at: new Date().toISOString(),
    headers: headerKeys.map(header => header || 'empty'),
    rows: rowList.map(row => {
      const out = {};
      headerKeys.forEach(header => {
        const key = header || 'empty';
        out[key] = row[header] ?? '';
      });
      return out;
    })
  };
  fs.writeFileSync(outputJson, `${JSON.stringify(jsonPayload, null, 2)}\n`);

  const inputsPayload = {
    season: String(season),
    market: String(market),
    odds_source: oddsSourceKey,
    generated_at: new Date().toISOString(),
    odds_eval_files: oddsEvalFiles
  };

  const existingInputs = fs.existsSync(inputsJson)
    ? JSON.parse(fs.readFileSync(inputsJson, 'utf8'))
    : {};
  const mergedInputs = { ...existingInputs };
  if (!mergedInputs[oddsSourceKey]) {
    mergedInputs[oddsSourceKey] = [];
  }
  if (!Array.isArray(mergedInputs[oddsSourceKey])) {
    mergedInputs[oddsSourceKey] = [mergedInputs[oddsSourceKey]];
  }
  mergedInputs[oddsSourceKey].push(inputsPayload);
  fs.writeFileSync(inputsJson, `${JSON.stringify(mergedInputs, null, 2)}\n`);

  const inputRowsForCsv = Object.entries(mergedInputs).flatMap(([source, payloads]) => {
    const list = Array.isArray(payloads) ? payloads : [payloads];
    return list.flatMap(payload => (payload.odds_eval_files || []).map(filePath => ({
      season: payload.season || String(season),
      market: payload.market || String(market),
      odds_source: source,
      odds_eval_path: filePath,
      generated_at: payload.generated_at || ''
    })));
  });
  writeCsv(inputsCsv, inputRowsForCsv, ['season', 'market', 'odds_source', 'odds_eval_path', 'generated_at']);

  console.log(`✓ Betting card saved to ${outputCsv}`);
  console.log(`✓ Betting card JSON saved to ${outputJson}`);
  console.log(`✓ Inputs saved to ${inputsJson} and ${inputsCsv}`);
};

main();
