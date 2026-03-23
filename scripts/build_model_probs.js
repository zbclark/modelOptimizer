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

const formatProb = value => {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(6);
};

const formatScore = value => {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(6);
};

const buildTopNProbabilities = (scores, topN) => {
  const avg = mean(scores);
  const sd = stdDev(scores) || 1;
  const zScores = scores.map(score => (score - avg) / sd);
  const fieldSize = scores.length;
  const targetRate = Math.min(Math.max(topN / fieldSize, 0), 1);
  const threshold = percentile(zScores, 1 - targetRate);

  let low = 0.1;
  let high = 20;
  let scale = 1;
  for (let i = 0; i < 30; i += 1) {
    scale = (low + high) / 2;
    const avgProb = zScores.reduce((sum, z) => sum + logistic(scale * (z - threshold)), 0) / zScores.length;
    if (avgProb > targetRate) {
      high = scale;
    } else {
      low = scale;
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
  const market = String(args.market || 'win').trim().toLowerCase();

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

  if (market === 'top_5' || market === 'top5') {
    topN = 5;
    marketProbs = buildTopNProbabilities(scores, topN);
  } else if (market === 'top_10' || market === 'top10') {
    topN = 10;
    marketProbs = buildTopNProbabilities(scores, topN);
  } else if (market === 'top_20' || market === 'top20') {
    topN = 20;
    marketProbs = buildTopNProbabilities(scores, topN);
  }

  const marketSlug = market.replace(/[^a-z0-9]+/g, '_');
  const marketType = topN ? `top_${topN}` : 'outright_win';
  const runTimestamp = resultsPayload?.timestamp || new Date().toISOString();
  const rows = players.map((player, index) => ({
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
