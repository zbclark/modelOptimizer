const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { spawnSync } = require('child_process');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const ODDS_ARCHIVE_DIR = path.resolve(DATA_DIR, 'wagering', 'odds_archive');
const DFS_ARCHIVE_DIR = path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'draftkings');

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
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const runNodeScript = (scriptPath, args, label) => {
  const result = spawnSync('node', [scriptPath, ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    console.warn(`⚠️  ${label} failed (continuing).`);
    return false;
  }
  return true;
};

const resolveOutrightsPath = ({ tour, year, market, book, eventId }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeYear = String(year || '').trim();
  const safeMarket = String(market || 'win').trim().toLowerCase() || 'win';
  const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
  const safeEventId = String(eventId || '').trim();
  return path.resolve(ODDS_ARCHIVE_DIR, 'outrights', safeTour, safeYear, safeMarket, safeEventId, `${safeBook}.json`);
};

const resolveMatchupsPath = ({ tour, year, book, eventId }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeYear = String(year || '').trim();
  const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
  const safeEventId = String(eventId || '').trim();
  return path.resolve(ODDS_ARCHIVE_DIR, 'matchups', safeTour, safeYear, safeEventId, `${safeBook}.json`);
};

const resolveEventListPath = ({ tour, year }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const label = year ? String(year).trim() : 'all';
  return path.resolve(ODDS_ARCHIVE_DIR, 'event_list', safeTour, `event_list_${label}.json`);
};

const resolveDfsPointsPath = ({ eventId }) => {
  const safeEventId = String(eventId || '').trim();
  return path.resolve(DFS_ARCHIVE_DIR, `${safeEventId}.json`);
};

const parseList = (value, fallback = []) => {
  if (!value && value !== '') return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  return raw.split(',').map(item => item.trim()).filter(Boolean);
};

const normalizeBook = value => {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    bet265: 'bet365',
    casears: 'caesars',
    caesars: 'caesars'
  };
  return aliases[raw] || raw;
};

const resolveYears = ({ args, season, includeCurrentYear = false }) => {
  if (args.years || args.years === '') {
    const years = parseList(args.years, []);
    if (includeCurrentYear) {
      return years;
    }
    return years.filter(year => year !== String(season));
  }
  const fromYear = args.fromYear ? Number(args.fromYear) : null;
  const toYear = args.toYear ? Number(args.toYear) : null;
  if (Number.isFinite(fromYear) && Number.isFinite(toYear)) {
    const years = [];
    for (let y = fromYear; y <= toYear; y += 1) {
      years.push(String(y));
    }
    if (includeCurrentYear) {
      return years;
    }
    return years.filter(year => year !== String(season));
  }
  const entries = fs.readdirSync(DATA_DIR)
    .filter(name => /^\d{4}$/.test(name))
    .sort();
  if (includeCurrentYear) {
    return entries;
  }
  return entries.filter(year => year !== String(season));
};

