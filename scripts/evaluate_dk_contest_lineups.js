const fs = require('fs');
const path = require('path');
const solver = require('javascript-lp-solver');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const ODDS_DK_DIR = path.resolve(DATA_DIR, 'odds_archive', 'draftkings');
const CONTESTS_DK_DIR = path.resolve(DATA_DIR, 'contests', 'draftkings');
const OUTPUT_DIR = path.resolve(DATA_DIR, 'contests', 'draftkings', 'evaluations');

const ensureDir = dirPath => {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const readJson = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
};

const writeCsv = (filePath, rows, headers) => {
  ensureDir(path.dirname(filePath));
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
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
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

const normalizeName = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const buildNameVariants = name => {
  const variants = new Set();
  if (!name) return variants;
  const raw = String(name).trim();
  variants.add(raw);
  variants.add(raw.replace(/\./g, ''));
  if (raw.includes(',')) {
    const [last, first] = raw.split(',').map(part => part.trim()).filter(Boolean);
    if (first && last) {
      variants.add(`${first} ${last}`);
      variants.add(`${first} ${last}`.replace(/\./g, ''));
    }
  }
  return variants;
};

const buildNameIndex = players => {
  const index = new Map();
  (players || []).forEach(player => {
    const variants = buildNameVariants(player.player_name || player.name || '');
    variants.forEach(variant => {
      const key = normalizeName(variant);
      if (!key) return;
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key).push(player);
    });
  });
  return index;
};

const parseLineup = text => {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const entries = [];
  let currentRole = null;
  let buffer = [];
  const flush = () => {
    if (!currentRole || !buffer.length) return;
    entries.push({ role: currentRole, name: buffer.join(' ') });
    buffer = [];
  };
  tokens.forEach(token => {
    const upper = token.toUpperCase();
    if (upper === 'CPT' || upper === 'G') {
      flush();
      currentRole = upper;
      return;
    }
    buffer.push(token);
  });
  flush();
  return entries;
};

const buildSolverModel = (variables, constraints, maximizeKey = 'obj') => ({
  optimize: maximizeKey,
  opType: 'max',
  constraints,
  variables,
  binaries: Object.keys(variables).reduce((acc, key) => {
    acc[key] = 1;
    return acc;
  }, {})
});

const solveLineup = (players, options) => {
  const {
    salaryCap,
    lineupSize,
    allowCaptain,
    captainMultiplier = 1.5
  } = options;

  const variables = {};
  const constraints = {
    salary: { max: salaryCap },
    players: { equal: lineupSize }
  };

  if (allowCaptain) {
    constraints.captains = { equal: 1 };
  }

  players.forEach(player => {
    const baseKey = `g_${player.dgId}`;
    variables[baseKey] = {
      obj: player.modelScore,
      salary: player.salary,
      players: 1,
      captains: 0
    };

    if (allowCaptain) {
      const cKey = `c_${player.dgId}`;
      variables[cKey] = {
        obj: player.modelScore * captainMultiplier,
        salary: player.salary * captainMultiplier,
        players: 1,
        captains: 1
      };

      const limitKey = `limit_${player.dgId}`;
      constraints[limitKey] = { max: 1 };
      variables[baseKey][limitKey] = 1;
      variables[cKey][limitKey] = 1;
    }
  });

  const model = buildSolverModel(variables, constraints);
  const solution = solver.Solve(model);
  if (!solution || !solution.feasible) return null;

  const selected = [];
  Object.entries(solution).forEach(([key, value]) => {
    if (value !== 1) return;
    if (!key.startsWith('g_') && !key.startsWith('c_')) return;
    const isCaptain = key.startsWith('c_');
    const dgId = key.replace(/^c_|^g_/, '');
    const player = players.find(p => String(p.dgId) === String(dgId));
    if (!player) return;
    selected.push({ player, isCaptain });
  });

  return selected;
};

