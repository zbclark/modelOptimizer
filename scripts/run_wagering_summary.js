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

const writeMarkdown = (filePath, lines) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
};

const resolveWageringTournamentDir = tournamentSlug => path.resolve(DATA_DIR, 'wagering', String(tournamentSlug));

const resolveOddsEvalPath = ({ tournamentSlug, market, oddsSource, book }) => {
  const dir = path.resolve(resolveWageringTournamentDir(tournamentSlug), 'inputs');
  if (!fs.existsSync(dir)) return null;
  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const bookSuffix = book ? `_${String(book).trim().toLowerCase()}` : '';
  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('_odds_eval.csv'))
    .map(file => path.resolve(dir, file));
  if (!files.length) return null;
  const preferred = tournamentSlug
    ? files.find(file => file.includes(tournamentSlug) && file.includes(`_${marketSlug}_${oddsSourceKey}`) && file.includes(`${bookSuffix}_odds_eval.csv`))
    : files.find(file => file.includes(`_${marketSlug}_${oddsSourceKey}${bookSuffix}_odds_eval.csv`));
  const fallback = tournamentSlug ? files.find(file => file.includes(tournamentSlug)) : null;
  return preferred || fallback || files[0];
};

const resolveOddsJoinPath = ({ tournamentSlug, market, oddsSource, book }) => {
  const dir = path.resolve(resolveWageringTournamentDir(tournamentSlug), 'inputs');
  if (!fs.existsSync(dir)) return null;
  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const bookSuffix = book ? `_${String(book).trim().toLowerCase()}` : '';
  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('_odds_join.csv'))
    .map(file => path.resolve(dir, file));
  if (!files.length) return null;
  const preferred = tournamentSlug
    ? files.find(file => file.includes(tournamentSlug) && file.includes(`_${marketSlug}_${oddsSourceKey}`) && file.includes(`${bookSuffix}_odds_join.csv`))
    : files.find(file => file.includes(`_${marketSlug}_${oddsSourceKey}${bookSuffix}_odds_join.csv`));
  const fallback = tournamentSlug ? files.find(file => file.includes(tournamentSlug)) : null;
  return preferred || fallback || files[0];
};

const resolveModelProbsPath = ({ tournamentSlug, market }) => {
  const dir = path.resolve(resolveWageringTournamentDir(tournamentSlug), 'inputs');
  if (!fs.existsSync(dir)) return null;
  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('_model_probs.csv'))
    .map(file => path.resolve(dir, file));
  if (!files.length) return null;
  const preferred = tournamentSlug
    ? files.find(file => file.includes(tournamentSlug) && file.includes(`_${marketSlug}_model_probs.csv`))
    : null;
  const fallback = tournamentSlug ? files.find(file => file.includes(tournamentSlug)) : null;
  return preferred || fallback || files[0];
};

const resolveEdgeSummaryPath = ({ tournamentSlug, market, oddsSource, book }) => {
  const dir = path.resolve(resolveWageringTournamentDir(tournamentSlug), 'inputs');
  if (!fs.existsSync(dir)) return null;
  const marketSlug = String(market || 'win').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const bookSuffix = book ? `_${String(book).trim().toLowerCase()}` : '';
  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('_edge_summary.json'))
    .map(file => path.resolve(dir, file));
  if (!files.length) return null;
  const preferred = tournamentSlug
    ? files.find(file => file.includes(tournamentSlug) && file.includes(`_${marketSlug}_${oddsSourceKey}`) && file.includes(`${bookSuffix}_edge_summary.json`))
    : files.find(file => file.includes(`_${marketSlug}_${oddsSourceKey}${bookSuffix}_edge_summary.json`));
  const fallback = tournamentSlug ? files.find(file => file.includes(tournamentSlug)) : null;
  return preferred || fallback || files[0];
};

const buildInputsCsvRows = (season, market, oddsSourceKey, outputs) => outputs.map(item => ({
  season: String(season),
  market: String(market),
  odds_source: oddsSourceKey,
  label: item.label,
  path: item.path || '',
  exists: item.exists ? 'true' : 'false'
}));

const getValueVerdict = edgeSummary => {
  if (!edgeSummary) return 'Unknown';
  const avgEdge = Number(edgeSummary.avg_edge);
  if (!Number.isFinite(avgEdge)) return 'Unknown';
  if (avgEdge > 0) return 'Positive';
  if (avgEdge < 0) return 'Negative';
  return 'Neutral';
};

