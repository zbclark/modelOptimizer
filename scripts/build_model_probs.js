const fs = require('fs');
const path = require('path');

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

const readJson = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const findManifestEntry = ({ season, eventId, tournamentSlug, tournamentName }) => {
  const manifestPath = path.resolve(DATA_DIR, String(season), 'manifest.json');
  const manifest = readJson(manifestPath) || [];
  if (eventId) {
    const match = manifest.find(entry => String(entry.eventId) === String(eventId));
    if (match) return match;
  }
  if (tournamentSlug) {
    const match = manifest.find(entry => String(entry.tournamentSlug) === String(tournamentSlug));
    if (match) return match;
  }
  if (tournamentName) {
    const match = manifest.find(entry => String(entry.tournamentName).toLowerCase() === String(tournamentName).toLowerCase());
    if (match) return match;
  }
  return null;
};

const resolvePreEventResultsPath = ({ season, tournamentSlug }) => {
  const preEventDir = path.resolve(DATA_DIR, String(season), tournamentSlug, 'pre_event');
  if (!fs.existsSync(preEventDir)) return null;
  const files = fs.readdirSync(preEventDir)
    .filter(file => file.endsWith('_pre_event_results.json'))
    .map(file => path.resolve(preEventDir, file));
  if (!files.length) return null;
  const preferred = files.find(file => file.includes(tournamentSlug));
  return preferred || files[0];
};

const resolveMatchupsPath = ({ tour, year, eventId, book }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeYear = String(year || '').trim();
  const safeEventId = String(eventId || '').trim();
  const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
  return path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'matchups', safeTour, safeYear, safeEventId, `${safeBook}.json`);
};

const resolveLiveMatchupsPath = ({ tour, market }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeMarket = String(market || 'tournament_matchups').trim().toLowerCase() || 'tournament_matchups';
  return path.resolve(DATA_DIR, 'wagering', 'odds_live', 'matchups', safeTour, safeMarket, 'latest.json');
};

const resolveAnyMatchupsPath = ({ tour, year, eventId }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeYear = String(year || '').trim();
  const safeEventId = String(eventId || '').trim();
  const dir = path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'matchups', safeTour, safeYear, safeEventId);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => path.resolve(dir, file));
  return files[0] || null;
};

const scoreForPlayer = player => {
  const candidates = [
    player?.refinedWeightedScore,
    player?.weightedScore,
    player?.compositeScore,
    player?.war
  ];
  for (const value of candidates) {
    if (Number.isFinite(value)) return value;
  }
  return 0;
};

const buildSoftmax = scores => {
  const maxScore = Math.max(...scores);
  const expScores = scores.map(score => Math.exp(score - maxScore));
  const sumExp = expScores.reduce((sum, value) => sum + value, 0);
  return expScores.map(value => value / sumExp);
};

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

const stdDev = values => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
};

const logistic = value => 1 / (1 + Math.exp(-value));

const normalizeName = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .trim();

const parseSeasonList = value => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.split(',').map(entry => entry.trim()).filter(Boolean);
};

const parseBool = value => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(raw)) return true;
  if (['false', '0', 'no', 'n'].includes(raw)) return false;
  return null;
};

const listSeasonDirectories = () => {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(entry => /^\d{4}$/.test(entry));
};

const loadCalibrationReports = ({ seasons }) => {
  const seasonDirs = seasons && seasons.length ? seasons : listSeasonDirectories();
  return seasonDirs.map(season => {
    const reportPath = path.resolve(DATA_DIR, String(season), 'validation_outputs', 'Calibration_Report.json');
    const report = readJson(reportPath);
    if (!report) return null;
    return { season: String(season), report };
  }).filter(Boolean);
};

const resolveEventCalibration = ({ report, tournamentName, tournamentSlug }) => {
  if (!report?.tournaments?.length) return null;
  const targets = [tournamentName, tournamentSlug]
    .filter(Boolean)
    .map(normalizeName);
  if (!targets.length) return null;
  return report.tournaments.find(entry => {
    const normalized = normalizeName(entry?.name || entry?.tournamentName || '');
    return targets.some(target => target && normalized === target);
  }) || null;
};

