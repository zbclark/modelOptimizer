/**
 * Module: approachSnapshots
 * Purpose: Manage approach snapshot loading and event-only approach metric deltas.
 */

const fs = require('fs');
const path = require('path');
const { ensureDirectory, readJsonFile, writeJsonFile } = require('./fileUtils');
const { formatTimestamp } = require('./timeUtils');
const { METRIC_DEFS, loadApproachCsv, extractApproachRowsFromJson, parseApproachNumber } = require('./approachDelta');
const { loadSeasonManifestEntries, parseDateToUtcMs } = require('./manifestUtils');
const { resolveTournamentDir, resolveInputCsvPath } = require('./tournamentPaths');

const ROOT_DIR = path.resolve(__dirname, '..');
const APPROACH_SNAPSHOT_DIR = path.resolve(ROOT_DIR, 'data', 'approach_snapshot');
const APPROACH_SNAPSHOT_ARCHIVE_DIR = path.resolve(APPROACH_SNAPSHOT_DIR, 'archive');
const APPROACH_SNAPSHOT_YTD_LATEST_PATH = path.resolve(APPROACH_SNAPSHOT_DIR, 'approach_ytd_latest.json');
const APPROACH_SNAPSHOT_L12_PATH = path.resolve(APPROACH_SNAPSHOT_DIR, 'approach_l12.json');
const APPROACH_SNAPSHOT_L24_PATH = path.resolve(APPROACH_SNAPSHOT_DIR, 'approach_l24.json');
const EVENT_ONLY_LOW_DATA_THRESHOLD = 0;

const getPayloadLastUpdated = payload => {
  if (!payload || typeof payload !== 'object') return null;
  return payload.last_updated || payload.lastUpdated || null;
};

const parseTimestampToMs = value => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const writeApproachSnapshotIfUpdated = ({ payload, logger = console }) => {
  if (!payload || typeof payload !== 'object') return { wrote: false, payload: null };
  ensureDirectory(APPROACH_SNAPSHOT_DIR);

  const latestPayload = fs.existsSync(APPROACH_SNAPSHOT_YTD_LATEST_PATH)
    ? readJsonFile(APPROACH_SNAPSHOT_YTD_LATEST_PATH)
    : null;
  const latestUpdatedMs = parseTimestampToMs(getPayloadLastUpdated(latestPayload));
  const fetchedUpdatedRaw = getPayloadLastUpdated(payload);
  const fetchedUpdatedMs = parseTimestampToMs(fetchedUpdatedRaw);

  const shouldWrite = !fetchedUpdatedMs || !latestUpdatedMs || fetchedUpdatedMs > latestUpdatedMs;
  if (!shouldWrite) {
    return { wrote: false, payload: latestPayload || payload };
  }

  writeJsonFile(APPROACH_SNAPSHOT_YTD_LATEST_PATH, payload);
  const archiveDate = fetchedUpdatedMs ? new Date(fetchedUpdatedMs) : new Date();
  const archiveStamp = formatTimestamp(archiveDate).slice(0, 10);
  const archivePath = path.resolve(APPROACH_SNAPSHOT_DIR, `approach_ytd_${archiveStamp}.json`);
  if (!fs.existsSync(archivePath)) {
    writeJsonFile(archivePath, payload);
  }
  if (logger && typeof logger.log === 'function') {
    logger.log(`ℹ️  YTD approach snapshot updated (${archiveStamp}).`);
  }
  return { wrote: true, payload };
};

const parseApproachSnapshotDateFromFilename = filePath => {
  const baseName = path.basename(filePath || '');
  const match = baseName.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (!match) return NaN;
  const [, year, month, day] = match;
  const iso = `${year}-${month}-${day}T00:00:00Z`;
  return Date.parse(iso);
};

const loadApproachSnapshotFromDisk = snapshotPath => {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) return { source: 'missing', path: snapshotPath, payload: null };
  const payload = readJsonFile(snapshotPath);
  if (!payload) return { source: 'invalid-json', path: snapshotPath, payload: null };
  return { source: 'snapshot', path: snapshotPath, payload };
};

const loadApproachRowsFromPath = sourcePath => {
  if (!sourcePath) return [];
  const lower = String(sourcePath).toLowerCase();
  if (lower.endsWith('.json')) {
    const snapshot = loadApproachSnapshotFromDisk(sourcePath);
    return snapshot?.payload ? extractApproachRowsFromJson(snapshot.payload) : [];
  }
  if (fs.existsSync(sourcePath)) {
    return loadApproachCsv(sourcePath);
  }
  return [];
};

