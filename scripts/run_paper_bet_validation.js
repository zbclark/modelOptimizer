const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const ODDS_ARCHIVE_DIR = path.resolve(DATA_DIR, 'wagering', 'odds_archive');

const DEFAULT_MARKETS = ['win', 'top_5', 'top_10', 'top_20', 'make_cut', 'mc'];
const DEFAULT_BOOKS_OUTRIGHTS = ['bet365', 'caesars', 'sportsbook', 'draftkings'];
const DEFAULT_BOOKS_MATCHUPS = ['bet365', 'caesars', 'sportsbook', 'draftkings'];
const VALIDATION_DIR = path.resolve(DATA_DIR, 'wagering', 'validation');

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

const parseListArg = value => {
  if (!value) return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const readJson = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
};

const ensureDir = dirPath => {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const listSeasonTournamentDirs = season => {
  const seasonDir = path.resolve(DATA_DIR, String(season));
  if (!fs.existsSync(seasonDir)) return [];
  return fs
    .readdirSync(seasonDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => entry.name !== 'validation_outputs')
    .filter(entry => entry.name.toLowerCase() !== 'all')
    .map(entry => path.resolve(seasonDir, entry.name));
};

const resolveLatestBySuffix = (dirPath, suffix) => {
  if (!dirPath || !fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath)
    .filter(name => name.toLowerCase().endsWith(suffix.toLowerCase()))
    .map(name => path.resolve(dirPath, name));
  if (!files.length) return null;
  files.sort((a, b) => {
    const aTime = fs.statSync(a).mtimeMs || 0;
    const bTime = fs.statSync(b).mtimeMs || 0;
    return bTime - aTime;
  });
  return files[0];
};

const resolvePreEventResultsPath = tournamentDir => {
  if (!tournamentDir) return null;
  const preEventDir = path.resolve(tournamentDir, 'pre_event');
  if (!fs.existsSync(preEventDir)) return null;
  const files = fs.readdirSync(preEventDir)
    .filter(name => name.toLowerCase().endsWith('_pre_event_results.json'))
    .map(name => path.resolve(preEventDir, name));
  if (!files.length) return null;
  files.sort((a, b) => {
    const aTime = fs.statSync(a).mtimeMs || 0;
    const bTime = fs.statSync(b).mtimeMs || 0;
    return bTime - aTime;
  });
  return files[0];
};

const resolvePostEventResultsPath = tournamentDir => {
  if (!tournamentDir) return null;
  const postEventDir = path.resolve(tournamentDir, 'post_event');
  if (!fs.existsSync(postEventDir)) return null;
  const files = fs.readdirSync(postEventDir)
    .filter(name => name.toLowerCase().endsWith('_results.json'))
    .filter(name => !name.toLowerCase().includes('pre_event'))
    .map(name => path.resolve(postEventDir, name));
  if (!files.length) return null;
  files.sort((a, b) => {
    const aTime = fs.statSync(a).mtimeMs || 0;
    const bTime = fs.statSync(b).mtimeMs || 0;
    return bTime - aTime;
  });
  return files[0];
};

const parseFinishPosition = value => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'CUT' || raw === 'WD' || raw === 'DQ') return null;
  if (raw.startsWith('T')) {
    const parsed = parseInt(raw.substring(1), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (/^\d+T$/.test(raw)) {
    const parsed = parseInt(raw.replace('T', ''), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const buildRankBucket = (rank, totalPlayers, bucketCount) => {
  if (!Number.isFinite(rank) || !Number.isFinite(totalPlayers) || totalPlayers <= 0) return null;
  const pct = Math.max(0, Math.min(1, (rank - 1) / totalPlayers));
  return Math.min(bucketCount - 1, Math.floor(pct * bucketCount));
};

const buildRankingIndex = preEventPayload => {
  const players = preEventPayload?.preEventRanking?.players || [];
  const totalPlayers = preEventPayload?.preEventRanking?.totalPlayers || players.length;
  const byId = new Map();
  players.forEach(player => {
    const dgId = String(player?.dgId || '').trim();
    if (!dgId) return;
    byId.set(dgId, {
      dgId,
      name: player?.name || null,
      rank: typeof player?.rank === 'number' ? player.rank : null
    });
  });
  return { byId, totalPlayers };
};

const buildResultsIndex = resultsPayload => {
  const rows = resultsPayload?.results || [];
  const byId = new Map();
  rows.forEach(row => {
    const dgId = String(row?.['DG ID'] || row?.dgId || '').trim();
    if (!dgId) return;
    const finishText = row?.['Finish Position'] || row?.finishPosition || row?.finishText || '';
    byId.set(dgId, { finishText });
  });
  return { byId };
};

const loadCalibrationBuckets = calibrationPath => {
  const payload = readJson(calibrationPath);
  const buckets = payload?.calibrationBuckets?.buckets || [];
  if (!buckets.length) return null;
  const bucketCount = payload?.calibrationBuckets?.bucketCount || buckets.length;
  const stats = Array.from({ length: bucketCount }).map(() => ({
    count: 0,
    wins: 0,
    top5: 0,
    top10: 0,
    top20: 0
  }));
  buckets.forEach(entry => {
    const idx = entry?.bucket;
    if (typeof idx !== 'number' || !stats[idx]) return;
    stats[idx].count = entry?.count || 0;
    stats[idx].top5 = entry?.top5 || 0;
    stats[idx].top10 = entry?.top10 || 0;
    stats[idx].top20 = entry?.top20 || 0;
  });
  return { bucketCount, stats };
};

const buildBucketStats = (events, bucketCount) => {
  const statsByMarket = {};
  const initMarket = market => {
    if (statsByMarket[market]) return;
    statsByMarket[market] = Array.from({ length: bucketCount }).map(() => ({ count: 0, wins: 0 }));
  };

  events.forEach(event => {
    const { rankingIndex, resultsIndex } = event;
    if (!rankingIndex || !resultsIndex) return;
    rankingIndex.byId.forEach(player => {
      if (!player || !Number.isFinite(player.rank)) return;
      const results = resultsIndex.byId.get(player.dgId);
      if (!results) return;
      const finish = parseFinishPosition(results.finishText);
      const bucket = buildRankBucket(player.rank, rankingIndex.totalPlayers, bucketCount);
      if (bucket === null) return;

      const isWin = finish === 1;
      const isTop5 = typeof finish === 'number' && finish <= 5;
      const isTop10 = typeof finish === 'number' && finish <= 10;
      const isTop20 = typeof finish === 'number' && finish <= 20;
      const madeCut = typeof finish === 'number';

      initMarket('win');
      initMarket('top_5');
      initMarket('top_10');
      initMarket('top_20');
      initMarket('make_cut');
      initMarket('mc');

      statsByMarket.win[bucket].count += 1;
      statsByMarket.win[bucket].wins += isWin ? 1 : 0;

      statsByMarket.top_5[bucket].count += 1;
      statsByMarket.top_5[bucket].wins += isTop5 ? 1 : 0;

      statsByMarket.top_10[bucket].count += 1;
      statsByMarket.top_10[bucket].wins += isTop10 ? 1 : 0;

      statsByMarket.top_20[bucket].count += 1;
      statsByMarket.top_20[bucket].wins += isTop20 ? 1 : 0;

      statsByMarket.make_cut[bucket].count += 1;
      statsByMarket.make_cut[bucket].wins += madeCut ? 1 : 0;

      statsByMarket.mc[bucket].count += 1;
      statsByMarket.mc[bucket].wins += madeCut ? 0 : 1;
    });
  });

  return statsByMarket;
};

const buildMatchupBucketStats = (matchupsByEvent, bucketCount) => {
  const stats = Array.from({ length: bucketCount }).map(() => ({ count: 0, wins: 0 }));
  matchupsByEvent.forEach(event => {
    const { rankingIndex, matchups } = event;
    if (!rankingIndex || !matchups || !matchups.length) return;

    matchups.forEach(entry => {
      const participants = [
        { dgId: entry.p1_dg_id, outcome: entry.p1_outcome, odds: entry.p1_open },
        { dgId: entry.p2_dg_id, outcome: entry.p2_outcome, odds: entry.p2_open },
        { dgId: entry.p3_dg_id, outcome: entry.p3_outcome, odds: entry.p3_open }
      ].filter(item => item && item.dgId !== undefined && item.dgId !== null);

      if (!participants.length) return;
      const ranked = participants
        .map(item => {
          const dgId = String(item.dgId).trim();
          const ranking = rankingIndex.byId.get(dgId);
          return {
            ...item,
            dgId,
            rank: ranking?.rank ?? null
          };
        })
        .filter(item => Number.isFinite(item.rank));

      if (!ranked.length) return;
      ranked.sort((a, b) => a.rank - b.rank);
      const pick = ranked[0];
      const bucket = buildRankBucket(pick.rank, rankingIndex.totalPlayers, bucketCount);
      if (bucket === null) return;
      const outcome = typeof pick.outcome === 'number' ? pick.outcome : 0;
      stats[bucket].count += 1;
      stats[bucket].wins += outcome;
    });
  });

  return stats;
};

const computeModelProb = (stats, bucket) => {
  if (!stats || bucket === null || !stats[bucket]) return null;
  const { count, wins } = stats[bucket];
  if (!count) return null;
  return wins / count;
};

const applyStakeCap = (stake, bankroll, maxStake, maxStakePct) => {
  let capped = stake;
  const pctCap = Number.isFinite(maxStakePct) && Number.isFinite(bankroll)
    ? bankroll * maxStakePct
    : null;
  const absCap = Number.isFinite(maxStake) ? maxStake : null;
  if (Number.isFinite(pctCap)) {
    capped = Math.min(capped, pctCap);
  }
  if (Number.isFinite(absCap)) {
    capped = Math.min(capped, absCap);
  }
  return capped;
};

const computeKellyStake = (prob, odds, bankroll, fraction, maxStake, maxStakePct) => {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || odds <= 1) return 0;
  const b = odds - 1;
  const f = (prob * b - (1 - prob)) / b;
  if (!Number.isFinite(f) || f <= 0) return 0;
  const stake = bankroll * fraction * f;
  return applyStakeCap(stake, bankroll, maxStake, maxStakePct);
};

const computeKellyFraction = (prob, odds, fraction) => {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || odds <= 1) return 0;
  const b = odds - 1;
  const f = (prob * b - (1 - prob)) / b;
  if (!Number.isFinite(f) || f <= 0) return 0;
  return fraction * f;
};

const computeMarketWin = (market, finishText) => {
  const finish = parseFinishPosition(finishText);
  if (market === 'win') return finish === 1 ? 1 : 0;
  if (market === 'top_5') return typeof finish === 'number' && finish <= 5 ? 1 : 0;
  if (market === 'top_10') return typeof finish === 'number' && finish <= 10 ? 1 : 0;
  if (market === 'top_20') return typeof finish === 'number' && finish <= 20 ? 1 : 0;
  if (market === 'make_cut') return typeof finish === 'number' ? 1 : 0;
  if (market === 'mc') return typeof finish === 'number' ? 0 : 1;
  return 0;
};

const evaluateOddsEntries = ({
  entries,
  rankingIndex,
  resultsIndex,
  bucketStats,
  bucketCount,
  market,
  edgeThreshold,
  bankroll,
  kellyFraction,
  maxStake,
  maxStakePct,
  useResults = true,
  useOutcomeField = false,
  collectBets = false,
  eventId = null,
  book = null
}) => {
  const summary = {
    market,
    bets: 0,
    wins: 0,
    profit: 0,
    stake: 0,
    avgEdge: 0
  };
  let edgeSum = 0;
  const betsPlaced = [];

  entries.forEach(entry => {
    const dgId = String(entry?.dg_id ?? entry?.dgId ?? entry?.player_id ?? '').trim();
    if (!dgId) return;
    const ranking = rankingIndex?.byId?.get(dgId);
    if (!ranking || !Number.isFinite(ranking.rank)) return;
    const bucket = buildRankBucket(ranking.rank, rankingIndex.totalPlayers, bucketCount);
    if (bucket === null) return;

    const odds = Number(entry.open_odds ?? entry.open ?? entry.open_price ?? entry.open_price_dec);
    if (!Number.isFinite(odds) || odds <= 1) return;

    const modelProb = computeModelProb(bucketStats, bucket);
    if (!Number.isFinite(modelProb)) return;

    const impliedProb = 1 / odds;
    const edge = modelProb - impliedProb;
    if (edge < edgeThreshold) return;

    const stake = computeKellyStake(modelProb, odds, bankroll, kellyFraction, maxStake, maxStakePct);
    if (!stake || stake <= 0) return;

    let won = 0;
    let winFactor = 0;

    if (useOutcomeField) {
      winFactor = typeof entry.bet_outcome_numeric === 'number' ? entry.bet_outcome_numeric : 0;
      won = winFactor > 0 ? 1 : 0;
    } else if (useResults) {
      const results = resultsIndex?.byId?.get(dgId);
      if (!results) return;
      won = computeMarketWin(market, results.finishText);
      winFactor = won ? 1 : 0;
    }

    const profit = winFactor > 0 ? stake * (odds - 1) * winFactor : -stake;

    summary.bets += 1;
    summary.wins += won;
    summary.profit += profit;
    summary.stake += stake;
    edgeSum += edge;

    if (collectBets) {
      betsPlaced.push({
        season: null,
        eventId,
        market,
        book,
        dgId,
        playerName: entry.player_name || entry.playerName || null,
        rank: ranking.rank,
        bucket,
        modelProb,
        impliedProb,
        edge,
        openOdds: odds,
        stake,
        won,
        profit
      });
    }
  });

  if (summary.bets > 0) {
    summary.hitRate = summary.wins / summary.bets;
    summary.roi = summary.profit / summary.stake;
    summary.avgEdge = edgeSum / summary.bets;
  } else {
    summary.hitRate = 0;
    summary.roi = 0;
    summary.avgEdge = 0;
  }

  return { summary, betsPlaced };
};

const computeKellyRawStake = (prob, odds, bankroll, fraction) => {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || odds <= 1) return 0;
  const b = odds - 1;
  const f = (prob * b - (1 - prob)) / b;
  if (!Number.isFinite(f) || f <= 0) return 0;
  return bankroll * fraction * f;
};

const resolveTopBetWeight = ({ mode, bet, bankroll, kellyFraction }) => {
  const safeMode = String(mode || 'kelly_weighted').toLowerCase();
  if (safeMode === 'edge_scaled' || safeMode === 'edge') {
    return Number.isFinite(bet.edge) && bet.edge > 0 ? bet.edge : 0;
  }
  if (safeMode === 'kelly_scaled') {
    return computeKellyRawStake(bet.modelProb, bet.openOdds, bankroll, kellyFraction);
  }
  return bet.kellyWeight || 0;
};

const buildTopProbBetsForEvent = ({
  event,
  markets,
  booksOutrights,
  booksMatchups,
  bucketStatsByMarket,
  matchupBucketStats,
  bucketCount,
  kellyFraction,
  topProbBets,
  eventStake,
  maxStake,
  maxStakePct,
  topProbStakeMode
}) => {
  const candidates = [];

  markets.forEach(market => {
    if (market === 'matchups') return;
    const bucketStats = bucketStatsByMarket[market];
    if (!bucketStats) return;

    booksOutrights.forEach(book => {
      const entries = loadOddsEntries({ season: event.season, eventId: event.eventId, market, book });
      if (!entries.length) return;

      entries.forEach(entry => {
        const dgId = String(entry?.dg_id ?? entry?.dgId ?? entry?.player_id ?? '').trim();
        if (!dgId) return;
        const ranking = event.rankingIndex?.byId?.get(dgId);
        if (!ranking || !Number.isFinite(ranking.rank)) return;
        const bucket = buildRankBucket(ranking.rank, event.rankingIndex.totalPlayers, bucketCount);
        if (bucket === null) return;

        const odds = Number(entry.open_odds ?? entry.open ?? entry.open_price ?? entry.open_price_dec);
        if (!Number.isFinite(odds) || odds <= 1) return;

        const modelProb = computeModelProb(bucketStats, bucket);
        if (!Number.isFinite(modelProb)) return;

        const kellyWeight = computeKellyFraction(modelProb, odds, kellyFraction);
        if (!kellyWeight || kellyWeight <= 0) return;

        const impliedProb = 1 / odds;
        const edge = modelProb - impliedProb;
        const results = event.resultsIndex?.byId?.get(dgId);
        if (!results) return;
        const won = computeMarketWin(market, results.finishText);
        const winFactor = won ? 1 : 0;

        candidates.push({
          season: event.season,
          eventId: event.eventId,
          market,
          book,
          dgId,
          playerName: entry.player_name || entry.playerName || null,
          rank: ranking.rank,
          bucket,
          modelProb,
          impliedProb,
          edge,
          openOdds: odds,
          won,
          winFactor,
          kellyWeight
        });
      });
    });
  });

  if (Array.isArray(matchupBucketStats) && matchupBucketStats.length) {
    booksMatchups.forEach(book => {
      const entries = loadMatchupsEntries({ season: event.season, eventId: event.eventId, book });
      if (!entries.length) return;

      entries.forEach(entry => {
        const participants = [
          { dgId: entry.p1_dg_id, outcome: entry.p1_outcome, odds: entry.p1_open, name: entry.p1_player_name },
          { dgId: entry.p2_dg_id, outcome: entry.p2_outcome, odds: entry.p2_open, name: entry.p2_player_name },
          { dgId: entry.p3_dg_id, outcome: entry.p3_outcome, odds: entry.p3_open, name: entry.p3_player_name }
        ].filter(item => item && item.dgId !== undefined && item.dgId !== null);

        if (!participants.length) return;

        const ranked = participants
          .map(item => {
            const dgId = String(item.dgId).trim();
            const ranking = event.rankingIndex?.byId?.get(dgId);
            return {
              ...item,
              dgId,
              rank: ranking?.rank ?? null
            };
          })
          .filter(item => Number.isFinite(item.rank));

        if (!ranked.length) return;
        ranked.sort((a, b) => a.rank - b.rank);
        const pick = ranked[0];
        const bucket = buildRankBucket(pick.rank, event.rankingIndex.totalPlayers, bucketCount);
        if (bucket === null) return;

        const odds = Number(pick.odds);
        if (!Number.isFinite(odds) || odds <= 1) return;

        const modelProb = computeModelProb(matchupBucketStats, bucket);
        if (!Number.isFinite(modelProb)) return;

        const kellyWeight = computeKellyFraction(modelProb, odds, kellyFraction);
        if (!kellyWeight || kellyWeight <= 0) return;

        const impliedProb = 1 / odds;
        const edge = modelProb - impliedProb;
        const winFactor = typeof pick.outcome === 'number' ? pick.outcome : 0;
        const won = winFactor > 0 ? 1 : 0;
        const betType = String(entry.bet_type || '').toLowerCase();
        const market = participants.length >= 3 || betType.includes('3-ball') ? '3ball' : 'matchups';

        candidates.push({
          season: event.season,
          eventId: event.eventId,
          market,
          book,
          dgId: pick.dgId,
          playerName: pick.name || null,
          rank: pick.rank,
          bucket,
          modelProb,
          impliedProb,
          edge,
          openOdds: odds,
          won,
          winFactor,
          kellyWeight
        });
      });
    });
  }

  const selected = candidates
    .sort((a, b) => {
      if (b.modelProb !== a.modelProb) return b.modelProb - a.modelProb;
      return (b.edge || 0) - (a.edge || 0);
    })
    .slice(0, topProbBets);

  const totalWeight = selected.reduce((sum, bet) => (
    sum + resolveTopBetWeight({
      mode: topProbStakeMode,
      bet,
      bankroll: eventStake,
      kellyFraction
    })
  ), 0);
  if (!selected.length || totalWeight <= 0) return [];

  return selected.map(bet => {
    const weight = resolveTopBetWeight({
      mode: topProbStakeMode,
      bet,
      bankroll: eventStake,
      kellyFraction
    });
    const rawStake = eventStake * (weight / totalWeight);
    const stake = applyStakeCap(rawStake, eventStake, maxStake, maxStakePct);
    const winFactor = Number.isFinite(bet.winFactor) ? bet.winFactor : bet.won ? 1 : 0;
    const profit = winFactor > 0 ? stake * (bet.openOdds - 1) * winFactor : -stake;
    return {
      ...bet,
      stake,
      profit
    };
  });
};

const loadOddsEntries = ({ season, eventId, market, book }) => {
  const pathParts = [ODDS_ARCHIVE_DIR, 'outrights', 'pga', String(season), market, String(eventId), `${book}.json`];
  const filePath = path.resolve(...pathParts);
  const payload = readJson(filePath);
  if (!payload || !Array.isArray(payload.odds)) return [];
  return payload.odds;
};

const loadMatchupsEntries = ({ season, eventId, book }) => {
  const filePath = path.resolve(ODDS_ARCHIVE_DIR, 'matchups', 'pga', String(season), String(eventId), `${book}.json`);
  const payload = readJson(filePath);
  if (!payload || !Array.isArray(payload.odds)) return [];
  return payload.odds;
};

const sweepEdgeThresholds = ({
  entries,
  rankingIndex,
  resultsIndex,
  bucketStats,
  bucketCount,
  market,
  bankroll,
  kellyFraction,
  maxStake,
  maxStakePct,
  minEdge,
  maxEdge,
  edgeStep,
  minBets,
  useResults = true,
  useOutcomeField = false
}) => {
  const results = [];
  for (let edge = minEdge; edge <= maxEdge + 1e-9; edge += edgeStep) {
    const summary = evaluateOddsEntries({
      entries,
      rankingIndex,
      resultsIndex,
      bucketStats,
      bucketCount,
      market,
      edgeThreshold: edge,
      bankroll,
      kellyFraction,
        maxStake,
        maxStakePct,
      useResults,
      useOutcomeField
    });
    results.push({ edgeThreshold: Number(edge.toFixed(4)), ...summary });
  }

  const eligible = results.filter(row => row.bets >= minBets);
  const best = eligible.sort((a, b) => b.roi - a.roi)[0] || null;
  return { results, best };
};

const evaluateDkLineups = ({ season, eventId, lineupsPath, stakePerLineup }) => {
  const dfsPath = path.resolve(ODDS_ARCHIVE_DIR, 'draftkings', `${eventId}.json`);
  const dfsPayload = readJson(dfsPath);
  const lineupsPayload = readJson(lineupsPath);
  if (!dfsPayload || !Array.isArray(dfsPayload.dfs_points)) return null;
  if (!lineupsPayload || !Array.isArray(lineupsPayload.lineups)) return null;

  const pointsById = new Map();
  dfsPayload.dfs_points.forEach(row => {
    const dgId = String(row?.dg_id || '').trim();
    if (!dgId) return;
    pointsById.set(dgId, Number(row.total_pts));
  });

  const lineupScores = lineupsPayload.lineups.map(lineup => {
    const totalPoints = (lineup.players || []).reduce((sum, player) => {
      const dgId = String(player.dgId || player.dg_id || '').trim();
      const points = pointsById.get(dgId) || 0;
      return sum + points;
    }, 0);
    return totalPoints;
  });

  if (!lineupScores.length) return null;

  const totalStake = lineupScores.length * stakePerLineup;
  const avgPoints = lineupScores.reduce((sum, value) => sum + value, 0) / lineupScores.length;
  const maxPoints = Math.max(...lineupScores);
  return {
    season,
    eventId,
    lineups: lineupScores.length,
    avgPoints,
    maxPoints,
    stake: totalStake
  };
};

const buildCsv = (rows, headers) => {
  const lines = [headers.join(',')];
  rows.forEach(row => {
    const values = headers.map(header => {
      const raw = row[header] ?? '';
      const text = String(raw);
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    });
    lines.push(values.join(','));
  });
  return `${lines.join('\n')}\n`;
};

const writeSummaryFiles = ({ payload, outputDir }) => {
  const rows = payload.marketSummaries || [];
  const headers = ['season', 'eventId', 'market', 'book', 'edgeThreshold', 'bets', 'wins', 'stake', 'profit', 'roi', 'hitRate', 'avgEdge'];
  const csv = buildCsv(rows, headers);
  fs.writeFileSync(path.resolve(outputDir, `paper_bet_validation_${payload.season}.csv`), csv);

  const totalsByMarketBook = new Map();
  rows.forEach(row => {
    const key = `${row.market}||${row.book}`;
    const current = totalsByMarketBook.get(key) || { market: row.market, book: row.book, bets: 0, wins: 0, stake: 0, profit: 0 };
    current.bets += row.bets || 0;
    current.wins += row.wins || 0;
    current.stake += row.stake || 0;
    current.profit += row.profit || 0;
    totalsByMarketBook.set(key, current);
  });

  const totals = Array.from(totalsByMarketBook.values())
    .map(entry => ({
      ...entry,
      hitRate: entry.bets ? entry.wins / entry.bets : 0,
      roi: entry.stake ? entry.profit / entry.stake : 0
    }))
    .sort((a, b) => b.roi - a.roi);

  const eventTotals = new Map();
  if (Array.isArray(payload.betsPlaced)) {
    payload.betsPlaced.forEach(bet => {
      const key = String(bet.eventId || '').trim() || 'unknown';
      const current = eventTotals.get(key) || { eventId: key, bets: 0, wins: 0, stake: 0, profit: 0 };
      current.bets += 1;
      current.wins += bet.won ? 1 : 0;
      current.stake += Number(bet.stake) || 0;
      current.profit += Number(bet.profit) || 0;
      eventTotals.set(key, current);
    });
  }

  const eventRows = Array.from(eventTotals.values())
    .map(entry => ({
      ...entry,
      hitRate: entry.bets ? entry.wins / entry.bets : 0,
      roi: entry.stake ? entry.profit / entry.stake : 0
    }))
    .sort((a, b) => b.roi - a.roi);

  const md = [];
  md.push(`# Paper Bet Validation Summary (${payload.season})`);
  md.push('');
  md.push(`Generated: ${payload.generatedAt}`);
  md.push('');
  const overallTotals = totals.reduce(
    (acc, entry) => {
      acc.bets += entry.bets || 0;
      acc.wins += entry.wins || 0;
      acc.stake += entry.stake || 0;
      acc.profit += entry.profit || 0;
      return acc;
    },
    { bets: 0, wins: 0, stake: 0, profit: 0 }
  );
  const overallHitRate = overallTotals.bets ? overallTotals.wins / overallTotals.bets : 0;
  const overallRoi = overallTotals.stake ? overallTotals.profit / overallTotals.stake : 0;
  md.push('## Overall Rollup (All Tournaments)');
  md.push('');
  md.push('| Bets | Wins | Stake | Profit | ROI | Hit Rate |');
  md.push('| --- | --- | --- | --- | --- | --- |');
  md.push(`| ${overallTotals.bets} | ${overallTotals.wins} | ${overallTotals.stake.toFixed(4)} | ${overallTotals.profit.toFixed(4)} | ${overallRoi.toFixed(4)} | ${overallHitRate.toFixed(4)} |`);
  md.push('');
  md.push('## Aggregate Results by Market/Book');
  md.push('');
  md.push('| Market | Book | Bets | Wins | Stake | Profit | ROI | Hit Rate |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  totals.forEach(entry => {
    md.push(`| ${entry.market} | ${entry.book} | ${entry.bets} | ${entry.wins} | ${entry.stake.toFixed(4)} | ${entry.profit.toFixed(4)} | ${entry.roi.toFixed(4)} | ${entry.hitRate.toFixed(4)} |`);
  });
  md.push('');
  md.push('## Notes');
  if (payload.topProbBets) {
    md.push(`- Bets are the top ${payload.topProbBets} model-probability picks per event, sized to a $${payload.eventStake} total stake.`);
  } else {
    md.push('- Bets reflect the edge threshold selected per event in the validation run.');
  }
  md.push(`- Stakes use Kelly fraction sizing (fraction=${payload.kellyFraction}).`);
  md.push('- For full per-event detail, see the CSV.');

  if (eventRows.length) {
    md.push('');
    md.push('## Per-Event Hit Rate and ROI');
    md.push('');
    md.push('| Event ID | Bets | Wins | Stake | Profit | ROI | Hit Rate |');
    md.push('| --- | --- | --- | --- | --- | --- | --- |');
    eventRows.forEach(entry => {
      md.push(`| ${entry.eventId} | ${entry.bets} | ${entry.wins} | ${entry.stake.toFixed(4)} | ${entry.profit.toFixed(4)} | ${entry.roi.toFixed(4)} | ${entry.hitRate.toFixed(4)} |`);
    });
    md.push('');
    md.push('- Per-event stats are based on bets that met the edge threshold per market/book.');
  }

  fs.writeFileSync(path.resolve(outputDir, `paper_bet_validation_${payload.season}.md`), `${md.join('\n')}\n`);

  if (Array.isArray(payload.betsPlaced) && payload.betsPlaced.length) {
    const betHeaders = [
      'season',
      'eventId',
      'market',
      'book',
      'dgId',
      'playerName',
      'rank',
      'bucket',
      'modelProb',
      'impliedProb',
      'edge',
      'openOdds',
      'stake',
      'won',
      'profit'
    ];
    const betCsv = buildCsv(payload.betsPlaced, betHeaders);
    fs.writeFileSync(path.resolve(outputDir, `paper_bet_validation_${payload.season}_bets.csv`), betCsv);
  }
};