const buildSummaryMarkdown = ({ title, edgeSummary, monthlyRows, outputs }) => {
  const lines = [];
  const verdict = getValueVerdict(edgeSummary);
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('## Edge summary');
  lines.push('');
  if (!edgeSummary) {
    lines.push('- No edge summary found.');
  } else {
    lines.push(`- Model value vs market: ${verdict}`);
    lines.push(`- Event ID: ${edgeSummary.event_id ?? ''}`);
    lines.push(`- Season: ${edgeSummary.season ?? ''}`);
    lines.push(`- Total rows: ${edgeSummary.total_rows ?? ''}`);
    lines.push(`- Rows w/ outcomes: ${edgeSummary.rows_with_outcomes ?? ''}`);
    lines.push(`- Avg edge: ${edgeSummary.avg_edge ?? ''}`);
    lines.push(`- Median edge: ${edgeSummary.median_edge ?? ''}`);
    lines.push(`- Hit rate: ${edgeSummary.hit_rate ?? ''}`);
    lines.push(`- Brier: ${edgeSummary.brier ?? ''}`);
    lines.push(`- LogLoss: ${edgeSummary.log_loss ?? ''}`);
  }
  lines.push('');
  lines.push('## Monthly simulation');
  lines.push('');
  if (!monthlyRows || !monthlyRows.length) {
    lines.push('- No monthly simulation rows found.');
  } else {
    lines.push('| Month | Bets | Stake | Return | Net | ROI | Hit rate |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    monthlyRows.forEach(row => {
      lines.push(`| ${row.month} | ${row.total_bets} | ${row.total_stake} | ${row.total_return} | ${row.net} | ${row.roi} | ${row.hit_rate} |`);
    });
  }
  lines.push('');
  lines.push('## Outputs');
  lines.push('');
  if (!outputs || !outputs.length) {
    lines.push('- No outputs captured.');
  } else {
    outputs.forEach(item => {
      if (!item?.path) {
        lines.push(`- ${item.label}: (missing)`);
        return;
      }
      lines.push(`- ${item.label}: ${item.exists ? item.path : `(missing) ${item.path}`}`);
    });
  }
  lines.push('');
  return lines;
};

const buildOutputEntry = (label, filePath) => ({
  label,
  path: filePath || null,
  exists: Boolean(filePath && fs.existsSync(filePath))
});

