const fs = require('fs');
const path = require('path');
const solver = require('javascript-lp-solver');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const OUTPUT_DIR = path.resolve(DATA_DIR, 'wagering', 'contests', 'draftkings', 'evaluations');

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
      name: entry.player_name,
      salary: Number(entry.salary || 0),
      actualPoints: Number(entry.total_pts || 0),
      modelScore: scoreById.get(String(entry.dg_id || '').trim()) ?? 0
    }))
    .filter(entry => entry.dgId && Number.isFinite(entry.salary) && entry.salary > 0);
};

const buildSolverModel = (players, salaryCap, lineupSize) => {
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

  players.forEach(player => {
    const key = `dg_${player.dgId}`;
    model.variables[key] = {
      obj: player.modelScore,
      salary: player.salary,
      players: 1
    };
    model.binaries[key] = 1;
  });

  return model;
};

const extractLineup = (solution, players) => {
  const selected = players.filter(player => solution[`dg_${player.dgId}`] === 1);
  const totalSalary = selected.reduce((sum, p) => sum + p.salary, 0);
  const totalModelScore = selected.reduce((sum, p) => sum + p.modelScore, 0);
  const totalActualPoints = selected.reduce((sum, p) => sum + p.actualPoints, 0);
  return {
    players: selected,
    totalSalary,
    totalModelScore,
    totalActualPoints
  };
};

const addExcludeConstraint = (model, lineup, index, lineupSize) => {
  const constraintName = `exclude_${index}`;
  model.constraints[constraintName] = { max: lineupSize - 1 };
  lineup.players.forEach(player => {
    const key = `dg_${player.dgId}`;
    if (!model.variables[key]) return;
    model.variables[key][constraintName] = 1;
  });
};

const main = () => {
  const eventId = '9';
  const tournamentSlug = 'arnold-palmer-invitational';
  const salaryCap = 50000;
  const lineupSize = 6;
  const topN = 20;

  const dfsPointsPath = path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'draftkings', `${eventId}.json`);
  if (!fs.existsSync(dfsPointsPath)) {
    console.error(`❌ Missing DFS points file: ${dfsPointsPath}`);
    process.exit(1);
  }

  const rankingPath = resolveRankingPath(tournamentSlug);
  if (!rankingPath) {
    console.error(`❌ Missing ranking file for ${tournamentSlug}`);
    process.exit(1);
  }

  const playerPool = buildPlayerPool({ dfsPointsPath, rankingPath });
  if (!playerPool.length) {
    console.error('❌ No player pool available.');
    process.exit(1);
  }

  const model = buildSolverModel(playerPool, salaryCap, lineupSize);
  const lineups = [];

  for (let i = 0; i < topN; i += 1) {
    const solution = solver.Solve(model);
    if (!solution || !solution.feasible) break;
    const lineup = extractLineup(solution, playerPool);
    if (!lineup.players.length) break;
    lineups.push({ rank: i + 1, ...lineup });
    addExcludeConstraint(model, lineup, i + 1, lineupSize);
  }

  if (!lineups.length) {
    console.error('❌ No feasible lineups found.');
    process.exit(1);
  }

  const outputPayload = {
    generatedAt: new Date().toISOString(),
    eventId,
    tournamentSlug,
    salaryCap,
    lineupSize,
    topN,
    lineups: lineups.map(lineup => ({
      rank: lineup.rank,
      totalSalary: lineup.totalSalary,
      totalModelScore: lineup.totalModelScore,
      totalActualPoints: lineup.totalActualPoints,
      players: lineup.players.map(player => ({
        dgId: player.dgId,
        name: player.name,
        salary: player.salary,
        modelScore: player.modelScore,
        actualPoints: player.actualPoints
      }))
    }))
  };

  const outputJson = path.resolve(OUTPUT_DIR, `arnold_palmer_top_${topN}_model_lineups.json`);
  writeJson(outputJson, outputPayload);

  const csvRows = lineups.map(lineup => {
    const base = {
      rank: lineup.rank,
      total_salary: lineup.totalSalary,
      total_model_score: lineup.totalModelScore,
      total_actual_points: lineup.totalActualPoints
    };
    lineup.players.forEach((player, idx) => {
      base[`p${idx + 1}_name`] = player.name;
      base[`p${idx + 1}_dgid`] = player.dgId;
      base[`p${idx + 1}_salary`] = player.salary;
      base[`p${idx + 1}_model`] = player.modelScore;
      base[`p${idx + 1}_actual`] = player.actualPoints;
    });
    return base;
  });

  const headers = Object.keys(csvRows[0] || {});
  const outputCsv = path.resolve(OUTPUT_DIR, `arnold_palmer_top_${topN}_model_lineups.csv`);
  writeCsv(outputCsv, csvRows, headers);

  console.log(`✓ Wrote ${lineups.length} lineups to ${outputJson}`);
  console.log(`✓ CSV saved to ${outputCsv}`);
};

main();
