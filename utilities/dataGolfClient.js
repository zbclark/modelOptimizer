/**
 * Module: dataGolfClient
 * Purpose: DataGolf API client with caching and retry logic.
 */

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./fileUtils');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 2000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const normalizeNameForMatch = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .trim();

const isFieldUpdateMatch = (payload, expectedEventId, expectedEventName) => {
  if (!payload) return false;
  const expectedId = expectedEventId ? String(expectedEventId).trim() : null;
  const actualId = payload?.event_id ? String(payload.event_id).trim() : null;
  if (expectedId && actualId) {
    return expectedId === actualId;
  }

  const expectedName = expectedEventName ? normalizeNameForMatch(expectedEventName) : null;
  const actualName = payload?.event_name ? normalizeNameForMatch(payload.event_name) : null;
  if (expectedName && actualName) {
    return expectedName === actualName
      || expectedName.includes(actualName)
      || actualName.includes(expectedName);
  }

  return true;
};

const isFresh = (filePath, ttlMs) => {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const stats = fs.statSync(filePath);
    return Date.now() - stats.mtimeMs < ttlMs;
  } catch {
    return false;
  }
};

const getPayloadLastUpdated = payload => {
  if (!payload || typeof payload !== 'object') return null;
  return payload.last_updated || payload.lastUpdated || null;
};

const parseUpdatedMs = value => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const resolveCacheFirstPayload = (cachePayload, apiPayload) => {
  if (!apiPayload) {
    return { payload: cachePayload, shouldWrite: false, reason: 'api-unavailable' };
  }
  if (!cachePayload) {
    return { payload: apiPayload, shouldWrite: true, reason: 'cache-miss' };
  }

  const apiUpdated = getPayloadLastUpdated(apiPayload);
  const cacheUpdated = getPayloadLastUpdated(cachePayload);
  const apiMs = parseUpdatedMs(apiUpdated);
  const cacheMs = parseUpdatedMs(cacheUpdated);

  if (apiMs === null && cacheMs === null) {
    return { payload: cachePayload, shouldWrite: false, reason: 'no-last-updated' };
  }
  if (apiMs === null) {
    return { payload: cachePayload, shouldWrite: false, reason: 'api-missing-last-updated' };
  }
  if (cacheMs === null) {
    return { payload: apiPayload, shouldWrite: true, reason: 'cache-missing-last-updated' };
  }
  if (apiMs > cacheMs) {
    return { payload: apiPayload, shouldWrite: true, reason: 'api-newer' };
  }
  return { payload: cachePayload, shouldWrite: false, reason: 'cache-current' };
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

const getDataGolfRankings = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    cacheFirst = false
  } = options;

  const cachePath = cacheDir
    ? path.resolve(cacheDir, 'datagolf_rankings.json')
    : null;

  if (cacheFirst) {
    const cachePayload = cachePath && fs.existsSync(cachePath) ? readJson(cachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: cachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/preds/get-dg-rankings?file_format=json&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && cachePath) {
      writeJson(cachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: cachePath, payload: decision.payload };
  }

  if (cachePath && isFresh(cachePath, ttlMs)) {
    return { source: 'cache', path: cachePath, payload: readJson(cachePath) };
  }

  if (!apiKey) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: 'missing-key', path: cachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/preds/get-dg-rankings?file_format=json&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (cachePath) {
    writeJson(cachePath, payload);
  }

  return { source: 'api', path: cachePath, payload };
};

