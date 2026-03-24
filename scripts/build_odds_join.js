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
  return null;
};

const buildSoftmax = scores => {
  const maxScore = Math.max(...scores);
  const expScores = scores.map(score => Math.exp(score - maxScore));
  const sumExp = expScores.reduce((sum, value) => sum + value, 0);
  return expScores.map(value => value / sumExp);
};

const logistic = value => 1 / (1 + Math.exp(-value));

const resolveModelProbsPath = ({ tournamentSlug, market }) => {
  const dir = path.resolve(DATA_DIR, 'wagering', String(tournamentSlug), 'inputs');
  if (!fs.existsSync(dir)) return null;
  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('_model_probs.csv'))
    .map(file => path.resolve(dir, file));
  if (!files.length) return null;
  const preferred = files.find(file => file.includes(tournamentSlug) && file.includes(`_${marketSlug}_model_probs.csv`));
  const fallback = files.find(file => file.includes(tournamentSlug));
  return preferred || fallback || files[0];
};

const resolveOutrightsPath = ({ tour, year, market, book, eventId }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeYear = String(year || '').trim();
  const safeMarket = String(market || 'win').trim().toLowerCase() || 'win';
  const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
  const safeEventId = String(eventId || '').trim();
  return path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'outrights', safeTour, safeYear, safeMarket, safeEventId, `${safeBook}.json`);
};

const resolveMatchupsPath = ({ tour, year, book, eventId }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeYear = String(year || '').trim();
  const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
  const safeEventId = String(eventId || '').trim();
  return path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'matchups', safeTour, safeYear, safeEventId, `${safeBook}.json`);
};

const resolveLiveOutrightsPath = ({ tour, market }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeMarket = String(market || 'win').trim().toLowerCase() || 'win';
  return path.resolve(DATA_DIR, 'wagering', 'odds_live', 'outrights', safeTour, safeMarket, 'latest.json');
};

const resolveLiveMatchupsPath = ({ tour, market }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeMarket = String(market || 'tournament_matchups').trim().toLowerCase() || 'tournament_matchups';
  return path.resolve(DATA_DIR, 'wagering', 'odds_live', 'matchups', safeTour, safeMarket, 'latest.json');
};

const impliedProbabilityFromDecimal = oddsDecimal => {
  const value = Number(oddsDecimal);
  if (!Number.isFinite(value) || value <= 0) return null;
  return 1 / value;
};

const pickOddsValue = (entry, oddsPoint, options = {}) => {
  const { oddsSource = 'historical', book } = options;
  if (!entry) return null;
  if (oddsSource === 'live') {
    const safeBook = String(book || '').trim().toLowerCase();
    if (safeBook) {
      const bookValue = entry[safeBook];
      if (typeof bookValue === 'number') {
        return bookValue;
      }
      if (bookValue && typeof bookValue === 'object') {
        const candidates = ['odds', 'odds_decimal', 'oddsDecimal', 'decimal', 'price'];
        for (const key of candidates) {
          if (bookValue[key] !== undefined && bookValue[key] !== null && bookValue[key] !== '') {
            return bookValue[key];
          }
        }
      }
      if (entry.odds && typeof entry.odds === 'object' && entry.odds[safeBook] !== undefined) {
        return entry.odds[safeBook];
      }
      const suffixed = [`${safeBook}_odds`, `${safeBook}_odds_decimal`, `${safeBook}_price`];
      for (const key of suffixed) {
        if (entry[key] !== undefined && entry[key] !== null && entry[key] !== '') {
          return entry[key];
        }
      }
    }

    const collectNumeric = value => (Number.isFinite(Number(value)) ? Number(value) : null);
    const oddsValue = collectNumeric(entry.odds || entry.odds_decimal || entry.oddsDecimal || entry.price);
    if (oddsValue !== null) {
      return oddsValue;
    }
    if (entry.odds && typeof entry.odds === 'object') {
      for (const value of Object.values(entry.odds)) {
        const numeric = collectNumeric(value?.odds ?? value?.odds_decimal ?? value?.oddsDecimal ?? value?.price ?? value);
        if (numeric !== null) {
          return numeric;
        }
      }
    }
  }

  const pick = String(oddsPoint || 'close').trim().toLowerCase();
  const candidates = {
    open: ['open_odds', 'openOdds', 'odds_open', 'open'],
    close: ['close_odds', 'closeOdds', 'odds_close', 'close', 'odds'],
    current: ['odds', 'odds_decimal', 'oddsDecimal', 'price']
  };
  const keys = candidates[pick] || candidates.close;
  for (const key of keys) {
    if (entry && entry[key] !== undefined && entry[key] !== null && entry[key] !== '') {
      return entry[key];
    }
  }
  return null;
};

const normalizeId = value => String(value || '').trim();

const parseOpponentIds = value => String(value || '')
  .split(/[,|]/)
  .map(entry => String(entry).trim())
  .filter(Boolean);

const canonicalKey = ids => ids
  .map(id => String(id).trim())
  .filter(Boolean)
  .sort()
  .join('|');

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

const normalizeBetType = entry => String(entry?.bet_type || entry?.betType || entry?.market || entry?.type || '').trim().toLowerCase();

