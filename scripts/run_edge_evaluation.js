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

const resolveOddsJoinPath = ({ tournamentSlug, market, oddsSource, yearTag, book }) => {
  const dir = path.resolve(DATA_DIR, 'wagering', String(tournamentSlug), 'inputs');
  if (!fs.existsSync(dir)) return null;
  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const yearSuffix = yearTag ? `_y${String(yearTag).trim()}` : '';
  const bookSuffix = book ? `_${String(book).trim().toLowerCase()}` : '';
  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('_odds_join.csv'))
    .map(file => path.resolve(dir, file));
  if (!files.length) return null;
  const preferred = files.find(file => file.includes(tournamentSlug) && file.includes(`_${marketSlug}_odds_join.csv`));
  const withSource = tournamentSlug
    ? files.find(file => file.includes(tournamentSlug) && file.includes(`_${marketSlug}_${oddsSourceKey}${yearSuffix}${bookSuffix}_odds_join.csv`))
    : files.find(file => file.includes(`_${marketSlug}_${oddsSourceKey}${yearSuffix}${bookSuffix}_odds_join.csv`));
  const fallback = files.find(file => file.includes(tournamentSlug));
  return withSource || preferred || fallback || files[0];
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

  const outcomeRaw = entry[`${prefix}_outcome`]
    ?? entry[`${prefix}_win`]
    ?? entry[`${prefix}_result`]
    ?? base.outcome
    ?? base.win
    ?? base.result;
  const outcome = outcomeRaw !== undefined && outcomeRaw !== null && outcomeRaw !== ''
    ? (Number(outcomeRaw) === 1 || String(outcomeRaw).toLowerCase().includes('win') ? 1 : 0)
    : null;

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

  return { id, odds, outcome };
};

const extractMatchupEntries = payload => {
  const entries = extractOddsEntries(payload);
  if (!entries.length) return [];
  return entries.map(entry => {
    const p1 = extractPlayerFromEntry(entry, 'p1');
    const p2 = extractPlayerFromEntry(entry, 'p2');
    const p3 = extractPlayerFromEntry(entry, 'p3');
    const players = [p1, p2, p3].filter(Boolean);
    const outcomeById = new Map();
    players.forEach(player => {
      if (player.outcome !== null && player.outcome !== undefined) {
        outcomeById.set(player.id, player.outcome);
      }
    });
    return { players, outcomeById };
  }).filter(entry => entry.players.length >= 2);
};

const normalizeOutcome = entry => {
  if (!entry) return null;
  const raw = entry.outcome ?? entry.win_flag ?? entry.winFlag ?? entry.bet_outcome ?? entry.betOutcome ?? null;
  if (raw !== null && raw !== undefined && raw !== '') {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric > 0 ? 1 : 0;
    const text = String(raw).toLowerCase();
    if (text.includes('win') || text === 'w' || text === 'winner') return 1;
    if (text.includes('loss') || text === 'l') return 0;
  }
  const betText = entry.bet_outcome_text || entry.betOutcomeText || '';
  if (betText) {
    const text = String(betText).toLowerCase();
    if (text.includes('win')) return 1;
    if (text.includes('loss')) return 0;
  }
  return null;
};

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

const mean = values => {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const stdDev = values => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
};

const logistic = value => 1 / (1 + Math.exp(-value));

const gradeFromEdgeZ = edgeZ => {
  if (!Number.isFinite(edgeZ)) return '';
  const score = logistic(edgeZ);
  if (score >= 0.8) return 'A';
  if (score >= 0.65) return 'B';
  if (score >= 0.5) return 'C';
  return 'D';
};