const getDataGolfApproachSkill = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    period = 'l24',
    fileFormat = 'json',
    cacheFirst = false
  } = options;

  const safePeriod = String(period || 'l24').trim().toLowerCase() || 'l24';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json' ? safePeriod : `${safePeriod}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_approach_skill_${cacheSuffix}.json`;
  const legacySuffix = `${safePeriod}_${safeFormat}`.replace(/[^a-z0-9._-]/g, '_');
  const legacyFileName = `datagolf_approach_skill_${legacySuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;
  const legacyCachePath = cacheDir && legacyFileName !== cacheFileName
    ? path.resolve(cacheDir, legacyFileName)
    : null;
  const cachePath = primaryCachePath && fs.existsSync(primaryCachePath)
    ? primaryCachePath
    : (legacyCachePath && fs.existsSync(legacyCachePath) ? legacyCachePath : primaryCachePath);

  if (cacheFirst) {
    const cachePayload = cachePath && fs.existsSync(cachePath) ? readJson(cachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: cachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/preds/approach-skill?period=${safePeriod}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: cachePath, payload: decision.payload };
  }

  if (cachePath && isFresh(cachePath, ttlMs)) {
    return { source: 'cache', path: cachePath, payload: readJson(cachePath) };
  }

  if (!apiKey) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: 'missing-key', path: cachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/preds/approach-skill?period=${safePeriod}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath || cachePath, payload };
};

const getDataGolfFieldUpdates = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    preferCache = false,
    cacheSlug = null,
    tour = 'pga',
    fileFormat = 'json',
    expectedEventId = null,
    expectedEventName = null,
    cacheFirst = false
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const safeSlug = cacheSlug
    ? String(cacheSlug).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    : null;
  const cacheSuffix = (safeFormat === 'json' ? safeTour : `${safeTour}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = safeSlug
    ? `datagolf_${safeSlug}_field_updates_${cacheSuffix}.json`
    : `datagolf_field_updates_${cacheSuffix}.json`;
  const legacySuffix = `${safeTour}_${safeFormat}`.replace(/[^a-z0-9._-]/g, '_');
  const legacyFileName = safeSlug
    ? `datagolf_${safeSlug}_field_updates_${legacySuffix}.json`
    : `datagolf_field_updates_${legacySuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;
  const legacyCachePath = cacheDir && legacyFileName !== cacheFileName
    ? path.resolve(cacheDir, legacyFileName)
    : null;
  const cachePath = primaryCachePath && fs.existsSync(primaryCachePath)
    ? primaryCachePath
    : (legacyCachePath && fs.existsSync(legacyCachePath) ? legacyCachePath : primaryCachePath);

  if (cacheFirst) {
    const cachePayload = cachePath && fs.existsSync(cachePath) ? readJson(cachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: cachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/field-updates?tour=${safeTour}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      throw error;
    }

    if (!isFieldUpdateMatch(apiPayload, expectedEventId, expectedEventName)) {
      if (cachePayload && isFieldUpdateMatch(cachePayload, expectedEventId, expectedEventName)) {
        return { source: 'cache-current', path: cachePath, payload: cachePayload };
      }
      return { source: 'api-mismatch', path: cachePath, payload: null };
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: cachePath, payload: decision.payload };
  }

  if (cachePath && isFresh(cachePath, ttlMs)) {
    const cachedPayload = readJson(cachePath);
    if (isFieldUpdateMatch(cachedPayload, expectedEventId, expectedEventName)) {
      return { source: 'cache', path: cachePath, payload: cachedPayload };
    }
  }

  if (cachePath && preferCache && allowStale && fs.existsSync(cachePath)) {
    const cachedPayload = readJson(cachePath);
    if (isFieldUpdateMatch(cachedPayload, expectedEventId, expectedEventName)) {
      return { source: 'cache-stale', path: cachePath, payload: cachedPayload };
    }
  }

  if (!apiKey) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: 'missing-key', path: cachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/field-updates?tour=${safeTour}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (!isFieldUpdateMatch(payload, expectedEventId, expectedEventName)) {
    return { source: 'api-mismatch', path: cachePath, payload: null };
  }

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath || cachePath, payload };
};

const getDataGolfPlayerDecompositions = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    tour = 'pga',
    fileFormat = 'json',
    cacheFirst = false
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json' ? safeTour : `${safeTour}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_player_decompositions_${cacheSuffix}.json`;
  const legacySuffix = `${safeTour}_${safeFormat}`.replace(/[^a-z0-9._-]/g, '_');
  const legacyFileName = `datagolf_player_decompositions_${legacySuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;
  const legacyCachePath = cacheDir && legacyFileName !== cacheFileName
    ? path.resolve(cacheDir, legacyFileName)
    : null;
  const cachePath = primaryCachePath && fs.existsSync(primaryCachePath)
    ? primaryCachePath
    : (legacyCachePath && fs.existsSync(legacyCachePath) ? legacyCachePath : primaryCachePath);

  if (cacheFirst) {
    const cachePayload = cachePath && fs.existsSync(cachePath) ? readJson(cachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: cachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/preds/player-decompositions?tour=${safeTour}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: cachePath, payload: decision.payload };
  }

  if (cachePath && isFresh(cachePath, ttlMs)) {
    return { source: 'cache', path: cachePath, payload: readJson(cachePath) };
  }

  if (!apiKey) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: 'missing-key', path: cachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/preds/player-decompositions?tour=${safeTour}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath || cachePath, payload };
};