const main = async () => {
  const args = parseArgs();
  const tour = String(args.tour || 'pga').trim().toLowerCase() || 'pga';
  const season = args.season ? String(args.season).trim() : null;
  const manifestSeason = args.manifestSeason || args.manifest_season || season;
  const oddsFormat = args.oddsFormat || args.odds_format || 'decimal';
  const fileFormat = args.fileFormat || args.file_format || 'json';
  const sleepMs = args.sleepMs ? Math.max(0, Number(args.sleepMs)) : 0;
  const eventPauseMs = args.eventPauseMs ? Math.max(0, Number(args.eventPauseMs)) : 0;
  const includeMatchups = args.includeMatchups !== false && args.includeMatchups !== 'false';
  const includeEventList = args.includeEventList || args.include_event_list || false;
  const force = args.force || false;
  const limitEvents = args.limitEvents ? Number(args.limitEvents) : null;
  const maxCallsPerEvent = args.maxCallsPerEvent ? Number(args.maxCallsPerEvent) : 45;
  const includeCurrentYear = args.includeCurrentYear || args.include_current_year || false;
  const includeDfsPoints = args.includeDfsPoints !== false && args.includeDfsPoints !== 'false';
  const dfsSite = String(args.dfsSite || args.dfs_site || 'draftkings').trim().toLowerCase() || 'draftkings';
  const eventIdFilter = new Set(parseList(args.eventIds || args.event_ids, []));
  const eventOrder = String(args.eventOrder || args.event_order || 'asc').trim().toLowerCase();
  const startEventId = args.startEventId || args.start_event_id || args.startEvent || null;

  const outrightsMarkets = parseList(args.markets, [
    'win',
    'top_5',
    'top_10',
    'top_20',
    'make_cut',
    'mc'
  ]);

  const booksOutrights = parseList(args.booksOutrights || args.books_outrights, [
    'bet365',
    'betcris',
    'betmgm',
    'betonline',
    'betway',
    'bovada',
    'caesars',
    'corale',
    'circa',
    'draftkings',
    'fanduel',
    'pinnacle',
    'skybet',
    'sportsbook',
    'unibet',
    'williamhill'
  ]).map(normalizeBook);

  const booksMatchups = parseList(args.booksMatchups || args.books_matchups, [
    '5dimes',
    'bet365',
    'betcris',
    'betmgm',
    'betonline',
    'bovada',
    'caesars',
    'circa',
    'draftkings',
    'fanduel',
    'pinnacle',
    'sportsbook',
    'williamhill',
    'unibet'
  ]).map(normalizeBook);

  if (!manifestSeason) {
    console.error('❌ Missing --season or --manifestSeason to locate manifest.json.');
    process.exit(1);
  }

  const years = resolveYears({ args, season: manifestSeason, includeCurrentYear: Boolean(includeCurrentYear) });
  if (!years.length) {
    console.error('❌ No historical years found to cache.');
    process.exit(1);
  }

  const manifestPath = path.resolve(DATA_DIR, String(manifestSeason), 'manifest.json');
  const manifest = readJson(manifestPath) || [];
  if (!manifest.length) {
    console.error(`❌ No manifest entries found for ${manifestSeason}.`);
    process.exit(1);
  }

  let totalPlanned = 0;
  let totalFetched = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  if (includeEventList) {
    const eventListPath = resolveEventListPath({ tour, year: 'all' });
    if (!force && fs.existsSync(eventListPath)) {
      totalSkipped += 1;
      console.log(`↪ Skipping event list (exists): ${eventListPath}`);
    } else {
      totalPlanned += 1;
      const ok = runNodeScript(path.resolve(__dirname, 'fetch_historical_odds.js'), [
        '--type', 'event-list',
        '--tour', tour,
        '--fileFormat', String(fileFormat)
      ], 'fetch_historical_odds (event-list)');
      if (ok) totalFetched += 1;
      else totalFailed += 1;
      if (sleepMs) await sleep(sleepMs);
    }
  }

  let events = manifest;
  if (eventIdFilter.size > 0) {
    events = events.filter(entry => eventIdFilter.has(String(entry.eventId)));
  }
  events = [...events].sort((a, b) => {
    const aTime = Date.parse(a.date || '') || 0;
    const bTime = Date.parse(b.date || '') || 0;
    return aTime - bTime;
  });
  if (eventOrder === 'desc') {
    events.reverse();
  }
  if (startEventId) {
    const startIndex = events.findIndex(entry => String(entry.eventId) === String(startEventId));
    if (startIndex >= 0) {
      events = events.slice(startIndex);
    } else {
      console.warn(`⚠️  startEventId ${startEventId} not found in manifest ordering. Proceeding without trimming.`);
    }
  }
  if (Number.isFinite(limitEvents) && limitEvents > 0) {
    events = events.slice(0, limitEvents);
  }

  const callsPerEvent = (outrightsMarkets.length * booksOutrights.length)
    + (includeMatchups ? booksMatchups.length : 0)
    + (includeDfsPoints ? 1 : 0);

  console.log(`ℹ️  Estimated API calls per event: ${callsPerEvent}`);
  if (Number.isFinite(maxCallsPerEvent) && callsPerEvent > maxCallsPerEvent) {
    console.error(`❌ Calls per event (${callsPerEvent}) exceed max (${maxCallsPerEvent}). Reduce books/markets or raise --maxCallsPerEvent.`);
    process.exit(1);
  }

  for (const year of years) {
    for (const event of events) {
      const eventId = event.eventId;
      if (!eventId) continue;

      for (const market of outrightsMarkets) {
        for (const book of booksOutrights) {
          const outputPath = resolveOutrightsPath({ tour, year, market, book, eventId });
          if (!force && fs.existsSync(outputPath)) {
            totalSkipped += 1;
            continue;
          }
          totalPlanned += 1;
          const ok = runNodeScript(path.resolve(__dirname, 'fetch_historical_odds.js'), [
            '--type', 'outrights',
            '--tour', tour,
            '--year', String(year),
            '--eventId', String(eventId),
            '--market', String(market),
            '--book', String(book),
            '--oddsFormat', String(oddsFormat),
            '--fileFormat', String(fileFormat)
          ], `fetch_historical_odds (outrights ${year} ${eventId} ${market} ${book})`);
          if (ok) totalFetched += 1;
          else totalFailed += 1;
          if (sleepMs) await sleep(sleepMs);
        }
      }

      if (includeMatchups) {
        for (const book of booksMatchups) {
          const outputPath = resolveMatchupsPath({ tour, year, book, eventId });
          if (!force && fs.existsSync(outputPath)) {
            totalSkipped += 1;
            continue;
          }
          totalPlanned += 1;
          const ok = runNodeScript(path.resolve(__dirname, 'fetch_historical_odds.js'), [
            '--type', 'matchups',
            '--tour', tour,
            '--year', String(year),
            '--eventId', String(eventId),
            '--book', String(book),
            '--oddsFormat', String(oddsFormat),
            '--fileFormat', String(fileFormat)
          ], `fetch_historical_odds (matchups ${year} ${eventId} ${book})`);
          if (ok) totalFetched += 1;
          else totalFailed += 1;
          if (sleepMs) await sleep(sleepMs);
        }
      }

      if (includeDfsPoints) {
        const outputPath = resolveDfsPointsPath({ eventId });
        if (!force && fs.existsSync(outputPath)) {
          totalSkipped += 1;
        } else {
          totalPlanned += 1;
          const ok = runNodeScript(path.resolve(__dirname, 'fetch_historical_dfs_points.js'), [
            '--tour', tour,
            '--site', dfsSite,
            '--year', String(year),
            '--eventId', String(eventId),
            '--fileFormat', String(fileFormat)
          ], `fetch_historical_dfs_points (${year} ${eventId})`);
          if (ok) totalFetched += 1;
          else totalFailed += 1;
          if (sleepMs) await sleep(sleepMs);
        }
      }

      if (eventPauseMs) {
        await sleep(eventPauseMs);
      }
    }
  }

  console.log('✓ Historical odds caching complete.');
  console.log(`  Planned: ${totalPlanned}`);
  console.log(`  Fetched: ${totalFetched}`);
  console.log(`  Skipped: ${totalSkipped}`);
  console.log(`  Failed: ${totalFailed}`);
};

main().catch(error => {
  console.error(`❌ Cache run failed: ${error.message}`);
  process.exit(1);
});