const buildWeightedBuckets = ({ reports, weightCurrentSeason, currentSeason }) => {
  const buckets = Array.from({ length: 10 }, (_, index) => ({
    bucket: index,
    minPct: index / 10,
    maxPct: (index + 1) / 10,
    count: 0,
    top5: 0,
    top10: 0,
    top20: 0
  }));

  reports.forEach(({ season, report }) => {
    const weight = season === String(currentSeason) ? weightCurrentSeason : 1;
    const sourceBuckets = report?.calibrationBuckets?.buckets || [];
    sourceBuckets.forEach(bucket => {
      const idx = Number(bucket.bucket);
      if (!Number.isFinite(idx) || !buckets[idx]) return;
      buckets[idx].count += Number(bucket.count || 0) * weight;
      buckets[idx].top5 += Number(bucket.top5 || 0) * weight;
      buckets[idx].top10 += Number(bucket.top10 || 0) * weight;
      buckets[idx].top20 += Number(bucket.top20 || 0) * weight;
      if (Number.isFinite(bucket.minPct)) buckets[idx].minPct = bucket.minPct;
      if (Number.isFinite(bucket.maxPct)) buckets[idx].maxPct = bucket.maxPct;
    });
  });

  return buckets;
};

const fitLogisticFromBuckets = ({ buckets, topKey }) => {
  const data = buckets.map(bucket => {
    const midpoint = (bucket.minPct + bucket.maxPct) / 2;
    const trials = Number(bucket.count || 0);
    const successes = Number(bucket[topKey] || 0);
    return { x: midpoint, n: trials, k: successes };
  }).filter(entry => entry.n > 0 && Number.isFinite(entry.x));

  if (!data.length) return null;

  let a = -1;
  let b = -1;
  for (let iter = 0; iter < 25; iter += 1) {
    let gradA = 0;
    let gradB = 0;
    let h11 = 0;
    let h12 = 0;
    let h22 = 0;

    data.forEach(({ x, n, k }) => {
      const z = a * x + b;
      const p = logistic(z);
      const diff = k - n * p;
      gradA += diff * x;
      gradB += diff;
      const w = n * p * (1 - p);
      h11 -= w * x * x;
      h12 -= w * x;
      h22 -= w;
    });

    const det = h11 * h22 - h12 * h12;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    const stepA = (gradA * h22 - gradB * h12) / det;
    const stepB = (gradB * h11 - gradA * h12) / det;
    if (!Number.isFinite(stepA) || !Number.isFinite(stepB)) break;
    a -= stepA;
    b -= stepB;
    if (Math.abs(stepA) + Math.abs(stepB) < 1e-6) break;
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b };
};

const buildEmpiricalCalibration = ({ reports, currentSeason, weightCurrentSeason, tournamentName, tournamentSlug }) => {
  const currentReport = reports.find(entry => entry.season === String(currentSeason))?.report || null;
  const eventOverride = currentReport
    ? resolveEventCalibration({ report: currentReport, tournamentName, tournamentSlug })
    : null;

  const baseBuckets = buildWeightedBuckets({
    reports,
    weightCurrentSeason,
    currentSeason
  });

  const top5Fit = fitLogisticFromBuckets({ buckets: baseBuckets, topKey: 'top5' });
  const top10Fit = fitLogisticFromBuckets({ buckets: baseBuckets, topKey: 'top10' });
  const top20Fit = fitLogisticFromBuckets({ buckets: baseBuckets, topKey: 'top20' });

  let overrideBuckets = null;
  if (eventOverride?.calibrationBuckets?.buckets?.length) {
    overrideBuckets = eventOverride.calibrationBuckets.buckets.map(bucket => ({
      ...bucket,
      minPct: bucket.minPct,
      maxPct: bucket.maxPct,
      count: Number(bucket.count || 0),
      top5: Number(bucket.top5 || 0),
      top10: Number(bucket.top10 || 0),
      top20: Number(bucket.top20 || 0)
    }));
  }

  const eventTop5Fit = overrideBuckets ? fitLogisticFromBuckets({ buckets: overrideBuckets, topKey: 'top5' }) : null;
  const eventTop10Fit = overrideBuckets ? fitLogisticFromBuckets({ buckets: overrideBuckets, topKey: 'top10' }) : null;
  const eventTop20Fit = overrideBuckets ? fitLogisticFromBuckets({ buckets: overrideBuckets, topKey: 'top20' }) : null;

  return {
    buckets: baseBuckets,
    fits: {
      top5: eventTop5Fit || top5Fit,
      top10: eventTop10Fit || top10Fit,
      top20: eventTop20Fit || top20Fit
    }
  };
};