const getDataGolfSkillRatings = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    display = 'value',
    fileFormat = 'json',
    cacheFirst = false
  } = options;

  const safeDisplay = String(display || 'value').trim().toLowerCase() || 'value';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json' ? safeDisplay : `${safeDisplay}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_skill_ratings_${cacheSuffix}.json`;
  const legacySuffix = `${safeDisplay}_${safeFormat}`.replace(/[^a-z0-9._-]/g, '_');
  const legacyFileName = `datagolf_skill_ratings_${legacySuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;
  const legacyCachePath = cacheDir && legacyFileName !== cacheFileName
    ? path.resolve(cacheDir, legacyFileName)
    : null;
  const cachePath = primaryCachePath && fs.existsSync(primaryCachePath)
    ? primaryCachePath
    : (legacyCachePath && fs.existsSync(legacyCachePath) ? legacyCachePath : primaryCachePath);

  if (cacheFirst) {
    const cachePayload = cachePath && fs.existsSync(cachePath) ? readJson(cachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: cachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/preds/skill-ratings?display=${safeDisplay}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: cachePath, payload: decision.payload };
  }

  if (cachePath && isFresh(cachePath, ttlMs)) {
    return { source: 'cache', path: cachePath, payload: readJson(cachePath) };
  }

  if (!apiKey) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: 'missing-key', path: cachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/preds/skill-ratings?display=${safeDisplay}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath || cachePath, payload };
};

const getDataGolfHistoricalRounds = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    preferCache = false,
    tour = 'pga',
    eventId = 'all',
    year,
    fileFormat = 'json'
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeEventId = String(eventId ?? 'all').trim().toLowerCase() || 'all';
  const safeYear = year !== undefined && year !== null ? String(year).trim() : '';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json'
    ? `${safeTour}_${safeEventId}_${safeYear || 'year'}`
    : `${safeTour}_${safeEventId}_${safeYear || 'year'}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_historical_rounds_${cacheSuffix}.json`;
  const legacySuffix = `${safeTour}_${safeEventId}_${safeYear || 'year'}_${safeFormat}`.replace(/[^a-z0-9._-]/g, '_');
  const legacyFileName = `datagolf_historical_rounds_${legacySuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;
  const legacyCachePath = cacheDir && legacyFileName !== cacheFileName
    ? path.resolve(cacheDir, legacyFileName)
    : null;
  const cachePath = primaryCachePath && fs.existsSync(primaryCachePath)
    ? primaryCachePath
    : (legacyCachePath && fs.existsSync(legacyCachePath) ? legacyCachePath : primaryCachePath);

  if (cachePath && isFresh(cachePath, ttlMs)) {
    return { source: 'cache', path: cachePath, payload: readJson(cachePath) };
  }

  if (cachePath && preferCache && allowStale && fs.existsSync(cachePath)) {
    return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
  }

  if (!apiKey) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: 'missing-key', path: cachePath, payload: null };
  }

  if (!safeYear) {
    return { source: 'missing-year', path: cachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/historical-raw-data/rounds?tour=${safeTour}&event_id=${safeEventId}&year=${safeYear}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath || cachePath, payload };
};