const collectNumeric = value => (Number.isFinite(Number(value)) ? Number(value) : null);

const extractPlayerFromEntry = (entry, prefix, options = {}) => {
  if (!entry) return null;
  const { book } = options;
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

  let odds = collectNumeric(
    entry[`${prefix}_odds`]
    || entry[`${prefix}_odds_decimal`]
    || entry[`${prefix}_oddsDecimal`]
    || entry[`${prefix}_price`]
    || base.odds
    || base.odds_decimal
    || base.oddsDecimal
    || base.price
  );

  if (odds === null || odds === undefined) {
    const oddsPayload = entry.odds && typeof entry.odds === 'object' ? entry.odds : null;
    if (oddsPayload) {
      const bookKey = String(book || '').trim().toLowerCase();
      if (bookKey && oddsPayload[bookKey]) {
        const bookOdds = oddsPayload[bookKey];
        if (bookOdds && typeof bookOdds === 'object') {
          odds = collectNumeric(bookOdds[prefix]);
        }
      }
    }
  }

  const name = entry[`${prefix}_name`]
    || entry[`${prefix}_player_name`]
    || entry[`${prefix}_playerName`]
    || base.player_name
    || base.playerName
    || base.name
    || '';

  const outcomeRaw = entry[`${prefix}_outcome`]
    ?? entry[`${prefix}_win`]
    ?? entry[`${prefix}_result`]
    ?? base.outcome
    ?? base.win
    ?? base.result;
  const outcome = outcomeRaw !== undefined && outcomeRaw !== null && outcomeRaw !== ''
    ? (Number(outcomeRaw) === 1 || String(outcomeRaw).toLowerCase().includes('win') ? 1 : 0)
    : null;

  return { id, odds, outcome, name };
};

const extractMatchupEntries = (payload, options = {}) => {
  const entries = extractOddsEntries(payload);
  if (!entries.length) return [];
  return entries.map(entry => {
    const p1 = extractPlayerFromEntry(entry, 'p1', options);
    const p2 = extractPlayerFromEntry(entry, 'p2', options);
    const p3 = extractPlayerFromEntry(entry, 'p3', options);
    const players = [p1, p2, p3].filter(Boolean);
    const oddsById = new Map();
    const outcomeById = new Map();
    players.forEach(player => {
      if (player.odds !== null && player.odds !== undefined) {
        oddsById.set(player.id, player.odds);
      }
      if (player.outcome !== null && player.outcome !== undefined) {
        outcomeById.set(player.id, player.outcome);
      }
    });
    return {
      betType: normalizeBetType(entry),
      players,
      oddsById,
      outcomeById,
      raw: entry
    };
  }).filter(entry => entry.players.length >= 2);
};

