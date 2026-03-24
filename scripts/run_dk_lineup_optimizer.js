const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const solver = require('javascript-lp-solver');

const { getDataGolfFantasyProjectionDefaults } = require('../utilities/dataGolfClient');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const CACHE_DIR = path.resolve(DATA_DIR, 'wagering', 'fantasy', 'cache', 'datagolf');

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

const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
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

const parseCsvLine = line => {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
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
  return values;
};

const normalizeName = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const buildNameVariants = value => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const variants = new Set();
  const normalized = normalizeName(raw);
  if (normalized) variants.add(normalized);

  const nicknameMap = {
    matt: 'matthew',
    matthew: 'matt'
  };

  const applyNicknameVariants = nameValue => {
    const tokens = normalizeName(nameValue).split(' ').filter(Boolean);
    if (!tokens.length) return;
    const [first, ...rest] = tokens;
    const mapped = nicknameMap[first];
    if (mapped && rest.length) {
      const expanded = [mapped, ...rest].join(' ');
      if (expanded) variants.add(expanded);
    }
  };

  if (raw.includes(',')) {
    const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const swapped = `${parts.slice(1).join(' ')} ${parts[0]}`.trim();
      const swappedNorm = normalizeName(swapped);
      if (swappedNorm) variants.add(swappedNorm);
      applyNicknameVariants(swapped);
    }
  }

  const tokens = raw.split(/and|\s+/).map(token => token.trim()).filter(Boolean);
  if (tokens.length === 2) {
    const swapped = `${tokens[1]} ${tokens[0]}`;
    const swappedNorm = normalizeName(swapped);
    if (swappedNorm) variants.add(swappedNorm);
    applyNicknameVariants(swapped);
  }

  applyNicknameVariants(raw);

  return Array.from(variants);
};

const buildDkIdLookupFromTemplate = templateLines => {
  if (!Array.isArray(templateLines) || !templateLines.length) return null;
  const headerIndex = templateLines.findIndex(line => (
    line.includes('Name + ID') && line.includes('Position') && line.includes('ID')
  ));
  if (headerIndex === -1) return null;
  const headerCells = parseCsvLine(templateLines[headerIndex]);
  const nameIndex = headerCells.findIndex(cell => String(cell || '').trim() === 'Name');
  const namePlusIdIndex = headerCells.findIndex(cell => String(cell || '').trim() === 'Name + ID');
  const idIndex = headerCells.findIndex(cell => String(cell || '').trim() === 'ID');
  if (nameIndex === -1 || idIndex === -1) return null;
  const lookup = new Map();
  for (let i = headerIndex + 1; i < templateLines.length; i += 1) {
    const line = templateLines[i];
    if (!line || !line.trim()) continue;
    const cells = parseCsvLine(line);
    const nameCell = cells[nameIndex] || '';
    const namePlusCell = namePlusIdIndex >= 0 ? cells[namePlusIdIndex] : '';
    const idCell = cells[idIndex];
    if (!nameCell || !idCell) continue;
    const dkId = String(idCell).trim();
    const baseName = String(nameCell).trim();
    const variants = buildNameVariants(baseName);
    if (namePlusCell && namePlusCell.includes('(')) {
      const cleaned = String(namePlusCell).replace(/\([^)]*\)/g, '').trim();
      variants.push(...buildNameVariants(cleaned));
    }
    variants.forEach(variant => {
      if (variant && !lookup.has(variant)) {
        lookup.set(variant, dkId);
      }
    });
  }
  return lookup;
};

const buildDkUploadLines = ({ templateLines, lineups, nameToId }) => {
  if (!templateLines.length) return [];
  const headerCells = parseCsvLine(templateLines[0]);
  const columnCount = headerCells.length || 6;
  const lines = [templateLines[0]];
  const missingNames = new Set();

  lineups.forEach(lineup => {
    const row = Array.from({ length: columnCount }).map(() => '');
    lineup.players.forEach((player, index) => {
      if (index > 5) return;
      const variants = buildNameVariants(player.name);
      let dkId = '';
      for (const variant of variants) {
        if (nameToId.has(variant)) {
          dkId = nameToId.get(variant);
          break;
        }
      }
      if (!dkId) missingNames.add(player.name || `unknown_${index + 1}`);
      row[index] = dkId;
    });
    lines.push(row.join(','));
  });

  for (let i = 1; i < templateLines.length; i += 1) {
    lines.push(templateLines[i]);
  }

  return { lines, missingNames: Array.from(missingNames) };
};

const sanitizeKey = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const buildPlayerKey = player => {
  const dgId = player.dg_id || player.dgId || player.player_id || player.playerId;
  if (dgId) return `dg_${dgId}`;
  const siteName = player.site_name_id || player.siteNameId || player.player_name || player.playerName;
  return `name_${sanitizeKey(siteName)}`;
};

