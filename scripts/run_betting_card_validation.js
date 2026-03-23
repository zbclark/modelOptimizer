const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const VALIDATION_DIR = path.resolve(DATA_DIR, 'wagering', 'validation');
const BETTING_CARD_PATH = path.resolve(DATA_DIR, 'wagering', 'betting-card.csv');

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

const ensureDir = dirPath => {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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

const toNumber = value => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeBetRow = row => ({
  season: row.season || '',
  eventId: row.event || row.event_id || '',
  market: row.market || '',
  book: row.book || '',
  player: row.player || '',
  dgId: row.dg_id || row.dgId || '',
  odds: row.odds || '',
  stake: row.stake || '',
  settledStake: row['settled stake'] || row.settled_stake || row.settledStake || '',
  totalReturn: row['total return'] || row.total_return || row.totalReturn || '',
  net: row.net || '',
  roi: row.roi || ''
});

const computeBetStats = bet => {
  const stakeValue = toNumber(bet.settledStake) ?? toNumber(bet.stake) ?? 0;
  const totalReturn = toNumber(bet.totalReturn);
  const netValue = toNumber(bet.net);
  const profit = Number.isFinite(netValue)
    ? netValue
    : Number.isFinite(totalReturn)
      ? totalReturn - stakeValue
      : 0;
  const won = Number.isFinite(netValue)
    ? netValue > 0
    : Number.isFinite(totalReturn)
      ? totalReturn > stakeValue
      : 0;
  return {
    stakeValue,
    profit,
    won: won ? 1 : 0
  };
};

const main = () => {
  const args = parseArgs();
  const seasonArg = args.season ? String(args.season).trim() : '';
  const outputTag = args.outputTag ? String(args.outputTag).trim() : 'betting_card_validation';
  const inputPath = args.inputPath ? path.resolve(args.inputPath) : BETTING_CARD_PATH;

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Betting card not found at ${inputPath}`);
    process.exit(1);
  }

  const rows = readCsv(inputPath).map(normalizeBetRow);
  const filtered = seasonArg
    ? rows.filter(row => String(row.season || '').trim() === seasonArg)
    : rows;

  if (!filtered.length) {
    console.error('❌ No betting card rows found for the requested season.');
    process.exit(1);
  }

  const betsPlaced = filtered.map(bet => {
    const stats = computeBetStats(bet);
    return {
      season: bet.season,
      eventId: bet.eventId,
      market: bet.market,
      book: bet.book,
      dgId: bet.dgId,
      playerName: bet.player,
      odds: bet.odds,
      stake: bet.stake,
      settledStake: bet.settledStake,
      totalReturn: bet.totalReturn,
      net: bet.net,
      roi: bet.roi,
      won: stats.won,
      profit: stats.profit
    };
  });

  const summaries = new Map();
  betsPlaced.forEach(bet => {
    const key = `${bet.eventId || ''}||${bet.market || ''}||${bet.book || ''}`;
    const current = summaries.get(key) || {
      season: seasonArg || bet.season || '',
      eventId: bet.eventId || '',
      market: bet.market || '',
      book: bet.book || '',
      bets: 0,
      wins: 0,
      stake: 0,
      profit: 0
    };
    const stakeValue = toNumber(bet.settledStake) ?? toNumber(bet.stake) ?? 0;
    current.bets += 1;
    current.wins += bet.won ? 1 : 0;
    current.stake += stakeValue;
    current.profit += Number.isFinite(bet.profit) ? bet.profit : 0;
    summaries.set(key, current);
  });

  const summaryRows = Array.from(summaries.values()).map(entry => ({
    ...entry,
    hitRate: entry.bets ? entry.wins / entry.bets : 0,
    roi: entry.stake ? entry.profit / entry.stake : 0
  }));

  const totalsByMarketBook = new Map();
  summaryRows.forEach(row => {
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
  betsPlaced.forEach(bet => {
    const key = String(bet.eventId || '').trim() || 'unknown';
    const current = eventTotals.get(key) || { eventId: key, bets: 0, wins: 0, stake: 0, profit: 0 };
    const stakeValue = toNumber(bet.settledStake) ?? toNumber(bet.stake) ?? 0;
    current.bets += 1;
    current.wins += bet.won ? 1 : 0;
    current.stake += stakeValue;
    current.profit += Number.isFinite(bet.profit) ? bet.profit : 0;
    eventTotals.set(key, current);
  });

  const eventRows = Array.from(eventTotals.values())
    .map(entry => ({
      ...entry,
      hitRate: entry.bets ? entry.wins / entry.bets : 0,
      roi: entry.stake ? entry.profit / entry.stake : 0
    }))
    .sort((a, b) => b.roi - a.roi);

  const payload = {
    generatedAt: new Date().toISOString(),
    season: seasonArg || null,
    inputPath,
    summaryRows,
    totalsByMarketBook: totals,
    eventRows,
    betsPlaced
  };

  ensureDir(VALIDATION_DIR);
  const baseName = `${outputTag}_${seasonArg || 'all'}`;
  const jsonPath = path.resolve(VALIDATION_DIR, `${baseName}.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  const summaryHeaders = ['season', 'eventId', 'market', 'book', 'bets', 'wins', 'stake', 'profit', 'roi', 'hitRate'];
  fs.writeFileSync(
    path.resolve(VALIDATION_DIR, `${baseName}.csv`),
    buildCsv(summaryRows, summaryHeaders)
  );

  const betHeaders = ['season', 'eventId', 'market', 'book', 'dgId', 'playerName', 'odds', 'stake', 'settledStake', 'totalReturn', 'net', 'roi', 'won', 'profit'];
  fs.writeFileSync(
    path.resolve(VALIDATION_DIR, `${baseName}_bets.csv`),
    buildCsv(betsPlaced, betHeaders)
  );

  const md = [];
  md.push(`# Betting Card Validation Summary (${seasonArg || 'all'})`);
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
  md.push('## Overall Rollup (All Bets)');
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

  if (eventRows.length) {
    md.push('');
    md.push('## Per-Event Hit Rate and ROI');
    md.push('');
    md.push('| Event ID | Bets | Wins | Stake | Profit | ROI | Hit Rate |');
    md.push('| --- | --- | --- | --- | --- | --- | --- |');
    eventRows.forEach(entry => {
      md.push(`| ${entry.eventId} | ${entry.bets} | ${entry.wins} | ${entry.stake.toFixed(4)} | ${entry.profit.toFixed(4)} | ${entry.roi.toFixed(4)} | ${entry.hitRate.toFixed(4)} |`);
    });
  }

  fs.writeFileSync(path.resolve(VALIDATION_DIR, `${baseName}.md`), `${md.join('\n')}\n`);

  console.log(`✓ Betting card validation saved to ${jsonPath}`);
};

main();
