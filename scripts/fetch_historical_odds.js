const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const {
  getDataGolfHistoricalOddsEventList,
  getDataGolfHistoricalOddsOutrights,
  getDataGolfHistoricalOddsMatchups
} = require('../utilities/dataGolfClient');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const CACHE_DIR = path.resolve(DATA_DIR, 'cache');
const ODDS_ARCHIVE_DIR = path.resolve(DATA_DIR, 'odds_archive');

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

const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
};

const resolveEventListPath = ({ tour, year }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const label = year ? String(year).trim() : 'all';
  return path.resolve(ODDS_ARCHIVE_DIR, 'event_list', safeTour, `event_list_${label}.json`);
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

const main = async () => {
  const args = parseArgs();
  const type = String(args.type || '').trim().toLowerCase();
  const tour = String(args.tour || 'pga').trim().toLowerCase() || 'pga';
  const year = args.year ? String(args.year).trim() : null;
  const rawEventId = args.eventId || args.event || null;
  const normalizedEventId = rawEventId !== null && rawEventId !== undefined
    ? String(rawEventId).trim()
    : '';
  const eventId = normalizedEventId && !['undefined', 'null'].includes(normalizedEventId.toLowerCase())
    ? normalizedEventId
    : null;
  const market = args.market || 'win';
  const book = args.book || 'draftkings';
  const oddsFormat = args.oddsFormat || args.odds_format || 'decimal';
  const fileFormat = args.fileFormat || args.file_format || 'json';
  const ttlHours = args.ttlHours ? parseFloat(String(args.ttlHours).trim()) : 24;
  const ttlMs = Number.isNaN(ttlHours) ? 24 * 60 * 60 * 1000 : Math.max(0, ttlHours) * 60 * 60 * 1000;

  const apiKey = String(process.env.DATAGOLF_API_KEY || '').trim();
  if (!apiKey) {
    console.error('❌ DATAGOLF_API_KEY is not set. Add it to your local .env file.');
    process.exit(1);
  }

  if (!type || !['event-list', 'outrights', 'matchups'].includes(type)) {
    console.error('❌ Missing or invalid --type. Use one of: event-list, outrights, matchups');
    process.exit(1);
  }

  if (type === 'event-list') {
    const snapshot = await getDataGolfHistoricalOddsEventList({
      apiKey,
      cacheDir: CACHE_DIR,
      ttlMs,
      allowStale: true,
      tour,
      fileFormat
    });

    if (!snapshot?.payload) {
      console.error('❌ Event list payload not available.');
      process.exit(1);
    }

    const outputPath = resolveEventListPath({ tour, year });
    writeJson(outputPath, snapshot.payload);
    console.log(`✓ Event list saved to ${outputPath} (source: ${snapshot.source})`);
    return;
  }

  if (!eventId) {
    console.error('❌ Missing --eventId for odds fetch.');
    process.exit(1);
  }
  if (!year) {
    console.error('❌ Missing --year for odds fetch.');
    process.exit(1);
  }

  if (type === 'outrights') {
    const snapshot = await getDataGolfHistoricalOddsOutrights({
      apiKey,
      cacheDir: CACHE_DIR,
      ttlMs,
      allowStale: true,
      tour,
      eventId,
      year,
      market,
      book,
      oddsFormat,
      fileFormat
    });

    if (!snapshot?.payload) {
      console.error('❌ Outrights payload not available.');
      process.exit(1);
    }

    const outputPath = resolveOutrightsPath({ tour, year, market, book, eventId });
    writeJson(outputPath, snapshot.payload);
    console.log(`✓ Outrights saved to ${outputPath} (source: ${snapshot.source})`);
    return;
  }

  if (type === 'matchups') {
    const snapshot = await getDataGolfHistoricalOddsMatchups({
      apiKey,
      cacheDir: CACHE_DIR,
      ttlMs,
      allowStale: true,
      tour,
      eventId,
      year,
      book,
      oddsFormat,
      fileFormat
    });

    if (!snapshot?.payload) {
      console.error('❌ Matchups payload not available.');
      process.exit(1);
    }

    const outputPath = resolveMatchupsPath({ tour, year, book, eventId });
    writeJson(outputPath, snapshot.payload);
    console.log(`✓ Matchups saved to ${outputPath} (source: ${snapshot.source})`);
  }
};

main().catch(error => {
  console.error(`❌ Fetch failed: ${error.message}`);
  process.exit(1);
});