const main = () => {
  const args = parseArgs();
  const season = args.season ? Number(args.season) : null;
  if (!season) {
    console.error('❌ --season is required.');
    process.exit(1);
  }

  const markets = parseListArg(args.markets).length ? parseListArg(args.markets) : DEFAULT_MARKETS;
  const booksOutrights = parseListArg(args.booksOutrights).length
    ? parseListArg(args.booksOutrights)
    : DEFAULT_BOOKS_OUTRIGHTS;
  const booksMatchups = parseListArg(args.booksMatchups).length
    ? parseListArg(args.booksMatchups)
    : DEFAULT_BOOKS_MATCHUPS;
  const bucketCount = args.bucketCount ? Number(args.bucketCount) : 10;
  const bankroll = args.bankroll ? Number(args.bankroll) : 1;
  const kellyFraction = args.kellyFraction ? Number(args.kellyFraction) : 0.5;
  const maxStake = args.maxStake ? Number(args.maxStake) : null;
  const maxStakePct = args.maxStakePct ? Number(args.maxStakePct) : null;
  const minEdge = args.edgeMin ? Number(args.edgeMin) : 0;
  const maxEdge = args.edgeMax ? Number(args.edgeMax) : 0.1;
  const edgeStep = args.edgeStep ? Number(args.edgeStep) : 0.005;
  const minBets = args.minBets ? Number(args.minBets) : 30;
  const topProbBets = args.topProbBets ? Number(args.topProbBets) : 0;
  const topProbStakeMode = args.topProbStakeMode || args.top_prob_stake_mode || 'edge_scaled';
  const eventStake = args.eventStake ? Number(args.eventStake) : 100;
  const useCalibration = String(args.useCalibrationReport || 'true').toLowerCase() !== 'false';
  const calibrationPath = args.calibrationReportPath
    ? path.resolve(args.calibrationReportPath)
    : path.resolve(DATA_DIR, String(season), 'validation_outputs', 'Calibration_Report.json');

  const tournamentDirs = listSeasonTournamentDirs(season);
  const events = [];
  tournamentDirs.forEach(dir => {
    const preEventPath = resolvePreEventResultsPath(dir);
    const postEventPath = resolvePostEventResultsPath(dir);
    if (!preEventPath || !postEventPath) return;
    const preEventPayload = readJson(preEventPath);
    const resultsPayload = readJson(postEventPath);
    if (!preEventPayload || !resultsPayload) return;
    const eventId = String(preEventPayload.eventId || resultsPayload.eventId || '').trim();
    if (!eventId) return;
    const rankingIndex = buildRankingIndex(preEventPayload);
    const resultsIndex = buildResultsIndex(resultsPayload);
    events.push({ eventId, rankingIndex, resultsIndex });
  });

  if (!events.length) {
    console.error('❌ No events found with both pre_event and post_event data.');
    process.exit(1);
  }

  let bucketStatsByMarket = buildBucketStats(events, bucketCount);
  if (useCalibration) {
    const calibration = loadCalibrationBuckets(calibrationPath);
    if (calibration) {
      const { stats } = calibration;
      if (!bucketStatsByMarket.top_5) {
        bucketStatsByMarket.top_5 = stats.map(bucket => ({ count: bucket.count, wins: bucket.top5 }));
      }
      if (!bucketStatsByMarket.top_10) {
        bucketStatsByMarket.top_10 = stats.map(bucket => ({ count: bucket.count, wins: bucket.top10 }));
      }
      if (!bucketStatsByMarket.top_20) {
        bucketStatsByMarket.top_20 = stats.map(bucket => ({ count: bucket.count, wins: bucket.top20 }));
      }
    }
  }

  const matchupEvents = [];
  events.forEach(event => {
    const matchups = [];
    booksMatchups.forEach(book => {
      matchups.push(...loadMatchupsEntries({ season, eventId: event.eventId, book }));
    });
    matchupEvents.push({ ...event, matchups });
  });

  const matchupBucketStats = buildMatchupBucketStats(matchupEvents, bucketCount);

  const marketSummaries = [];
  const edgeSweeps = [];
  const betsPlacedAll = [];

  events.forEach(event => {
    event.season = season;

    if (topProbBets > 0) {
      const topBets = buildTopProbBetsForEvent({
        event,
        markets,
        booksOutrights,
        booksMatchups,
        bucketStatsByMarket,
        matchupBucketStats,
        bucketCount,
        kellyFraction,
        topProbBets,
        eventStake,
        maxStake,
        maxStakePct,
        topProbStakeMode
      });

      if (topBets.length) {
        const byMarketBook = new Map();
        topBets.forEach(bet => {
          const key = `${bet.market}||${bet.book}`;
          const current = byMarketBook.get(key) || { bets: 0, wins: 0, stake: 0, profit: 0 };
          current.bets += 1;
          current.wins += bet.won ? 1 : 0;
          current.stake += bet.stake || 0;
          current.profit += bet.profit || 0;
          byMarketBook.set(key, current);
        });

        byMarketBook.forEach((summary, key) => {
          const [market, book] = key.split('||');
          marketSummaries.push({
            season,
            eventId: event.eventId,
            market,
            book,
            edgeThreshold: null,
            bets: summary.bets,
            wins: summary.wins,
            stake: summary.stake,
            profit: summary.profit,
            hitRate: summary.bets ? summary.wins / summary.bets : 0,
            roi: summary.stake ? summary.profit / summary.stake : 0,
            avgEdge: 0
          });
        });

        topBets.forEach(bet => {
          betsPlacedAll.push(bet);
        });
      }

      return;
    }

    markets.forEach(market => {
      const bucketStats = bucketStatsByMarket[market];
      if (!bucketStats) return;

      booksOutrights.forEach(book => {
        const entries = loadOddsEntries({ season, eventId: event.eventId, market, book });
        if (!entries.length) return;

        const sweep = sweepEdgeThresholds({
          entries,
          rankingIndex: event.rankingIndex,
          resultsIndex: event.resultsIndex,
          bucketStats,
          bucketCount,
          market,
          bankroll,
          kellyFraction,
          maxStake,
          maxStakePct,
          minEdge,
          maxEdge,
          edgeStep,
          minBets,
          useResults: true,
          useOutcomeField: false
        });

        const chosenEdge = sweep.best ? sweep.best.edgeThreshold : minEdge;
        const { summary, betsPlaced } = evaluateOddsEntries({
          entries,
          rankingIndex: event.rankingIndex,
          resultsIndex: event.resultsIndex,
          bucketStats,
          bucketCount,
          market,
          edgeThreshold: chosenEdge,
          bankroll,
          kellyFraction,
          maxStake,
          maxStakePct,
          useResults: true,
          useOutcomeField: false,
          collectBets: true,
          eventId: event.eventId,
          book
        });

        marketSummaries.push({
          season,
          eventId: event.eventId,
          market,
          book,
          edgeThreshold: chosenEdge,
          ...summary
        });

        edgeSweeps.push({
          season,
          eventId: event.eventId,
          market,
          book,
          sweep: sweep.results,
          best: sweep.best
        });

        if (betsPlaced.length) {
          betsPlaced.forEach(bet => {
            bet.season = season;
          });
          betsPlacedAll.push(...betsPlaced);
        }
      });
    });

    if (matchupBucketStats.length) {
      booksMatchups.forEach(book => {
        const entries = loadMatchupsEntries({ season, eventId: event.eventId, book });
        if (!entries.length) return;
        const sweep = sweepEdgeThresholds({
          entries,
          rankingIndex: event.rankingIndex,
          resultsIndex: event.resultsIndex,
          bucketStats: matchupBucketStats,
          bucketCount,
          market: 'matchups',
          bankroll,
          kellyFraction,
          maxStake,
          maxStakePct,
          minEdge,
          maxEdge,
          edgeStep,
          minBets,
          useResults: false,
          useOutcomeField: true
        });

        const chosenEdge = sweep.best ? sweep.best.edgeThreshold : minEdge;
        const { summary, betsPlaced } = evaluateOddsEntries({
          entries,
          rankingIndex: event.rankingIndex,
          resultsIndex: event.resultsIndex,
          bucketStats: matchupBucketStats,
          bucketCount,
          market: 'matchups',
          edgeThreshold: chosenEdge,
          bankroll,
          kellyFraction,
          maxStake,
          maxStakePct,
          useResults: false,
          useOutcomeField: true,
          collectBets: true,
          eventId: event.eventId,
          book
        });

        marketSummaries.push({
          season,
          eventId: event.eventId,
          market: 'matchups',
          book,
          edgeThreshold: chosenEdge,
          ...summary
        });

        edgeSweeps.push({
          season,
          eventId: event.eventId,
          market: 'matchups',
          book,
          sweep: sweep.results,
          best: sweep.best
        });

        if (betsPlaced.length) {
          betsPlaced.forEach(bet => {
            bet.season = season;
          });
          betsPlacedAll.push(...betsPlaced);
        }
      });
    }
  });

  const dkLineupsDir = args.dkLineupsDir ? path.resolve(args.dkLineupsDir) : null;
  const dkStake = args.dkStake ? Number(args.dkStake) : 1;
  const dkSummaries = [];
  if (dkLineupsDir && fs.existsSync(dkLineupsDir)) {
    events.forEach(event => {
      const lineupFile = path.resolve(dkLineupsDir, `${event.eventId}_top_lineups.json`);
      if (!fs.existsSync(lineupFile)) return;
      const summary = evaluateDkLineups({
        season,
        eventId: event.eventId,
        lineupsPath: lineupFile,
        stakePerLineup: dkStake
      });
      if (summary) dkSummaries.push(summary);
    });
  }

  const outputDir = VALIDATION_DIR;
  ensureDir(outputDir);
  const outputPath = path.resolve(outputDir, `paper_bet_validation_${season}.json`);

  const payload = {
    generatedAt: new Date().toISOString(),
    season,
    bankroll,
    kellyFraction,
    edgeSweep: {
      minEdge,
      maxEdge,
      edgeStep,
      minBets
    },
    bucketCount,
    marketSummaries,
    edgeSweeps,
    dkSummaries,
    betsPlaced: betsPlacedAll,
    topProbBets: topProbBets > 0 ? topProbBets : null,
    eventStake: topProbBets > 0 ? eventStake : null
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeSummaryFiles({ payload, outputDir });
  console.log(`✓ Paper bet validation saved to ${outputPath}`);
};

main();