const scoreLineup = (entries, playerMap, allowCaptain) => {
  let totalSalary = 0;
  let totalModelScore = 0;
  let totalActualPoints = 0;
  const players = [];

  entries.forEach(entry => {
    const { name, role } = entry;
    const key = normalizeName(name);
    const candidates = playerMap.get(key) || [];
    const player = candidates[0] || null;
    if (!player) {
      players.push({ name, role, matched: false });
      return;
    }

    const isCaptain = allowCaptain && role === 'CPT';
    const multiplier = isCaptain ? 1.5 : 1;
    totalSalary += (player.salary || 0) * multiplier;
    totalModelScore += (player.modelScore || 0) * multiplier;
    totalActualPoints += (player.total_pts || 0) * multiplier;
    players.push({
      name: player.player_name,
      dgId: player.dg_id,
      role,
      salary: player.salary,
      modelScore: player.modelScore,
      actualPoints: player.total_pts,
      matched: true
    });
  });

  return { totalSalary, totalModelScore, totalActualPoints, players };
};

const resolveRankingPath = tournamentSlug => {
  if (!tournamentSlug) return null;
  const dir = path.resolve(DATA_DIR, '2026', tournamentSlug, 'pre_event');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(file => file.endsWith('_pre_event_rankings.json'));
  return files.length ? path.resolve(dir, files[0]) : null;
};

const buildPlayerPool = ({ dfsPointsPath, rankingPath }) => {
  const dfsPayload = readJson(dfsPointsPath);
  const dfsPoints = dfsPayload?.dfs_points || [];
  const rankings = readJson(rankingPath);
  const scoreById = new Map();
  (rankings?.players || []).forEach(player => {
    const dgId = String(player.dgId || '').trim();
    if (!dgId) return;
    const score = Number(player.refinedWeightedScore ?? player.weightedScore ?? player.compositeScore ?? 0);
    scoreById.set(dgId, score);
  });

  return dfsPoints
    .map(entry => ({
      dgId: String(entry.dg_id || '').trim(),
      player_name: entry.player_name,
      salary: Number(entry.salary || 0),
      total_pts: Number(entry.total_pts || 0),
      modelScore: scoreById.get(String(entry.dg_id || '').trim()) ?? 0
    }))
    .filter(entry => entry.dgId && Number.isFinite(entry.salary) && entry.salary > 0);
};

const resolveContestType = ({ contestKey, lineupText }) => {
  const contestPayload = readJson(path.resolve(CONTESTS_DK_DIR, `${contestKey}.json`));
  const contestName = contestPayload?.contestDetail?.contestSummary?.name
    || contestPayload?.contestDetail?.name
    || '';
  const nameLower = String(contestName).toLowerCase();
  if (nameLower.includes('captain')) return 'captain';
  if (String(lineupText || '').toUpperCase().includes('CPT')) return 'captain';
  return 'showdown';
};

const CONTESTS = [
  {
    contestKey: '188737443',
    eventId: '11',
    tournamentSlug: 'the-players',
    entryIds: ['5086744177']
  },
  {
    contestKey: '188795036',
    eventId: '11',
    tournamentSlug: 'the-players',
    entryIds: ['5087360618']
  },
  {
    contestKey: '188825631',
    eventId: '11',
    tournamentSlug: 'the-players',
    entryIds: ['5088338354']
  },
  {
    contestKey: '188852941',
    eventId: '11',
    tournamentSlug: 'the-players',
    entryIds: ['5089231278', '5089242429']
  },
  {
    contestKey: '188852942',
    eventId: '11',
    tournamentSlug: 'the-players',
    entryIds: ['5089243978']
  }
];