const listApproachSnapshotArchives = () => {
  const entries = [];
  const collect = baseDir => {
    if (!baseDir || !fs.existsSync(baseDir)) return;
    const files = fs.readdirSync(baseDir);
    files.forEach(name => {
      if (!name.toLowerCase().endsWith('.json')) return;
      const lower = name.toLowerCase();
      if (lower === 'approach_l24.json' || lower === 'approach_l12.json' || lower === 'approach_ytd_latest.json') return;
      const match = name.match(/^approach_([a-z0-9]+)_(\d{4}-\d{2}-\d{2})\.json$/i);
      if (!match) return;
      const period = String(match[1] || '').toLowerCase();
      const dateStamp = match[2];
      const time = Date.parse(`${dateStamp}T00:00:00Z`);
      entries.push({
        period,
        name,
        path: path.resolve(baseDir, name),
        time: Number.isNaN(time) ? 0 : time
      });
    });
  };
  collect(APPROACH_SNAPSHOT_DIR);
  collect(APPROACH_SNAPSHOT_ARCHIVE_DIR);
  entries.sort((a, b) => (b.time || 0) - (a.time || 0));
  return entries;
};

const buildApproachSnapshotCandidates = ({ dataRootDir, season, manifestEntries = null }) => {
  const entries = Array.isArray(manifestEntries) && manifestEntries.length
    ? manifestEntries
    : loadSeasonManifestEntries(dataRootDir, season);
  const candidates = [];
  const seen = new Set();

  listApproachSnapshotArchives()
    .filter(entry => entry.period === 'ytd')
    .forEach(entry => {
      if (!entry?.path || seen.has(entry.path)) return;
      seen.add(entry.path);
      candidates.push({
        path: entry.path,
        time: entry.time || 0,
        date: entry.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || null,
        source: 'snapshot_archive',
        priority: 4
      });
    });

  entries.forEach(entry => {
    const eventTime = parseDateToUtcMs(entry.date);
    if (Number.isNaN(eventTime)) return;
    const tournamentDir = resolveTournamentDir(dataRootDir, season, entry.tournamentName, entry.tournamentSlug);
    const inputsDir = tournamentDir ? path.resolve(tournamentDir, 'inputs') : null;
    const approachPath = inputsDir
      ? resolveInputCsvPath({ inputsDir, season, suffix: 'Approach Skill' })
      : null;
    if (!approachPath || !fs.existsSync(approachPath) || seen.has(approachPath)) return;
    seen.add(approachPath);
    candidates.push({
      path: approachPath,
      time: eventTime,
      date: entry.date,
      source: 'approach_csv',
      priority: 3
    });
  });

  const addSnapshotFallback = (filePath, source, priority) => {
    if (!filePath || !fs.existsSync(filePath) || seen.has(filePath)) return;
    let time = parseApproachSnapshotDateFromFilename(filePath);
    if (Number.isNaN(time)) {
      try {
        time = fs.statSync(filePath).mtimeMs || 0;
      } catch {
        time = 0;
      }
    }
    seen.add(filePath);
    candidates.push({
      path: filePath,
      time: Number.isNaN(time) ? 0 : time,
      date: null,
      source,
      priority
    });
  };

  addSnapshotFallback(APPROACH_SNAPSHOT_L12_PATH, 'snapshot_l12', 2);
  addSnapshotFallback(APPROACH_SNAPSHOT_L24_PATH, 'snapshot_l24', 2);
  addSnapshotFallback(APPROACH_SNAPSHOT_YTD_LATEST_PATH, 'snapshot_latest', 1);

  return candidates.filter(entry => typeof entry.time === 'number' && entry.time > 0);
};

const selectApproachSnapshotsForEvent = ({ eventDateMs, candidates }) => {
  if (!eventDateMs || Number.isNaN(eventDateMs)) return { pre: null, post: null };
  const valid = (candidates || []).filter(entry => typeof entry?.time === 'number' && entry.time > 0);
  const pre = valid
    .filter(entry => entry.time <= eventDateMs)
    .sort((a, b) => (b.time - a.time) || ((b.priority || 0) - (a.priority || 0)))[0] || null;
  const post = valid
    .filter(entry => entry.time > eventDateMs)
    .sort((a, b) => (a.time - b.time) || ((b.priority || 0) - (a.priority || 0)))[0] || null;
  return { pre, post };
};

const buildApproachIndex = rows => {
  const index = new Map();
  (rows || []).forEach(row => {
    const dgId = row?.dg_id !== undefined && row?.dg_id !== null
      ? String(row.dg_id).split('.')[0].trim()
      : '';
    if (!dgId) return;
    const metrics = {};
    (METRIC_DEFS || []).forEach(def => {
      metrics[def.key] = parseApproachNumber(row?.[def.key], def.isPercent);
    });
    index.set(dgId, { dgId, metrics });
  });
  return index;
};