const main = () => {
  const args = parseArgs();
  const season = args.season;
  const eventId = args.eventId || args.event;
  const tournamentSlug = args.tournamentSlug || args.slug;
  const tournamentName = args.tournamentName || args.name;
  const market = args.market || 'win';
  const oddsSource = args.oddsSource || args.odds_source || 'historical';
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const yearTag = args.yearTag || args.year_tag || null;
  const book = args.book || null;
  const oddsJoinPathArg = args.oddsJoinPath || args.odds_join_path;

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
  const oddsJoinPath = oddsJoinPathArg || resolveOddsJoinPath({
    tournamentSlug: resolvedSlug,
    market,
    oddsSource: oddsSourceKey,
    yearTag,
    book
  });

  if (!oddsJoinPath || !fs.existsSync(oddsJoinPath)) {
    console.error('❌ Could not find odds_join CSV.');
    process.exit(1);
  }

  const oddsJoinRows = readCsv(oddsJoinPath);
  if (!oddsJoinRows.length) {
    console.error('❌ odds_join CSV is empty.');
    process.exit(1);
  }

  const oddsSourcePath = oddsJoinRows[0].odds_source_path || oddsJoinRows[0].odds_source || '';
  const oddsPayload = oddsSourcePath ? readJson(oddsSourcePath) : null;
  const oddsEntries = extractOddsEntries(oddsPayload);
  const oddsOutcomeById = new Map();
  oddsEntries.forEach(entry => {
    const dgId = normalizeId(entry.dg_id || entry.dgId || entry.player_id || entry.playerId);
    if (!dgId) return;
    oddsOutcomeById.set(dgId, normalizeOutcome(entry));
  });

  const matchupEntries = extractMatchupEntries(oddsPayload);
  const matchupOutcomeByKey = new Map();
  matchupEntries.forEach(entry => {
    const ids = entry.players.map(player => player.id);
    const key = canonicalKey(ids);
    matchupOutcomeByKey.set(key, entry.outcomeById);
  });

  const edges = [];
  const evaluationRows = oddsJoinRows.map(row => {
    const pModel = Number(row.p_model);
    const pImplied = Number(row.p_implied);
    const edge = Number(row.edge);
    if (Number.isFinite(edge)) edges.push(edge);
    const rowPlayerId = normalizeId(row.player_id);
    const opponents = parseOpponentIds(row.opponent_ids);
    let outcome = null;
    if (opponents.length) {
      const key = canonicalKey([rowPlayerId, ...opponents]);
      const outcomeMap = matchupOutcomeByKey.get(key);
      if (outcomeMap && outcomeMap.has(rowPlayerId)) {
        outcome = outcomeMap.get(rowPlayerId);
      }
    }
    if (outcome === null && oddsOutcomeById.has(rowPlayerId)) {
      outcome = oddsOutcomeById.get(rowPlayerId);
    }
    return {
      ...row,
      outcome: outcome ?? '',
      p_model: Number.isFinite(pModel) ? pModel : '',
      p_implied: Number.isFinite(pImplied) ? pImplied : '',
      edge: Number.isFinite(edge) ? edge : ''
    };
  });

  const edgeMean = mean(edges) ?? 0;
  const edgeStd = stdDev(edges) || 0;

  evaluationRows.forEach(row => {
    const edge = Number(row.edge);
    const edgeZ = Number.isFinite(edge) && edgeStd > 0 ? (edge - edgeMean) / edgeStd : null;
    row.edge_z = Number.isFinite(edgeZ) ? edgeZ : '';
    row.grade_edge = Number.isFinite(edgeZ) ? gradeFromEdgeZ(edgeZ) : '';
  });

  const scoredRows = evaluationRows.filter(row => row.outcome !== '' && row.outcome !== null);
  const outcomes = scoredRows.map(row => Number(row.outcome));
  const pModels = scoredRows.map(row => Number(row.p_model)).filter(value => Number.isFinite(value));

  const brier = outcomes.length && pModels.length
    ? outcomes.reduce((sum, y, idx) => {
      const p = Math.min(Math.max(pModels[idx], 1e-9), 1 - 1e-9);
      return sum + Math.pow(p - y, 2);
    }, 0) / outcomes.length
    : null;

  const logLoss = outcomes.length && pModels.length
    ? outcomes.reduce((sum, y, idx) => {
      const p = Math.min(Math.max(pModels[idx], 1e-9), 1 - 1e-9);
      return sum - (y * Math.log(p) + (1 - y) * Math.log(1 - p));
    }, 0) / outcomes.length
    : null;

  const hitRate = outcomes.length
    ? outcomes.reduce((sum, y) => sum + (y === 1 ? 1 : 0), 0) / outcomes.length
    : null;

  const summary = {
    event_id: resolvedEventId,
    season: String(season),
    odds_year: yearTag || oddsJoinRows[0]?.odds_year || '',
    book: book || '',
    market: String(market),
    total_rows: evaluationRows.length,
    rows_with_outcomes: outcomes.length,
    avg_edge: edges.length ? edgeMean : null,
    median_edge: edges.length ? median(edges) : null,
    hit_rate: hitRate,
    brier,
    log_loss: logLoss
  };

  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const outputDir = path.resolve(DATA_DIR, 'wagering', resolvedSlug, 'inputs');
  const yearSuffix = yearTag ? `_y${String(yearTag).trim()}` : '';
  const bookSuffix = book ? `_${String(book).trim().toLowerCase()}` : '';
  const outputSummaryPath = path.resolve(outputDir, `${resolvedSlug}_${marketSlug}_${oddsSourceKey}${yearSuffix}${bookSuffix}_edge_summary.json`);
  const outputSummaryCsv = path.resolve(outputDir, `${resolvedSlug}_${marketSlug}_${oddsSourceKey}${yearSuffix}${bookSuffix}_edge_summary.csv`);
  const outputEvalCsv = path.resolve(outputDir, `${resolvedSlug}_${marketSlug}_${oddsSourceKey}${yearSuffix}${bookSuffix}_odds_eval.csv`);

  ensureDir(outputDir);
  fs.writeFileSync(outputSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeCsv(outputSummaryCsv, [summary], Object.keys(summary));

  writeCsv(outputEvalCsv, evaluationRows, [
    'run_timestamp',
    'event_id',
    'season',
    'market_type',
    'book',
    'odds_point',
    'player_id',
    'player_name',
    'p_model',
    'odds_decimal',
    'p_implied',
    'edge',
    'edge_z',
    'grade_edge',
    'outcome',
    'odds_source_path',
    'model_probs_path'
  ]);

  console.log(`✓ Edge summary saved to ${outputSummaryPath}`);
  console.log(`✓ Evaluation rows saved to ${outputEvalCsv}`);
};

main();