const main = () => {
  const args = parseArgs();
  const season = args.season;
  const tournamentSlug = args.tournamentSlug || args.slug;
  const market = args.market || 'win';
  const oddsSource = args.oddsSource || args.odds_source || 'historical';
  const oddsSourceKey = String(oddsSource || 'historical').trim().toLowerCase();
  const yearTag = args.yearTag || args.year_tag || null;
  const book = args.book || '';
  const tour = args.tour || 'pga';
  const dkSite = args.dkSite || args.dk_site || 'draftkings';
  const dkSlate = args.dkSlate || args.dk_slate || 'main';
  const edgeSummaryPathArg = args.edgeSummaryPath || args.edge_summary_path;
  const monthlyPathArg = args.monthlyPath || args.monthly_path;

  if (!season) {
    console.error('❌ Missing --season.');
    process.exit(1);
  }

  const edgeSummaryPath = edgeSummaryPathArg || resolveEdgeSummaryPath({ tournamentSlug, market, oddsSource: oddsSourceKey, book });
  const oddsEvalPath = resolveOddsEvalPath({ tournamentSlug, market, oddsSource: oddsSourceKey, book });
  const oddsJoinPath = resolveOddsJoinPath({ tournamentSlug, market, oddsSource: oddsSourceKey, book });
  const oddsEvalRows = oddsEvalPath ? readCsv(oddsEvalPath) : [];
  const oddsSourcePath = oddsEvalRows[0]?.odds_source_path || oddsEvalRows[0]?.odds_source || null;
  const modelProbsPath = oddsEvalRows[0]?.model_probs_path
    || resolveModelProbsPath({ tournamentSlug, market });
  const edgeSummaryCsvPath = edgeSummaryPath
    ? edgeSummaryPath.replace(/_edge_summary\.json$/i, '_edge_summary.csv')
    : null;
  const dkOutputDir = path.resolve(DATA_DIR, 'fantasy', dkSite, tour, dkSlate);
  const dkLineupsJson = path.resolve(dkOutputDir, 'top_lineups.json');
  const dkLineupsCsv = path.resolve(dkOutputDir, 'top_lineups.csv');

  const edgeSummary = edgeSummaryPath ? readJson(edgeSummaryPath) : null;

  const outputDir = resolveWageringTournamentDir(tournamentSlug || 'season');
  ensureDir(outputDir);
  const outputResultsJson = path.resolve(outputDir, 'results.json');
  const outputResultsCsv = path.resolve(outputDir, 'results.csv');
  const outputInputsJson = path.resolve(outputDir, 'inputs.json');
  const outputInputsCsv = path.resolve(outputDir, 'inputs.csv');

  const outputs = [
    buildOutputEntry('Odds archive', oddsSourcePath),
    buildOutputEntry('Model probabilities', modelProbsPath),
    buildOutputEntry('Odds join', oddsJoinPath),
    buildOutputEntry('Odds evaluation', oddsEvalPath),
    buildOutputEntry('Edge summary (json)', edgeSummaryPath),
    buildOutputEntry('Edge summary (csv)', edgeSummaryCsvPath),
    buildOutputEntry('DK lineups (json)', dkLineupsJson),
    buildOutputEntry('DK lineups (csv)', dkLineupsCsv)
  ];

  const resultsPayload = {
    season: String(season),
    tournament_slug: tournamentSlug || null,
    market: String(market),
    odds_source: oddsSourceKey,
    odds_year: yearTag || edgeSummary?.odds_year || '',
    book: String(book || ''),
    value_verdict: getValueVerdict(edgeSummary),
    edge_summary: edgeSummary || null
  };

  const existingResults = fs.existsSync(outputResultsJson)
    ? readJson(outputResultsJson)
    : {};
  const mergedResults = { ...existingResults };
  if (!mergedResults[oddsSourceKey]) {
    mergedResults[oddsSourceKey] = [];
  }
  if (!Array.isArray(mergedResults[oddsSourceKey])) {
    mergedResults[oddsSourceKey] = [mergedResults[oddsSourceKey]];
  }
  mergedResults[oddsSourceKey].push(resultsPayload);
  fs.writeFileSync(outputResultsJson, `${JSON.stringify(mergedResults, null, 2)}\n`);

  const resultsRows = Object.entries(mergedResults).flatMap(([source, payloads]) => {
    const list = Array.isArray(payloads) ? payloads : [payloads];
    return list.map(payload => ({
      odds_source: source,
      odds_year: payload.odds_year || '',
      book: payload.book || '',
      season: payload.season || '',
      tournament_slug: payload.tournament_slug || '',
      market: payload.market || '',
      value_verdict: payload.value_verdict || '',
      avg_edge: payload.edge_summary?.avg_edge ?? '',
      median_edge: payload.edge_summary?.median_edge ?? '',
      hit_rate: payload.edge_summary?.hit_rate ?? '',
      brier: payload.edge_summary?.brier ?? '',
      log_loss: payload.edge_summary?.log_loss ?? ''
    }));
  });
  writeCsv(outputResultsCsv, resultsRows, [
    'odds_source',
    'odds_year',
    'book',
    'season',
    'tournament_slug',
    'market',
    'value_verdict',
    'avg_edge',
    'median_edge',
    'hit_rate',
    'brier',
    'log_loss'
  ]);

  const inputsPayload = {
    season: String(season),
    tournament_slug: tournamentSlug || null,
    market: String(market),
    odds_source: oddsSourceKey,
    odds_year: yearTag || edgeSummary?.odds_year || '',
    book: String(book || ''),
    generated_at: new Date().toISOString(),
    outputs
  };

  const existingInputs = fs.existsSync(outputInputsJson)
    ? readJson(outputInputsJson)
    : {};
  const mergedInputs = { ...existingInputs };
  if (!mergedInputs[oddsSourceKey]) {
    mergedInputs[oddsSourceKey] = [];
  }
  if (!Array.isArray(mergedInputs[oddsSourceKey])) {
    mergedInputs[oddsSourceKey] = [mergedInputs[oddsSourceKey]];
  }
  mergedInputs[oddsSourceKey].push(inputsPayload);
  fs.writeFileSync(outputInputsJson, `${JSON.stringify(mergedInputs, null, 2)}\n`);
  const inputRows = Object.entries(mergedInputs).flatMap(([source, payloads]) => {
    const list = Array.isArray(payloads) ? payloads : [payloads];
    return list.flatMap(payload =>
      buildInputsCsvRows(payload.season || season, payload.market || market, source, payload.outputs || [])
        .map(row => ({
          ...row,
          odds_year: payload.odds_year || '',
          book: payload.book || ''
        }))
    );
  });
  writeCsv(outputInputsCsv, inputRows, [
    'season',
    'market',
    'odds_source',
    'odds_year',
    'book',
    'label',
    'path',
    'exists'
  ]);

  console.log(`✓ Results saved to ${outputResultsJson} and ${outputResultsCsv}`);
  console.log(`✓ Inputs saved to ${outputInputsJson} and ${outputInputsCsv}`);
};

main();
