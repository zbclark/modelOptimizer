const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 2000;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  if (!filePath) return;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
};

const isFresh = (filePath, ttlMs) => {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const stats = fs.statSync(filePath);
    return Date.now() - stats.mtimeMs < ttlMs;
  } catch (error) {
    return false;
  }
};

const fetchJsonWithRetry = async (url, options = {}) => {
  const {
    retries = DEFAULT_RETRIES,
    backoffMs = DEFAULT_BACKOFF_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = options;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`HTTP ${response.status}: ${text}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      const isLastAttempt = attempt >= retries;
      const status = error.status || 0;
      const retryable = status === 429 || status >= 500 || error.name === 'AbortError';
      if (isLastAttempt || !retryable) {
        throw error;
      }
      await sleep(backoffMs * Math.pow(2, attempt));
    }
  }
  return null;
};

const slugify = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 120);

const getMeteoblueLocation = async (options = {}) => {
  const {
    apiKey,
    query,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    forceRefresh = false
  } = options;

  const safeQuery = String(query || '').trim();
  const cacheSuffix = slugify(safeQuery) || 'query';
  const cachePath = cacheDir
    ? path.resolve(cacheDir, `weather_meteoblue_location_${cacheSuffix}.json`)
    : null;

  if (!forceRefresh && cachePath && isFresh(cachePath, ttlMs)) {
    return { source: 'cache', path: cachePath, payload: readJson(cachePath) };
  }

  if (!apiKey || !safeQuery) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: apiKey ? 'missing-query' : 'missing-key', path: cachePath, payload: null };
  }

  const endpoint = `https://www.meteoblue.com/en/server/search/query3?query=${encodeURIComponent(safeQuery)}&apikey=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (cachePath) {
    writeJson(cachePath, payload);
  }

  return { source: 'api', path: cachePath, payload };
};

const getMeteoblueForecast = async (options = {}) => {
  const {
    apiKey,
    lat,
    lon,
    packageName = 'basic-1h_basic-day',
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    timeformat = 'timestamp',
    tz = 'UTC',
    windspeed = 'mph',
    precipitationamount = 'mm',
    temperature = 'F',
    forecastDays = 4
  } = options;

  const latValue = Number(lat);
  const lonValue = Number(lon);
  const safePackage = String(packageName || '').trim() || 'basic-1h_basic-day';
  const cacheSuffix = `${latValue.toFixed(3)}_${lonValue.toFixed(3)}_${slugify(safePackage)}`;
  const cachePath = cacheDir
    ? path.resolve(cacheDir, `weather_meteoblue_forecast_${cacheSuffix}.json`)
    : null;

  if (cachePath && isFresh(cachePath, ttlMs)) {
    return { source: 'cache', path: cachePath, payload: readJson(cachePath) };
  }

  if (!apiKey || !Number.isFinite(latValue) || !Number.isFinite(lonValue)) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: apiKey ? 'missing-coordinates' : 'missing-key', path: cachePath, payload: null };
  }

  const endpoint = `https://my.meteoblue.com/packages/${encodeURIComponent(safePackage)}`
    + `?lat=${latValue}`
    + `&lon=${lonValue}`
    + `&format=json`
    + `&timeformat=${encodeURIComponent(timeformat)}`
    + `&tz=${encodeURIComponent(tz)}`
    + `&windspeed=${encodeURIComponent(windspeed)}`
    + `&precipitationamount=${encodeURIComponent(precipitationamount)}`
    + `&temperature=${encodeURIComponent(temperature)}`
    + `&forecast_days=${encodeURIComponent(String(forecastDays))}`
    + `&apikey=${apiKey}`;

  const payload = await fetchJsonWithRetry(endpoint);

  if (cachePath) {
    writeJson(cachePath, payload);
  }

  return { source: 'api', path: cachePath, payload };
};

module.exports = {
  getMeteoblueLocation,
  getMeteoblueForecast
};