const getDataGolfLiveTournamentStats = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    stats = 'sg_ott,sg_app,sg_arg,sg_putt,sg_t2g,sg_bs,sg_total,distance,accuracy,gir,prox_fw,prox_rgh,scrambling,great_shots,poor_shots',
    round = 'event_avg',
    display = 'value',
    fileFormat = 'json',
    cacheFirst = false
  } = options;

  const safeStats = String(stats || '').trim().toLowerCase();
  const safeRound = String(round || 'event_avg').trim().toLowerCase() || 'event_avg';
  const safeDisplay = String(display || 'value').trim().toLowerCase() || 'value';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const statsSlug = safeStats.replace(/[^a-z0-9]+/g, '_').slice(0, 120) || 'default';
  const cacheSuffix = (safeFormat === 'json'
    ? `${statsSlug}_${safeRound}_${safeDisplay}`
    : `${statsSlug}_${safeRound}_${safeDisplay}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_live_tournament_stats_${cacheSuffix}.json`;
  const legacySuffix = `${statsSlug}_${safeRound}_${safeDisplay}_${safeFormat}`.replace(/[^a-z0-9._-]/g, '_');
  const legacyFileName = `datagolf_live_tournament_stats_${legacySuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;
  const legacyCachePath = cacheDir && legacyFileName !== cacheFileName
    ? path.resolve(cacheDir, legacyFileName)
    : null;
  const cachePath = primaryCachePath && fs.existsSync(primaryCachePath)
    ? primaryCachePath
    : (legacyCachePath && fs.existsSync(legacyCachePath) ? legacyCachePath : primaryCachePath);

  if (cacheFirst) {
    const cachePayload = cachePath && fs.existsSync(cachePath) ? readJson(cachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: cachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/preds/live-tournament-stats?stats=${safeStats}&round=${safeRound}&display=${safeDisplay}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: cachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: cachePath, payload: decision.payload };
  }

  if (cachePath && isFresh(cachePath, ttlMs)) {
    return { source: 'cache', path: cachePath, payload: readJson(cachePath) };
  }

  if (!apiKey) {
    if (cachePath && allowStale && fs.existsSync(cachePath)) {
      return { source: 'cache-stale', path: cachePath, payload: readJson(cachePath) };
    }
    return { source: 'missing-key', path: cachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/preds/live-tournament-stats?stats=${safeStats}&round=${safeRound}&display=${safeDisplay}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath || cachePath, payload };
};

const getDataGolfHistoricalOddsEventList = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    cacheFirst = false,
    tour = 'pga',
    fileFormat = 'json'
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json' ? safeTour : `${safeTour}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_historical_odds_event_list_${cacheSuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;

  if (cacheFirst) {
    const cachePayload = primaryCachePath && fs.existsSync(primaryCachePath) ? readJson(primaryCachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: primaryCachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/historical-odds/event-list?tour=${safeTour}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: primaryCachePath, payload: decision.payload };
  }

  if (primaryCachePath && isFresh(primaryCachePath, ttlMs)) {
    return { source: 'cache', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (!apiKey) {
    if (primaryCachePath && allowStale && fs.existsSync(primaryCachePath)) {
      return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
    }
    return { source: 'missing-key', path: primaryCachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/historical-odds/event-list?tour=${safeTour}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath, payload };
};

const getDataGolfHistoricalOddsOutrights = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    preferCache = false,
    cacheFirst = false,
    tour = 'pga',
    eventId,
    year,
    market = 'win',
    book = 'draftkings',
    oddsFormat = 'decimal',
    fileFormat = 'json'
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeEventId = String(eventId ?? '').trim();
  const safeYear = year !== undefined && year !== null ? String(year).trim() : '';
  const safeMarket = String(market || 'win').trim().toLowerCase() || 'win';
  const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
  const safeOddsFormat = String(oddsFormat || 'decimal').trim().toLowerCase() || 'decimal';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json'
    ? `${safeTour}_${safeEventId || 'event'}_${safeYear || 'year'}_${safeMarket}_${safeBook}_${safeOddsFormat}`
    : `${safeTour}_${safeEventId || 'event'}_${safeYear || 'year'}_${safeMarket}_${safeBook}_${safeOddsFormat}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_historical_odds_outrights_${cacheSuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;

  if (primaryCachePath && isFresh(primaryCachePath, ttlMs)) {
    return { source: 'cache', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (primaryCachePath && preferCache && allowStale && fs.existsSync(primaryCachePath)) {
    return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (!apiKey) {
    if (primaryCachePath && allowStale && fs.existsSync(primaryCachePath)) {
      return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
    }
    return { source: 'missing-key', path: primaryCachePath, payload: null };
  }

  if (!safeEventId) {
    return { source: 'missing-event', path: primaryCachePath, payload: null };
  }
  if (!safeYear) {
    return { source: 'missing-year', path: primaryCachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/historical-odds/outrights?tour=${safeTour}&event_id=${safeEventId}&year=${safeYear}&market=${safeMarket}&book=${safeBook}&odds_format=${safeOddsFormat}&file_format=${safeFormat}&key=${apiKey}`;

  if (cacheFirst) {
    const cachePayload = primaryCachePath && fs.existsSync(primaryCachePath) ? readJson(primaryCachePath) : null;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      throw error;
    }
    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: primaryCachePath, payload: decision.payload };
  }

  const payload = await fetchJsonWithRetry(endpoint);
  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }
  return { source: 'api', path: primaryCachePath, payload };
};

