const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { getDataGolfHistoricalDfsPoints } = require('../utilities/dataGolfClient');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const CACHE_DIR = path.resolve(DATA_DIR, 'cache');
const DFS_ARCHIVE_DIR = path.resolve(DATA_DIR, 'odds_archive', 'draftkings');

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

const resolveDfsPointsPath = ({ eventId }) => {
  const safeEventId = String(eventId || '').trim();
  return path.resolve(DFS_ARCHIVE_DIR, `${safeEventId}.json`);
};

const main = async () => {
  const args = parseArgs();
  const tour = String(args.tour || 'pga').trim().toLowerCase() || 'pga';
  const site = String(args.site || 'draftkings').trim().toLowerCase() || 'draftkings';
  const eventId = args.eventId || args.event || null;
  const year = args.year ? String(args.year).trim() : null;
  const fileFormat = args.fileFormat || args.file_format || 'json';
  const ttlHours = args.ttlHours ? parseFloat(String(args.ttlHours).trim()) : 24;
  const ttlMs = Number.isNaN(ttlHours) ? 24 * 60 * 60 * 1000 : Math.max(0, ttlHours) * 60 * 60 * 1000;

  const apiKey = String(process.env.DATAGOLF_API_KEY || '').trim();
  if (!apiKey) {
    console.error('❌ DATAGOLF_API_KEY is not set. Add it to your local .env file.');
    process.exit(1);
  }

  if (!eventId) {
    console.error('❌ Missing --eventId for DFS points fetch.');
    process.exit(1);
  }
  if (!year) {
    console.error('❌ Missing --year for DFS points fetch.');
    process.exit(1);
  }

  const snapshot = await getDataGolfHistoricalDfsPoints({
    apiKey,
    cacheDir: CACHE_DIR,
    ttlMs,
    allowStale: true,
    tour,
    site,
    eventId,
    year,
    fileFormat
  });

  if (!snapshot?.payload) {
    console.error('❌ DFS points payload not available.');
    process.exit(1);
  }

  const outputPath = resolveDfsPointsPath({ tour, year, site, eventId });
  writeJson(outputPath, snapshot.payload);
  console.log(`✓ DFS points/salaries saved to ${outputPath} (source: ${snapshot.source})`);
};

main().catch(error => {
  console.error(`❌ Fetch failed: ${error.message}`);
  process.exit(1);
});