const resolveModelProbsPath = ({ season, tournamentSlug, market }) => {
  const dir = path.resolve(DATA_DIR, 'model_probs', String(season));
  if (!fs.existsSync(dir)) return null;
  const marketSlug = String(market || 'top_10').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
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

const buildSolverModel = (players, salaryCap, lineupSize, ownershipWeight, minSalaryUsed) => {
  const model = {
    optimize: 'obj',
    opType: 'max',
    constraints: {
      salary: { max: salaryCap },
      players: { equal: lineupSize }
    },
    variables: {},
    binaries: {}
  };

  if (Number.isFinite(minSalaryUsed) && minSalaryUsed > 0) {
    model.constraints.salary.min = minSalaryUsed;
  }

  players.forEach(player => {
    const key = player.key;
    model.variables[key] = {
      obj: player.projPoints - ownershipWeight * player.projOwnership,
      salary: player.salary,
      players: 1
    };
    model.binaries[key] = 1;
  });

  return model;
};

const extractLineup = (solution, players) => {
  const selected = players.filter(player => solution[player.key] === 1);
  const totalSalary = selected.reduce((sum, p) => sum + p.salary, 0);
  const totalPoints = selected.reduce((sum, p) => sum + p.projPoints, 0);
  const totalOwnership = selected.reduce((sum, p) => sum + p.projOwnership, 0);
  return {
    players: selected,
    totalSalary,
    totalPoints,
    totalOwnership
  };
};

const addExcludeConstraint = (model, lineup, index, lineupSize) => {
  const constraintName = `exclude_${index}`;
  model.constraints[constraintName] = { max: lineupSize - 1 };
  lineup.players.forEach(player => {
    if (!model.variables[player.key]) return;
    model.variables[player.key][constraintName] = 1;
  });
};

const parseListArg = value => {
  if (!value) return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const matchesPlayer = (player, token) => {
  if (!token) return false;
  const normalized = String(token).trim().toLowerCase();
  if (!normalized) return false;
  if (String(player.dgId).trim() === normalized || `dg_${String(player.dgId).trim()}` === normalized) return true;
  const name = String(player.name || '').trim().toLowerCase();
  return name === normalized || name.includes(normalized);
};

const buildExposureLimits = (players, maxExposure, topN) => {
  if (!Number.isFinite(maxExposure) || maxExposure <= 0) return new Map();
  const maxCount = Math.max(1, Math.floor(maxExposure * topN));
  const limits = new Map();
  players.forEach(player => {
    limits.set(player.key, maxCount);
  });
  return limits;
};

const main = async () => {
  const args = parseArgs();
  const tour = args.tour || 'pga';
  const site = args.site || 'draftkings';
  const slate = args.slate || 'main';
  const fileFormat = args.fileFormat || args.file_format || 'json';
  const inputPath = args.input || args.inputPath || null;
  const salaryCap = args.salaryCap ? Number(args.salaryCap) : 50000;
  const minSalaryUsed = args.minSalaryUsed ? Number(args.minSalaryUsed) : null;
  const lineupSize = args.lineupSize ? Number(args.lineupSize) : 6;
  const topN = args.topN ? Number(args.topN) : 20;
  const ownershipWeight = args.ownershipWeight ? Number(args.ownershipWeight) : 0.001;
  const season = args.season || null;
  const tournamentSlug = args.tournamentSlug || args.slug || null;
  const eventId = args.eventId || args.event_id || null;
  const modelMarket = args.modelMarket || args.model_market || 'top_10';
  const probThreshold = args.probThreshold ? Number(args.probThreshold) : 0.12;
  const modelMarketAlt = args.modelMarketAlt || args.model_market_alt || null;
  const probThresholdAlt = args.probThresholdAlt ? Number(args.probThresholdAlt) : null;
  const modelProbsPathArg = args.modelProbsPath || args.model_probs_path || null;
  const minProjPoints = args.minProjPoints ? Number(args.minProjPoints) : null;
  const maxOwnership = args.maxOwnership ? Number(args.maxOwnership) : null;
  const excludeList = parseListArg(args.exclude || args.excludePlayers);
  const lockList = parseListArg(args.lock || args.lockPlayers);
  const maxExposure = args.maxExposure ? Number(args.maxExposure) : 0.2;

  let payload = null;
  if (inputPath) {
    payload = readJson(path.resolve(inputPath));
  } else {
    const apiKey = String(process.env.DATAGOLF_API_KEY || '').trim();
    if (!apiKey) {
      console.error('❌ DATAGOLF_API_KEY is not set. Add it to your local .env file.');
      process.exit(1);
    }

    const snapshot = await getDataGolfFantasyProjectionDefaults({
      apiKey,
      cacheDir: CACHE_DIR,
      tour,
      site,
      slate,
      fileFormat,
      allowStale: true
    });

    payload = snapshot?.payload;
  }

  if (!payload || !Array.isArray(payload.projections)) {
    console.error('❌ No projections found in payload.');
    process.exit(1);
  }

  const projectionRows = payload.projections
    .map(row => {
      const salary = Number(row.salary);
      const projPoints = Number(
        row.proj_points
        || row.projPoints
        || row.proj_points_total
        || row.projPointsTotal
      );
      const projOwnership = Number(row.proj_ownership || row.projOwnership || 0);
      return {
        raw: row,
        key: buildPlayerKey(row),
        dgId: row.dg_id || row.dgId || '',
        name: row.player_name || row.playerName || '',
        salary,
        projPoints,
        projOwnership
      };
    })
    .filter(row => Number.isFinite(row.salary) && row.salary > 0 && Number.isFinite(row.projPoints));

  let playerPool = projectionRows;
  if (Number.isFinite(minProjPoints)) {
    playerPool = playerPool.filter(row => row.projPoints >= minProjPoints);
  }
  if (Number.isFinite(maxOwnership)) {
    playerPool = playerPool.filter(row => row.projOwnership <= maxOwnership);
  }
  if (excludeList.length) {
    playerPool = playerPool.filter(row => !excludeList.some(token => matchesPlayer(row, token)));
  }

  let poolBeforeThreshold = playerPool.length;
  if (Number.isFinite(probThreshold) || Number.isFinite(probThresholdAlt)) {
    if (!season || !tournamentSlug) {
      console.error('❌ --season and --tournamentSlug are required when using probability thresholds.');
      process.exit(1);
    }
    const probById = new Map();
    const loadMarketProbs = (market, threshold) => {
      if (!Number.isFinite(threshold)) return;
      const modelProbsPath = modelProbsPathArg || (season ? resolveModelProbsPath({
        season,
        tournamentSlug,
        market
      }) : null);
      if (!modelProbsPath || !fs.existsSync(modelProbsPath)) {
        console.warn(`⚠️ model_probs path not found for ${market}. Skipping threshold filter.`);
        return;
      }
      const modelRows = readCsv(modelProbsPath);
      modelRows.forEach(row => {
        const playerId = String(row.player_id || row.dg_id || '').trim();
        if (!playerId) return;
        const pModel = Number(row.p_model || row.p_top_n || row.p_win);
        if (!Number.isFinite(pModel)) return;
        const current = probById.get(playerId) || 0;
        if (pModel >= threshold && pModel > current) {
          probById.set(playerId, pModel);
        }
      });
    };

    loadMarketProbs(modelMarket, probThreshold);
    if (modelMarketAlt || Number.isFinite(probThresholdAlt)) {
      loadMarketProbs(modelMarketAlt || modelMarket, probThresholdAlt);
    }

    if (probById.size) {
      const filtered = playerPool.filter(row => {
        const pModel = probById.get(String(row.dgId || '').trim()) || 0;
        return pModel > 0;
      });

      if (filtered.length >= lineupSize) {
        playerPool = filtered;
      } else {
        console.warn('⚠️ Probability thresholds produced too few players. Keeping full pool.');
      }
    }
  }

  const lockedPlayers = lockList.length
    ? projectionRows.filter(row => lockList.some(token => matchesPlayer(row, token)))
    : [];

  if (!playerPool.length) {
    console.error('❌ No valid projection rows after filtering.');
    process.exit(1);
  }

  if (lockedPlayers.length > lineupSize) {
    console.error('❌ More locked players than lineup size.');
    process.exit(1);
  }

  const model = buildSolverModel(playerPool, salaryCap, lineupSize, ownershipWeight, minSalaryUsed);
  lockedPlayers.forEach(player => {
    const constraintName = `lock_${player.key}`;
    model.constraints[constraintName] = { min: 1 };
    if (model.variables[player.key]) {
      model.variables[player.key][constraintName] = 1;
    }
  });

  const exposureLimits = buildExposureLimits(playerPool, maxExposure, topN);
  const exposureCounts = new Map();
  const lineups = [];

  for (let i = 0; i < topN; i += 1) {
    const solution = solver.Solve(model);
    if (!solution || !solution.feasible) break;
    const lineup = extractLineup(solution, playerPool);
    if (!lineup.players.length) break;
    lineups.push(lineup);
    addExcludeConstraint(model, lineup, i + 1, lineupSize);

    if (exposureLimits.size) {
      lineup.players.forEach(player => {
        const current = exposureCounts.get(player.key) || 0;
        exposureCounts.set(player.key, current + 1);
      });

      exposureLimits.forEach((limit, key) => {
        const count = exposureCounts.get(key) || 0;
        if (count >= limit) {
          const constraintName = `exposure_${key}`;
          model.constraints[constraintName] = { max: 0 };
          if (model.variables[key]) {
            model.variables[key][constraintName] = 1;
          }
        }
      });
    }
  }

  if (!lineups.length) {
    console.error('❌ No feasible lineups found.');
    process.exit(1);
  }

  const outputDir = path.resolve(DATA_DIR, 'wagering', 'fantasy', site, tour, slate);
  ensureDir(outputDir);
  const outputBase = eventId ? `${eventId}_top_lineups` : 'top_lineups';
  const outputJson = path.resolve(outputDir, `${outputBase}.json`);
  const outputCsv = path.resolve(outputDir, `${outputBase}.csv`);

  const lineupPayload = {
    tour,
    site,
    slate,
    eventId: eventId ? String(eventId) : null,
    salaryCap,
    lineupSize,
    topN,
    ownershipWeight,
    minSalaryUsed,
    minProjPoints,
    maxOwnership,
    maxExposure,
    modelMarket,
    probThreshold,
    modelMarketAlt,
    probThresholdAlt,
    poolSizeBeforeThreshold: poolBeforeThreshold,
    poolSizeAfterThreshold: playerPool.length,
    lockedPlayers: lockedPlayers.map(player => ({ dgId: player.dgId, name: player.name })),
    excludedPlayers: excludeList,
    event_name: payload.event_name || payload.eventName || null,
    last_updated: payload.last_updated || payload.lastUpdated || null,
    lineup_salary_totals: lineups.map(lineup => lineup.totalSalary),
    lineups: lineups.map((lineup, idx) => ({
      rank: idx + 1,
      totalSalary: lineup.totalSalary,
      totalPoints: lineup.totalPoints,
      totalOwnership: lineup.totalOwnership,
      players: lineup.players.map(player => ({
        dgId: player.dgId,
        name: player.name,
        salary: player.salary,
        projPoints: player.projPoints,
        projOwnership: player.projOwnership
      }))
    }))
  };

  writeJson(outputJson, lineupPayload);

  const csvRows = [];
  lineups.forEach((lineup, idx) => {
    const base = {
      rank: idx + 1,
      total_salary: lineup.totalSalary,
      total_points: lineup.totalPoints,
      total_ownership: lineup.totalOwnership
    };
    lineup.players.forEach((player, pIndex) => {
      base[`p${pIndex + 1}_name`] = player.name;
      base[`p${pIndex + 1}_dgid`] = player.dgId;
      base[`p${pIndex + 1}_salary`] = player.salary;
      base[`p${pIndex + 1}_points`] = player.projPoints;
      base[`p${pIndex + 1}_own`] = player.projOwnership;
    });
    csvRows.push(base);
  });

  const headers = Object.keys(csvRows[0] || {});
  writeCsv(outputCsv, csvRows, headers);

  console.log(`✓ Top lineups saved to ${outputJson}`);
  console.log(`✓ CSV saved to ${outputCsv}`);
  console.log(`✓ Lineup total salaries: ${lineups.map(lineup => lineup.totalSalary).join(', ')}`);

  const dkTemplatePath = args.dkTemplatePath
    || args.dkSalariesPath
    || path.resolve(outputDir, 'DKSalaries.csv');
  if (fs.existsSync(dkTemplatePath)) {
    const templateRaw = fs.readFileSync(dkTemplatePath, 'utf8');
    const templateLines = templateRaw.split(/\r?\n/);
    const nameToId = buildDkIdLookupFromTemplate(templateLines);
    if (nameToId) {
      const { lines: uploadLines, missingNames } = buildDkUploadLines({
        templateLines,
        lineups,
        nameToId
      });
      const dkUploadPath = path.resolve(outputDir, `${eventId || 'top'}_DKSalaries.csv`);
      fs.writeFileSync(dkUploadPath, `${uploadLines.join('\n')}\n`);
      console.log(`✓ DK upload saved to ${dkUploadPath}`);
      if (missingNames.length) {
        console.warn(`⚠️  Missing DK IDs for ${missingNames.length} players: ${missingNames.join(', ')}`);
      }
    } else {
      console.warn('⚠️  Could not parse DKSalaries template; skipping DK upload output.');
    }
  } else {
    console.warn(`⚠️  DKSalaries template not found at ${dkTemplatePath}; skipping DK upload output.`);
  }
};

main();