const getDataGolfHistoricalOddsMatchups = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    preferCache = false,
    cacheFirst = false,
    tour = 'pga',
    eventId,
    year,
    book = 'draftkings',
    oddsFormat = 'decimal',
    fileFormat = 'json'
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeEventId = String(eventId ?? '').trim();
  const safeYear = year !== undefined && year !== null ? String(year).trim() : '';
  const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
  const safeOddsFormat = String(oddsFormat || 'decimal').trim().toLowerCase() || 'decimal';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json'
    ? `${safeTour}_${safeEventId || 'event'}_${safeYear || 'year'}_${safeBook}_${safeOddsFormat}`
    : `${safeTour}_${safeEventId || 'event'}_${safeYear || 'year'}_${safeBook}_${safeOddsFormat}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_historical_odds_matchups_${cacheSuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;

  if (primaryCachePath && isFresh(primaryCachePath, ttlMs)) {
    return { source: 'cache', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (primaryCachePath && preferCache && allowStale && fs.existsSync(primaryCachePath)) {
    return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (!apiKey) {
    if (primaryCachePath && allowStale && fs.existsSync(primaryCachePath)) {
      return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
    }
    return { source: 'missing-key', path: primaryCachePath, payload: null };
  }

  if (!safeEventId) {
    return { source: 'missing-event', path: primaryCachePath, payload: null };
  }
  if (!safeYear) {
    return { source: 'missing-year', path: primaryCachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/historical-odds/matchups?tour=${safeTour}&event_id=${safeEventId}&year=${safeYear}&book=${safeBook}&odds_format=${safeOddsFormat}&file_format=${safeFormat}&key=${apiKey}`;

  if (cacheFirst) {
    const cachePayload = primaryCachePath && fs.existsSync(primaryCachePath) ? readJson(primaryCachePath) : null;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      throw error;
    }
    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: primaryCachePath, payload: decision.payload };
  }

  const payload = await fetchJsonWithRetry(endpoint);
  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }
  return { source: 'api', path: primaryCachePath, payload };
};

