const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { getDataGolfLiveOutrights } = require('../utilities/dataGolfClient');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const CACHE_DIR = path.resolve(DATA_DIR, 'cache');
const ODDS_LIVE_DIR = path.resolve(DATA_DIR, 'odds_live');

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

const resolveLiveOutrightsPath = ({ tour, market }) => {
  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeMarket = String(market || 'win').trim().toLowerCase() || 'win';
  return path.resolve(ODDS_LIVE_DIR, 'outrights', safeTour, safeMarket, 'latest.json');
};

const main = async () => {
  const args = parseArgs();
  const tour = String(args.tour || 'pga').trim().toLowerCase() || 'pga';
  const market = String(args.market || 'win').trim().toLowerCase() || 'win';
  const oddsFormat = args.oddsFormat || args.odds_format || 'decimal';
  const fileFormat = args.fileFormat || args.file_format || 'json';
  const ttlHours = args.ttlHours ? parseFloat(String(args.ttlHours).trim()) : 2;
  const ttlMs = Number.isNaN(ttlHours) ? 2 * 60 * 60 * 1000 : Math.max(0, ttlHours) * 60 * 60 * 1000;

  const apiKey = String(process.env.DATAGOLF_API_KEY || '').trim();
  if (!apiKey) {
    console.error('❌ DATAGOLF_API_KEY is not set. Add it to your local .env file.');
    process.exit(1);
  }

  const snapshot = await getDataGolfLiveOutrights({
    apiKey,
    cacheDir: CACHE_DIR,
    ttlMs,
    allowStale: true,
    tour,
    market,
    oddsFormat,
    fileFormat
  });

  if (!snapshot?.payload) {
    console.error('❌ Live outrights payload not available.');
    process.exit(1);
  }

  const outputPath = resolveLiveOutrightsPath({ tour, market });
  writeJson(outputPath, snapshot.payload);
  console.log(`✓ Live outrights saved to ${outputPath} (source: ${snapshot.source})`);
};

main().catch(error => {
  console.error(`❌ Fetch failed: ${error.message}`);
  process.exit(1);
});
