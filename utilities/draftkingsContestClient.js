const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://api.draftkings.com/contests/v1/contests';
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const CONTESTS_DIR = path.resolve(DATA_DIR, 'contests', 'draftkings');

const ensureDir = dirPath => {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const readJson = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
};

const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
};

const fetchContest = async ({ contestId, baseUrl = DEFAULT_BASE_URL }) => {
  if (!contestId) throw new Error('contestId is required');
  const url = `${baseUrl}/${encodeURIComponent(String(contestId))}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DraftKings contest fetch failed (${response.status}): ${text}`);
  }
  return response.json();
};

const fetchContestWithCache = async ({ contestId, baseUrl, force = false }) => {
  const filePath = path.resolve(CONTESTS_DIR, `${contestId}.json`);
  if (!force) {
    const cached = readJson(filePath);
    if (cached) return { payload: cached, filePath, cached: true };
  }
  const payload = await fetchContest({ contestId, baseUrl });
  writeJson(filePath, payload);
  return { payload, filePath, cached: false };
};

module.exports = {
  DEFAULT_BASE_URL,
  CONTESTS_DIR,
  fetchContest,
  fetchContestWithCache
};