const getDataGolfFantasyProjectionDefaults = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    cacheFirst = false,
    tour = 'pga',
    site = 'draftkings',
    slate = 'main',
    fileFormat = 'json'
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeSite = String(site || 'draftkings').trim().toLowerCase() || 'draftkings';
  const safeSlate = String(slate || 'main').trim().toLowerCase() || 'main';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json'
    ? `${safeTour}_${safeSite}_${safeSlate}`
    : `${safeTour}_${safeSite}_${safeSlate}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_fantasy_projection_defaults_${cacheSuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;

  if (cacheFirst) {
    const cachePayload = primaryCachePath && fs.existsSync(primaryCachePath) ? readJson(primaryCachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: primaryCachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/preds/fantasy-projection-defaults?tour=${safeTour}&site=${safeSite}&slate=${safeSlate}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: primaryCachePath, payload: decision.payload };
  }

  if (primaryCachePath && isFresh(primaryCachePath, ttlMs)) {
    return { source: 'cache', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (!apiKey) {
    if (primaryCachePath && allowStale && fs.existsSync(primaryCachePath)) {
      return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
    }
    return { source: 'missing-key', path: primaryCachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/preds/fantasy-projection-defaults?tour=${safeTour}&site=${safeSite}&slate=${safeSlate}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath, payload };
};

const getDataGolfLiveMatchups = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    cacheFirst = false,
    tour = 'pga',
    market = 'tournament_matchups',
    oddsFormat = 'decimal',
    fileFormat = 'json'
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeMarket = String(market || 'tournament_matchups').trim().toLowerCase() || 'tournament_matchups';
  const safeOddsFormat = String(oddsFormat || 'decimal').trim().toLowerCase() || 'decimal';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json'
    ? `${safeTour}_${safeMarket}_${safeOddsFormat}`
    : `${safeTour}_${safeMarket}_${safeOddsFormat}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_live_matchups_${cacheSuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;

  if (cacheFirst) {
    const cachePayload = primaryCachePath && fs.existsSync(primaryCachePath) ? readJson(primaryCachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: primaryCachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/betting-tools/matchups?tour=${safeTour}&market=${safeMarket}&odds_format=${safeOddsFormat}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: primaryCachePath, payload: decision.payload };
  }

  if (primaryCachePath && isFresh(primaryCachePath, ttlMs)) {
    return { source: 'cache', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (!apiKey) {
    if (primaryCachePath && allowStale && fs.existsSync(primaryCachePath)) {
      return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
    }
    return { source: 'missing-key', path: primaryCachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/betting-tools/matchups?tour=${safeTour}&market=${safeMarket}&odds_format=${safeOddsFormat}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath, payload };
};

const getDataGolfHistoricalDfsPoints = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    cacheFirst = false,
    tour = 'pga',
    site = 'draftkings',
    eventId,
    year,
    fileFormat = 'json'
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeSite = String(site || 'draftkings').trim().toLowerCase() || 'draftkings';
  const safeEventId = String(eventId ?? '').trim();
  const safeYear = year !== undefined && year !== null ? String(year).trim() : '';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json'
    ? `${safeTour}_${safeSite}_${safeEventId || 'event'}_${safeYear || 'year'}`
    : `${safeTour}_${safeSite}_${safeEventId || 'event'}_${safeYear || 'year'}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_historical_dfs_points_${cacheSuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;

  if (primaryCachePath && isFresh(primaryCachePath, ttlMs)) {
    return { source: 'cache', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (!apiKey) {
    if (primaryCachePath && allowStale && fs.existsSync(primaryCachePath)) {
      return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
    }
    return { source: 'missing-key', path: primaryCachePath, payload: null };
  }

  if (!safeEventId) {
    return { source: 'missing-event', path: primaryCachePath, payload: null };
  }
  if (!safeYear) {
    return { source: 'missing-year', path: primaryCachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/historical-dfs-data/points?tour=${safeTour}&site=${safeSite}&event_id=${safeEventId}&year=${safeYear}&file_format=${safeFormat}&key=${apiKey}`;

  if (cacheFirst) {
    const cachePayload = primaryCachePath && fs.existsSync(primaryCachePath) ? readJson(primaryCachePath) : null;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      throw error;
    }
    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: primaryCachePath, payload: decision.payload };
  }

  const payload = await fetchJsonWithRetry(endpoint);
  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }
  return { source: 'api', path: primaryCachePath, payload };
};