const percentileForRank = (rank, fieldSize) => {
  if (!Number.isFinite(rank) || fieldSize <= 1) return 0;
  return Math.min(1, Math.max(0, (rank - 1) / (fieldSize - 1)));
};

const probabilityFromFit = (percentile, fit) => {
  if (!fit) return null;
  return logistic(fit.a * percentile + fit.b);
};

const probabilityFromBuckets = (percentile, buckets, topKey) => {
  if (!buckets?.length) return null;
  const bucket = buckets.find(entry => percentile >= entry.minPct && percentile <= entry.maxPct)
    || buckets[buckets.length - 1];
  if (!bucket || !bucket.count) return null;
  return Number(bucket[topKey] || 0) / Number(bucket.count || 1);
};

const formatProb = value => {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(6);
};

const formatScore = value => {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(6);
};

const extractOddsEntries = payload => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.odds)) return payload.odds;
  if (Array.isArray(payload.players)) return payload.players;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.match_list)) return payload.match_list;
  return [];
};

const normalizeId = value => String(value || '').trim();

const normalizeBetType = entry => String(entry?.bet_type || entry?.betType || entry?.market || entry?.type || '').trim().toLowerCase();

const collectNumeric = value => (Number.isFinite(Number(value)) ? Number(value) : null);

const extractPlayerFromEntry = (entry, prefix) => {
  if (!entry) return null;
  const direct = entry[prefix];
  const base = typeof direct === 'object' && direct !== null ? direct : {};
  const id = normalizeId(
    entry[`${prefix}_dg_id`]
    || entry[`${prefix}_dgId`]
    || entry[`${prefix}_id`]
    || entry[`${prefix}_player_id`]
    || entry[`${prefix}_playerId`]
    || base.dg_id
    || base.dgId
    || base.player_id
    || base.playerId
    || base.id
  );
  if (!id) return null;

  const name = entry[`${prefix}_name`]
    || entry[`${prefix}_player_name`]
    || entry[`${prefix}_playerName`]
    || base.player_name
    || base.playerName
    || base.name
    || '';

  const odds = collectNumeric(
    entry[`${prefix}_odds`]
    || entry[`${prefix}_odds_decimal`]
    || entry[`${prefix}_oddsDecimal`]
    || entry[`${prefix}_price`]
    || base.odds
    || base.odds_decimal
    || base.oddsDecimal
    || base.price
  );

  return { id, name, odds };
};

const extractMatchupEntries = payload => {
  const entries = extractOddsEntries(payload);
  if (!entries.length) return [];
  return entries.map(entry => {
    const p1 = extractPlayerFromEntry(entry, 'p1');
    const p2 = extractPlayerFromEntry(entry, 'p2');
    const p3 = extractPlayerFromEntry(entry, 'p3');
    const players = [p1, p2, p3].filter(Boolean);
    return {
      betType: normalizeBetType(entry),
      players,
      raw: entry
    };
  }).filter(entry => entry.players.length >= 2);
};