const main = () => {
  ensureDir(OUTPUT_DIR);
  const summaries = [];

  CONTESTS.forEach(contest => {
    const csvPath = path.resolve(ODDS_DK_DIR, `contest-standings-${contest.contestKey}.csv`);
    if (!fs.existsSync(csvPath)) {
      console.warn(`⚠️ Missing standings CSV for contest ${contest.contestKey}`);
      return;
    }

    const dfsPointsPath = path.resolve(ODDS_DK_DIR, `${contest.eventId}.json`);
    if (!fs.existsSync(dfsPointsPath)) {
      console.warn(`⚠️ Missing DFS points file ${dfsPointsPath}`);
      return;
    }

    const rankingPath = resolveRankingPath(contest.tournamentSlug);
    if (!rankingPath) {
      console.warn(`⚠️ Missing ranking file for ${contest.tournamentSlug}`);
      return;
    }

    const pool = buildPlayerPool({ dfsPointsPath, rankingPath });
    const playerMap = buildNameIndex(pool);
    const standings = readCsv(csvPath);
    const entryIdSet = new Set((contest.entryIds || []).map(id => String(id)));
    const entryRows = standings.filter(row => entryIdSet.has(String(row.EntryId || row.EntryID || row.entryId || '').trim()));

    if (!entryRows.length) {
      console.warn(`⚠️ Entry not found in ${csvPath} for contest ${contest.contestKey}`);
    }

    entryRows.forEach(entryRow => {
      const lineupText = entryRow.Lineup || entryRow.lineup || '';
      const contestType = resolveContestType({ contestKey: contest.contestKey, lineupText });
      const allowCaptain = contestType === 'captain';
      const parsed = parseLineup(lineupText);
      const scored = scoreLineup(parsed, playerMap, allowCaptain);

      const optimal = solveLineup(pool, {
        salaryCap: 50000,
        lineupSize: 6,
        allowCaptain,
        captainMultiplier: 1.5
      });

      let optimalSummary = null;
      if (optimal) {
        const entries = optimal.map(entry => ({
          role: entry.isCaptain ? 'CPT' : 'G',
          name: entry.player.player_name
        }));
        optimalSummary = scoreLineup(entries, playerMap, allowCaptain);
      }

      const summary = {
        contestKey: contest.contestKey,
        contestType,
        eventId: contest.eventId,
        tournamentSlug: contest.tournamentSlug,
        entryId: entryRow.EntryId || '',
        entryName: entryRow.EntryName || '',
        entryRank: entryRow.Rank || '',
        entryPoints: entryRow.Points || '',
        entryLineup: lineupText,
        entryTotalSalary: scored.totalSalary,
        entryModelScore: scored.totalModelScore,
        entryActualPoints: scored.totalActualPoints,
        optimalTotalSalary: optimalSummary?.totalSalary ?? null,
        optimalModelScore: optimalSummary?.totalModelScore ?? null,
        optimalActualPoints: optimalSummary?.totalActualPoints ?? null,
        unmatchedPlayers: scored.players.filter(player => !player.matched).map(player => player.name)
      };

      summaries.push(summary);

      const detailPath = path.resolve(OUTPUT_DIR, `contest_${contest.contestKey}_entry_${summary.entryId}.json`);
      writeJson(detailPath, {
        summary,
        entryPlayers: scored.players,
        optimalPlayers: optimalSummary?.players || []
      });
    });
  });

  if (!summaries.length) {
    console.warn('⚠️ No contest summaries generated.');
    return;
  }

  const summaryPath = path.resolve(OUTPUT_DIR, 'dk_contest_lineup_evaluations.json');
  writeJson(summaryPath, { generatedAt: new Date().toISOString(), summaries });

  const csvHeaders = [
    'contestKey',
    'contestType',
    'eventId',
    'tournamentSlug',
    'entryId',
    'entryName',
    'entryRank',
    'entryPoints',
    'entryTotalSalary',
    'entryModelScore',
    'entryActualPoints',
    'optimalTotalSalary',
    'optimalModelScore',
    'optimalActualPoints',
    'unmatchedPlayers'
  ];

  const csvRows = summaries.map(summary => ({
    ...summary,
    unmatchedPlayers: (summary.unmatchedPlayers || []).join('|')
  }));

  const csvPath = path.resolve(OUTPUT_DIR, 'dk_contest_lineup_evaluations.csv');
  writeCsv(csvPath, csvRows, csvHeaders);

  console.log(`✓ Wrote ${summaries.length} lineup evaluations to ${summaryPath}`);
  console.log(`✓ CSV saved to ${csvPath}`);
};

main();