const getDataGolfLiveOutrights = async (options = {}) => {
  const {
    apiKey,
    cacheDir,
    ttlMs = DEFAULT_TTL_MS,
    allowStale = true,
    cacheFirst = false,
    tour = 'pga',
    market = 'win',
    oddsFormat = 'decimal',
    fileFormat = 'json'
  } = options;

  const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
  const safeMarket = String(market || 'win').trim().toLowerCase() || 'win';
  const safeOddsFormat = String(oddsFormat || 'decimal').trim().toLowerCase() || 'decimal';
  const safeFormat = String(fileFormat || 'json').trim().toLowerCase() || 'json';
  const cacheSuffix = (safeFormat === 'json'
    ? `${safeTour}_${safeMarket}_${safeOddsFormat}`
    : `${safeTour}_${safeMarket}_${safeOddsFormat}_${safeFormat}`)
    .replace(/[^a-z0-9._-]/g, '_');
  const cacheFileName = `datagolf_live_outrights_${cacheSuffix}.json`;
  const primaryCachePath = cacheDir
    ? path.resolve(cacheDir, cacheFileName)
    : null;

  if (cacheFirst) {
    const cachePayload = primaryCachePath && fs.existsSync(primaryCachePath) ? readJson(primaryCachePath) : null;
    if (!apiKey) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      return { source: 'missing-key', path: primaryCachePath, payload: null };
    }
    const endpoint = `https://feeds.datagolf.com/betting-tools/outrights?tour=${safeTour}&market=${safeMarket}&odds_format=${safeOddsFormat}&file_format=${safeFormat}&key=${apiKey}`;
    let apiPayload = null;
    try {
      apiPayload = await fetchJsonWithRetry(endpoint);
    } catch (error) {
      if (cachePayload) {
        return { source: 'cache-stale', path: primaryCachePath, payload: cachePayload };
      }
      throw error;
    }

    const decision = resolveCacheFirstPayload(cachePayload, apiPayload);
    if (decision.shouldWrite && primaryCachePath) {
      writeJson(primaryCachePath, apiPayload);
    }
    const source = decision.payload === apiPayload ? 'api' : 'cache-current';
    return { source, path: primaryCachePath, payload: decision.payload };
  }

  if (primaryCachePath && isFresh(primaryCachePath, ttlMs)) {
    return { source: 'cache', path: primaryCachePath, payload: readJson(primaryCachePath) };
  }

  if (!apiKey) {
    if (primaryCachePath && allowStale && fs.existsSync(primaryCachePath)) {
      return { source: 'cache-stale', path: primaryCachePath, payload: readJson(primaryCachePath) };
    }
    return { source: 'missing-key', path: primaryCachePath, payload: null };
  }

  const endpoint = `https://feeds.datagolf.com/betting-tools/outrights?tour=${safeTour}&market=${safeMarket}&odds_format=${safeOddsFormat}&file_format=${safeFormat}&key=${apiKey}`;
  const payload = await fetchJsonWithRetry(endpoint);

  if (primaryCachePath) {
    writeJson(primaryCachePath, payload);
  }

  return { source: 'api', path: primaryCachePath, payload };
};

module.exports = {
  getDataGolfRankings,
  getDataGolfApproachSkill,
  getDataGolfFieldUpdates,
  getDataGolfPlayerDecompositions,
  getDataGolfSkillRatings,
  getDataGolfHistoricalRounds,
  getDataGolfLiveTournamentStats,
  getDataGolfHistoricalOddsEventList,
  getDataGolfHistoricalOddsOutrights,
  getDataGolfHistoricalOddsMatchups,
  getDataGolfFantasyProjectionDefaults,
  getDataGolfLiveOutrights,
  getDataGolfLiveMatchups,
  getDataGolfHistoricalDfsPoints
};