const buildTopNProbabilities = (scores, topN) => {
  const avg = mean(scores);
  const sd = stdDev(scores) || 1;
  const zScores = scores.map(score => (score - avg) / sd);
  const fieldSize = scores.length;
  const targetRate = Math.min(Math.max(topN / fieldSize, 0), 1);
  const threshold = percentile(zScores, 1 - targetRate);

  const averageProbability = scale => (
    zScores.reduce((sum, z) => sum + logistic(scale * (z - threshold)), 0) / zScores.length
  );

  const minScale = 0.1;
  const maxScale = 20;
  let low = minScale;
  let high = maxScale;
  let scale = 1;

  for (let i = 0; i < 30; i += 1) {
    scale = (low + high) / 2;
    const avgProb = averageProbability(scale);
    if (avgProb > targetRate) {
      low = scale;
    } else {
      high = scale;
    }
  }

  return zScores.map(z => logistic(scale * (z - threshold)));
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

const main = () => {
  const args = parseArgs();
  const season = args.season;
  const eventId = args.eventId || args.event;
  const tournamentSlug = args.tournamentSlug || args.slug;
  const tournamentName = args.tournamentName || args.name;
  const tour = args.tour || 'pga';
  const year = args.year || season;
  const book = args.book || null;
  const oddsSource = args.oddsSource || args.odds_source || 'live';
  const oddsSourceKey = String(oddsSource || 'live').trim().toLowerCase();
  const market = String(args.market || 'win').trim().toLowerCase();
  const calibrationWeightCurrent = Number(args.calibrationWeightCurrent || args.calibration_weight_current || 2);
  const calibrationSeasons = parseSeasonList(args.calibrationSeasons || args.calibration_seasons);
  const calibrationOverrideEvent = parseBool(
    args.calibrationOverrideEvent !== undefined ? args.calibrationOverrideEvent : args.calibration_override_event
  );

  if (!season) {
    console.error('❌ Missing --season.');
    process.exit(1);
  }

  const manifestEntry = findManifestEntry({ season, eventId, tournamentSlug, tournamentName });
  if (!manifestEntry && !tournamentSlug) {
    console.error('❌ Could not resolve tournament slug from manifest. Provide --tournamentSlug or --eventId.');
    process.exit(1);
  }

  const resolvedSlug = tournamentSlug || manifestEntry?.tournamentSlug;
  const resolvedEventId = eventId || manifestEntry?.eventId || 'unknown';
  const resultsPath = resolvePreEventResultsPath({ season, tournamentSlug: resolvedSlug });

  if (!resultsPath) {
    console.error('❌ Could not find pre_event_results.json for this tournament.');
    process.exit(1);
  }

  const resultsPayload = readJson(resultsPath);
  const players = resultsPayload?.preEventRanking?.players || [];
  if (!players.length) {
    console.error('❌ No players found in preEventRanking.players.');
    process.exit(1);
  }

  const scores = players.map(scoreForPlayer);
  const winProbs = buildSoftmax(scores);
  let marketProbs = winProbs;
  let topN = null;
  const isMatchupMarket = ['tournament_matchups', 'round_matchups', '3_balls', '3balls', '3-ball', '3ball'].includes(market);

  const calibrationReports = loadCalibrationReports({ seasons: calibrationSeasons });
  const empiricalCalibration = calibrationReports.length
    ? buildEmpiricalCalibration({
      reports: calibrationReports,
      currentSeason: season,
      weightCurrentSeason: Number.isFinite(calibrationWeightCurrent) ? calibrationWeightCurrent : 2,
      tournamentName: calibrationOverrideEvent === false ? null : (tournamentName || manifestEntry?.tournamentName),
      tournamentSlug: calibrationOverrideEvent === false ? null : resolvedSlug
    })
    : null;

  if (!isMatchupMarket) {
    if (market === 'top_5' || market === 'top5') {
      topN = 5;
      if (empiricalCalibration?.fits?.top5) {
        const fallbackProbs = buildTopNProbabilities(scores, topN);
        marketProbs = players.map((player, index) => {
          const rank = Number(player.rank || player.modelRank || player.predictedRank || index + 1);
          const percentile = percentileForRank(rank, players.length);
          return probabilityFromFit(percentile, empiricalCalibration.fits.top5)
            ?? probabilityFromBuckets(percentile, empiricalCalibration.buckets, 'top5')
            ?? fallbackProbs[index];
        });
      } else {
        marketProbs = buildTopNProbabilities(scores, topN);
      }
    } else if (market === 'top_10' || market === 'top10') {
      topN = 10;
      if (empiricalCalibration?.fits?.top10) {
        const fallbackProbs = buildTopNProbabilities(scores, topN);
        marketProbs = players.map((player, index) => {
          const rank = Number(player.rank || player.modelRank || player.predictedRank || index + 1);
          const percentile = percentileForRank(rank, players.length);
          return probabilityFromFit(percentile, empiricalCalibration.fits.top10)
            ?? probabilityFromBuckets(percentile, empiricalCalibration.buckets, 'top10')
            ?? fallbackProbs[index];
        });
      } else {
        marketProbs = buildTopNProbabilities(scores, topN);
      }
    } else if (market === 'top_20' || market === 'top20') {
      topN = 20;
      if (empiricalCalibration?.fits?.top20) {
        const fallbackProbs = buildTopNProbabilities(scores, topN);
        marketProbs = players.map((player, index) => {
          const rank = Number(player.rank || player.modelRank || player.predictedRank || index + 1);
          const percentile = percentileForRank(rank, players.length);
          return probabilityFromFit(percentile, empiricalCalibration.fits.top20)
            ?? probabilityFromBuckets(percentile, empiricalCalibration.buckets, 'top20')
            ?? fallbackProbs[index];
        });
      } else {
        marketProbs = buildTopNProbabilities(scores, topN);
      }
    }
  }

  const marketSlug = market.replace(/[^a-z0-9]+/g, '_');
  const runTimestamp = resultsPayload?.timestamp || new Date().toISOString();
  let rows = [];

  if (isMatchupMarket) {
    const scoreById = new Map();
    players.forEach(player => {
      const playerId = normalizeId(player.dgId || player.playerId);
      if (!playerId) return;
      const score = scoreForPlayer(player);
      if (!Number.isFinite(score)) return;
      scoreById.set(playerId, score);
    });

    if (!scoreById.size) {
      console.error('❌ Could not build matchup model scores from pre_event results.');
      process.exit(1);
    }

    let oddsPath = null;
    if (oddsSourceKey === 'live') {
      oddsPath = resolveLiveMatchupsPath({ tour, market });
    } else {
      oddsPath = resolveMatchupsPath({ tour, year, eventId: resolvedEventId, book });
      if (!oddsPath || !fs.existsSync(oddsPath)) {
        oddsPath = resolveAnyMatchupsPath({ tour, year, eventId: resolvedEventId });
      }
    }

    if (!oddsPath || !fs.existsSync(oddsPath)) {
      console.warn('⚠️  No matchup odds payload found for model_probs. Skipping.');
      process.exit(0);
    }

    const oddsPayload = readJson(oddsPath);
    const matchupEntries = extractMatchupEntries(oddsPayload);
    if (!matchupEntries.length) {
      console.warn('⚠️  Matchup odds payload has no entries. Skipping.');
      process.exit(0);
    }

    rows = matchupEntries.flatMap(entry => {
      const playerIds = entry.players.map(player => player.id);
      const scoresForMatch = playerIds.map(id => scoreById.get(id));
      if (scoresForMatch.some(score => !Number.isFinite(score))) return [];

      let probs = [];
      if (entry.players.length === 2) {
        const diff = scoresForMatch[0] - scoresForMatch[1];
        const p1 = logistic(diff);
        probs = [p1, 1 - p1];
      } else if (entry.players.length === 3) {
        probs = buildSoftmax(scoresForMatch);
      } else {
        return [];
      }

      return entry.players.map((player, index) => {
        const opponents = playerIds.filter(id => id !== player.id);
        const pModel = probs[index];
        return {
          run_timestamp: runTimestamp,
          event_id: resolvedEventId,
          season: String(season),
          market_type: market,
          player_id: player.id,
          player_name: player.name || '',
          opponent_ids: opponents.join(','),
          p_model: pModel,
          p_win: pModel,
          p_top_n: '',
          score: scoreById.get(player.id),
          summary: `${player.name || 'Unknown'} | market=${market} | opponents=${opponents.join(',')} | p_model=${formatProb(pModel)} | score=${formatScore(scoreById.get(player.id))}`
        };
      });
    });
  } else {
    const marketType = topN ? `top_${topN}` : 'outright_win';
    rows = players.map((player, index) => ({
      run_timestamp: runTimestamp,
      event_id: resolvedEventId,
      season: String(season),
      market_type: marketType,
      player_id: player.dgId || player.playerId || '',
      player_name: player.name || '',
      opponent_ids: '',
      p_model: marketProbs[index],
      p_win: winProbs[index],
      p_top_n: topN ? marketProbs[index] : '',
      score: scores[index],
      summary: `${player.name || 'Unknown'} | market=${marketType} | p_model=${formatProb(marketProbs[index])} | p_win=${formatProb(winProbs[index])} | score=${formatScore(scores[index])}`
    }));
  }

  const outputDir = path.resolve(DATA_DIR, 'wagering', resolvedSlug, 'inputs');
  const outputPath = path.resolve(outputDir, `${resolvedSlug}_${marketSlug}_model_probs.csv`);
  writeCsv(outputPath, rows, [
    'run_timestamp',
    'event_id',
    'season',
    'market_type',
    'player_id',
    'player_name',
    'opponent_ids',
    'p_model',
    'p_win',
    'p_top_n',
    'score',
    'summary'
  ]);

  console.log(`✓ Model probabilities saved to ${outputPath}`);
};

main();