const main = () => {
  const args = parseArgs();
  const season = args.season;
  const year = args.year || season;
  const eventId = args.eventId || args.event;
  const tournamentSlug = args.tournamentSlug || args.slug;
  const tournamentName = args.tournamentName || args.name;
  const tour = args.tour || 'pga';
  const market = args.market || 'win';
  const book = args.book || 'draftkings';
  const oddsSource = args.oddsSource || args.odds_source || 'historical';
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const yearTag = args.yearTag || args.year_tag || null;
  const oddsPoint = args.oddsPoint || 'close';
  const modelProbsPathArg = args.modelProbsPath || args.model_probs;
  const oddsPathArg = args.oddsPath || args.odds_path;

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

  const modelProbsPath = modelProbsPathArg || resolveModelProbsPath({
    tournamentSlug: resolvedSlug,
    market
  });

  if (oddsSourceKey === 'both') {
    console.error('❌ build_odds_join does not support --oddsSource both. Run once per source (historical, live).');
    process.exit(1);
  }

  const marketKey = String(market || '').trim().toLowerCase();
  const isMatchupMarket = ['tournament_matchups', 'round_matchups', '3_balls', '3balls', '3-ball', '3ball'].includes(marketKey);
  const oddsPath = oddsPathArg || (oddsSourceKey === 'live'
    ? (isMatchupMarket ? resolveLiveMatchupsPath({ tour, market }) : resolveLiveOutrightsPath({ tour, market }))
    : (isMatchupMarket ? resolveMatchupsPath({ tour, year, book, eventId: resolvedEventId }) : resolveOutrightsPath({ tour, year, market, book, eventId: resolvedEventId })));
  if (!oddsPath || !fs.existsSync(oddsPath)) {
    console.error('❌ Could not find odds JSON for join.');
    process.exit(1);
  }

  const modelRows = modelProbsPath ? readCsv(modelProbsPath) : [];
  if (!isMatchupMarket && !modelRows.length) {
    console.error('❌ model_probs CSV is empty.');
    process.exit(1);
  }

  let scoreById = null;
  if (isMatchupMarket) {
    const resultsPath = resolvePreEventResultsPath({ season, tournamentSlug: resolvedSlug });
    if (resultsPath) {
      const resultsPayload = readJson(resultsPath);
      const players = resultsPayload?.preEventRanking?.players || [];
      scoreById = new Map();
      players.forEach(player => {
        const playerId = normalizeId(player.dgId || player.playerId);
        if (!playerId) return;
        const score = scoreForPlayer(player);
        if (!Number.isFinite(score)) return;
        scoreById.set(playerId, score);
      });
    }
    if (!scoreById || !scoreById.size) {
      console.error('❌ Could not build matchup model scores from pre_event results.');
      process.exit(1);
    }
  }

  const oddsPayload = readJson(oddsPath);
  const joinedRows = [];
  const marketType = String(market || '').trim().toLowerCase();

  if (isMatchupMarket) {
    const matchupEntries = extractMatchupEntries(oddsPayload, { book });
    if (!matchupEntries.length) {
      console.warn('⚠️  Odds payload has no matchup entries. Skipping join.');
      process.exit(0);
    }

    const runTimestamp = modelRows[0]?.run_timestamp || new Date().toISOString();

    matchupEntries.forEach(entry => {
      const players = entry.players;
      const playerIds = players.map(player => player.id);
      const scores = playerIds.map(id => scoreById.get(id));
      if (scores.some(score => !Number.isFinite(score))) return;

      let probs = [];
      if (players.length === 2) {
        const diff = scores[0] - scores[1];
        const p1 = logistic(diff);
        probs = [p1, 1 - p1];
      } else if (players.length === 3) {
        probs = buildSoftmax(scores);
      } else {
        return;
      }

      players.forEach((player, index) => {
        const playerId = player.id;
        const opponents = playerIds.filter(id => id !== playerId);
        const oddsValue = entry.oddsById.get(playerId) ?? null;
        const implied = impliedProbabilityFromDecimal(oddsValue);
        const pModel = probs[index];
        const edge = Number.isFinite(pModel) && implied !== null
          ? pModel - implied
          : null;

        joinedRows.push({
          run_timestamp: runTimestamp,
          event_id: resolvedEventId,
          season: String(season),
          odds_year: yearTag || String(year || ''),
          market_type: marketType,
          book,
          odds_point: oddsPoint,
          player_id: playerId,
          player_name: player.name || '',
          opponent_ids: opponents.join(','),
          p_model: Number.isFinite(pModel) ? pModel : '',
          odds_decimal: oddsValue ?? '',
          p_implied: implied ?? '',
          edge: edge ?? '',
          odds_source_path: oddsPath,
          model_probs_path: modelProbsPath || ''
        });
      });
    });
  } else {
    const oddsEntries = extractOddsEntries(oddsPayload);
    if (!oddsEntries.length) {
      console.warn('⚠️  Odds payload has no entries. Skipping join.');
      process.exit(0);
    }

    const oddsById = new Map();
    for (const entry of oddsEntries) {
      const dgId = normalizeId(entry.dg_id || entry.dgId || entry.player_id || entry.playerId);
      if (!dgId) continue;
      oddsById.set(dgId, entry);
    }

    modelRows.forEach(row => {
      const playerId = normalizeId(row.player_id || row.dg_id || row.playerId);
      if (!playerId) return;
      const oddsEntry = oddsById.get(playerId);
      if (!oddsEntry) return;

      const oddsValue = pickOddsValue(oddsEntry, oddsPoint, { oddsSource, book });
      const implied = impliedProbabilityFromDecimal(oddsValue);
      const pModel = Number(row.p_model || row.p_win);
      const edge = Number.isFinite(pModel) && implied !== null
        ? pModel - implied
        : null;

      joinedRows.push({
        run_timestamp: row.run_timestamp,
        event_id: resolvedEventId,
        season: String(season),
        odds_year: yearTag || String(year || ''),
        market_type: row.market_type || marketType || 'outright_win',
        book,
        odds_point: oddsPoint,
        player_id: playerId,
        player_name: row.player_name || oddsEntry.player_name || oddsEntry.name || '',
        p_model: Number.isFinite(pModel) ? pModel : '',
        odds_decimal: oddsValue ?? '',
        p_implied: implied ?? '',
        edge: edge ?? '',
        odds_source_path: oddsPath,
        model_probs_path: modelProbsPath
      });
    });
  }

  if (!joinedRows.length) {
    console.error('❌ No join results produced. Check IDs and inputs.');
    process.exit(1);
  }

  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const outputDir = path.resolve(DATA_DIR, 'wagering', resolvedSlug, 'inputs');
  const yearSuffix = yearTag ? `_y${String(yearTag).trim()}` : '';
  const bookSuffix = book ? `_${String(book).trim().toLowerCase()}` : '';
  const outputPath = path.resolve(outputDir, `${resolvedSlug}_${marketSlug}_${oddsSourceKey}${yearSuffix}${bookSuffix}_odds_join.csv`);
  writeCsv(outputPath, joinedRows, [
    'run_timestamp',
    'event_id',
    'season',
    'odds_year',
    'market_type',
    'book',
    'odds_point',
    'player_id',
    'player_name',
    'opponent_ids',
    'p_model',
    'odds_decimal',
    'p_implied',
    'edge',
    'odds_source_path',
    'model_probs_path'
  ]);

  console.log(`✓ Odds join saved to ${outputPath}`);
};

main();