const resolveShotCountKey = metricKey => {
  const suffixes = ['gir_rate', 'good_shot_rate', 'poor_shot_avoid_rate', 'proximity_per_shot', 'sg_per_shot'];
  const suffixMatch = suffixes.find(suffix => metricKey.endsWith(`_${suffix}`));
  if (!suffixMatch) return null;
  return metricKey.replace(new RegExp(`_${suffixMatch}$`), '_shot_count');
};

const computeEventOnlyApproachRows = ({ beforeRows, afterRows }) => {
  const beforeIndex = buildApproachIndex(beforeRows || []);
  const afterIndex = buildApproachIndex(afterRows || []);
  const allIds = new Set([...beforeIndex.keys(), ...afterIndex.keys()]);
  const rows = [];
  let playersWithShots = 0;

  allIds.forEach(dgId => {
    const before = beforeIndex.get(dgId);
    const after = afterIndex.get(dgId);
    if (!before && !after) return;

    const row = { dg_id: dgId };
    let hasShots = false;

    (METRIC_DEFS || []).forEach(def => {
      const key = def.key;
      const beforeValue = before?.metrics?.[key] ?? null;
      const afterValue = after?.metrics?.[key] ?? null;

      if (key.endsWith('_shot_count')) {
        const deltaShots = (afterValue ?? 0) - (beforeValue ?? 0);
        if (deltaShots > 0) {
          row[key] = deltaShots;
          hasShots = true;
        } else {
          row[key] = null;
        }
        return;
      }

      if (key.endsWith('_low_data_indicator')) {
        const bucket = key.replace('_low_data_indicator', '');
        const shotKey = `${bucket}_shot_count`;
        const beforeShots = before?.metrics?.[shotKey] ?? null;
        const afterShots = after?.metrics?.[shotKey] ?? null;
        const deltaShots = (afterShots ?? 0) - (beforeShots ?? 0);
        const flag = (beforeValue === 1 || afterValue === 1 || (deltaShots > 0 && deltaShots < EVENT_ONLY_LOW_DATA_THRESHOLD)) ? 1 : 0;
        row[key] = flag;
        return;
      }

      const shotCountKey = resolveShotCountKey(key);
      if (!shotCountKey) {
        row[key] = afterValue ?? beforeValue ?? null;
        return;
      }

      const beforeShots = before?.metrics?.[shotCountKey] ?? null;
      const afterShots = after?.metrics?.[shotCountKey] ?? null;
      const deltaShots = (afterShots ?? 0) - (beforeShots ?? 0);
      const hasAfterShots = typeof afterShots === 'number' && Number.isFinite(afterShots) && afterShots > 0;
      const hasBeforeShots = typeof beforeShots === 'number' && Number.isFinite(beforeShots) && beforeShots > 0;
      if (!hasAfterShots || afterValue === null) {
        row[key] = null;
        return;
      }

      if (!hasBeforeShots || beforeValue === null || deltaShots <= 0) {
        row[key] = afterValue;
        hasShots = true;
        return;
      }

      const eventValue = ((afterValue * afterShots) - (beforeValue * beforeShots)) / deltaShots;
      row[key] = Number.isFinite(eventValue) ? eventValue : null;
      if (deltaShots > 0) hasShots = true;
    });

    if (hasShots) {
      playersWithShots += 1;
      rows.push(row);
    }
  });

  return { rows, playersWithShots };
};

const resolveApproachCsvForEntry = (dataRootDir, season, entry) => {
  if (!entry) return null;
  const tournamentDir = resolveTournamentDir(dataRootDir, season, entry.tournamentName, entry.tournamentSlug);
  const inputsDir = tournamentDir ? path.resolve(tournamentDir, 'inputs') : null;
  const approachPath = resolveInputCsvPath({ inputsDir, season, suffix: 'Approach Skill' });
  return approachPath && fs.existsSync(approachPath) ? approachPath : null;
};

module.exports = {
  APPROACH_SNAPSHOT_DIR,
  APPROACH_SNAPSHOT_ARCHIVE_DIR,
  APPROACH_SNAPSHOT_YTD_LATEST_PATH,
  APPROACH_SNAPSHOT_L12_PATH,
  APPROACH_SNAPSHOT_L24_PATH,
  EVENT_ONLY_LOW_DATA_THRESHOLD,
  getPayloadLastUpdated,
  parseTimestampToMs,
  writeApproachSnapshotIfUpdated,
  parseApproachSnapshotDateFromFilename,
  loadApproachSnapshotFromDisk,
  loadApproachRowsFromPath,
  listApproachSnapshotArchives,
  buildApproachSnapshotCandidates,
  selectApproachSnapshotsForEvent,
  computeEventOnlyApproachRows,
  resolveApproachCsvForEntry
};
