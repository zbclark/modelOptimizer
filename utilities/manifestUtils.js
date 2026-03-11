const fs = require('fs');
const path = require('path');
const { formatDateKey } = require('./timeUtils');

const slugifyTournament = value => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.replace(/^optimizer-+/, '');
};

const parseDateToUtcMs = value => {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const parsed = Date.parse(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed) ? NaN : parsed;
};

const parseApproachSnapshotDateFromFilename = filePath => {
  const baseName = path.basename(filePath || '');
  const match = baseName.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (!match) return NaN;
  const [, year, month, day] = match;
  const iso = `${year}-${month}-${day}T00:00:00Z`;
  return Date.parse(iso);
};

const listApproachSnapshotArchives = approachSnapshotDir => {
  if (!approachSnapshotDir) return [];
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
  collect(approachSnapshotDir);
  collect(path.resolve(approachSnapshotDir, 'archive'));
  entries.sort((a, b) => (b.time || 0) - (a.time || 0));
  return entries;
};

const buildApproachSnapshotCandidates = ({ approachSnapshotDir }) => {
  const candidates = [];
  const seen = new Set();

  listApproachSnapshotArchives(approachSnapshotDir)
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

  const latestPath = approachSnapshotDir
    ? path.resolve(approachSnapshotDir, 'approach_ytd_latest.json')
    : null;
  if (latestPath && fs.existsSync(latestPath) && !seen.has(latestPath)) {
    seen.add(latestPath);
    const latestTime = parseApproachSnapshotDateFromFilename(latestPath);
    candidates.push({
      path: latestPath,
      time: Number.isNaN(latestTime) ? 0 : latestTime,
      date: null,
      source: 'snapshot_latest',
      priority: 1
    });
  }

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

const resolveApproachSnapshotPairForEvent = ({
  dataRootDir,
  season,
  eventId,
  tournamentSlug,
  tournamentName,
  manifestEntries = null,
  approachSnapshotDir,
  csvFallback = null
} = {}) => {
  const entries = Array.isArray(manifestEntries) && manifestEntries.length
    ? manifestEntries
    : loadSeasonManifestEntries(dataRootDir, season);
  const match = resolveManifestEntryForEvent(entries, { eventId, tournamentSlug, tournamentName });
  const eventDateMs = parseDateToUtcMs(match?.date);
  if (!eventDateMs || Number.isNaN(eventDateMs)) {
    return {
      eventDate: match?.date || null,
      eventDateMs: null,
      prePath: null,
      postPath: null,
      selectionSource: 'missing_date'
    };
  }

  const candidates = buildApproachSnapshotCandidates({ approachSnapshotDir });
  const { pre, post } = selectApproachSnapshotsForEvent({ eventDateMs, candidates });
  let prePath = pre?.path || null;
  let postPath = post?.path || null;
  let selectionSource = (prePath || postPath)
    ? (pre?.source === 'snapshot_latest' || post?.source === 'snapshot_latest' ? 'snapshot_latest' : 'snapshot_archive')
    : 'missing_snapshots';

  if (!prePath && csvFallback?.prePath) {
    prePath = csvFallback.prePath;
    selectionSource = 'csv_fallback';
  }
  if (!postPath && csvFallback?.postPath) {
    postPath = csvFallback.postPath;
    selectionSource = 'csv_fallback';
  }

  return {
    eventDate: match?.date || null,
    eventDateMs,
    prePath,
    postPath,
    selectionSource
  };
};

const formatDateUtc = dateValue => {
  if (!dateValue) return '';
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateKey(date);
};

const getThursdayOfWeek = (dateValue = new Date()) => {
  const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay();
  const mondayIndex = day === 0 ? 7 : day; // Monday=1 ... Sunday=7
  const delta = 4 - mondayIndex; // Thursday=4
  date.setUTCDate(date.getUTCDate() + delta);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const resolveManifestPath = (dataRootDir, season) => {
  if (!dataRootDir || !season) return null;
  return path.resolve(dataRootDir, String(season), 'manifest.json');
};

const normalizeManifestEntry = entry => {
  if (!entry || typeof entry !== 'object') return null;
  const eventId = entry?.eventId !== undefined && entry?.eventId !== null
    ? String(entry.eventId).trim()
    : null;
  const tournamentSlug = String(entry?.tournamentSlug || '').trim();
  const tournamentName = String(entry?.tournamentName || '').trim();
  const date = String(entry?.date || '').trim();
  if (!date || (!eventId && !tournamentSlug && !tournamentName)) return null;
  return {
    eventId: eventId || null,
    tournamentSlug,
    tournamentName,
    date
  };
};

const readManifestRaw = manifestPath => {
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return null;
  }
};

const loadSeasonManifestEntries = (dataRootDir, season) => {
  const manifestPath = resolveManifestPath(dataRootDir, season);
  if (!manifestPath || !fs.existsSync(manifestPath)) return [];
  const raw = readManifestRaw(manifestPath);
  const entries = Array.isArray(raw) ? raw : (Array.isArray(raw?.entries) ? raw.entries : []);
  return entries.map(normalizeManifestEntry).filter(Boolean);
};

const resolveManifestEntryForEvent = (entries, { eventId, tournamentSlug, tournamentName } = {}) => {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const eventIdStr = String(eventId || '').trim();
  const slug = slugifyTournament(tournamentSlug || tournamentName);
  return entries.find(entry => (eventIdStr && entry.eventId === eventIdStr)
    || (slug && slugifyTournament(entry.tournamentSlug || entry.tournamentName) === slug)) || null;
};

const resolveNextManifestEntry = (entries, currentEntry) => {
  if (!Array.isArray(entries) || entries.length === 0 || !currentEntry?.date) return null;
  const sorted = entries
    .map(entry => ({ ...entry, time: parseDateToUtcMs(entry.date) }))
    .filter(entry => typeof entry.time === 'number' && !Number.isNaN(entry.time))
    .sort((a, b) => a.time - b.time);
  const currentTime = parseDateToUtcMs(currentEntry.date);
  if (Number.isNaN(currentTime)) return null;
  const currentIndex = sorted.findIndex(entry => entry.time === currentTime && entry.eventId === currentEntry.eventId);
  if (currentIndex === -1) return sorted.find(entry => entry.time > currentTime) || null;
  return sorted[currentIndex + 1] || null;
};

const resolvePreviousManifestEntry = (entries, currentEntry) => {
  if (!Array.isArray(entries) || entries.length === 0 || !currentEntry?.date) return null;
  const sorted = entries
    .map(entry => ({ ...entry, time: parseDateToUtcMs(entry.date) }))
    .filter(entry => typeof entry.time === 'number' && !Number.isNaN(entry.time))
    .sort((a, b) => a.time - b.time);
  const currentTime = parseDateToUtcMs(currentEntry.date);
  if (Number.isNaN(currentTime)) return null;
  const currentIndex = sorted.findIndex(entry => entry.time === currentTime && entry.eventId === currentEntry.eventId);
  if (currentIndex === -1) {
    const priorEntries = sorted.filter(entry => entry.time < currentTime);
    return priorEntries.length ? priorEntries[priorEntries.length - 1] : null;
  }
  return currentIndex > 0 ? sorted[currentIndex - 1] : null;
};

const resolveEventStartDateFromManifest = ({ dataRootDir, season, eventId, tournamentSlug, tournamentName }) => {
  const entries = loadSeasonManifestEntries(dataRootDir, season);
  if (!entries.length) return null;
  const match = resolveManifestEntryForEvent(entries, { eventId, tournamentSlug, tournamentName });
  if (!match?.date) return null;
  const parsed = parseDateToUtcMs(match.date);
  if (Number.isNaN(parsed)) return null;
  return { date: match.date, time: parsed };
};

const writeManifestEntries = (manifestPath, raw, entries) => {
  if (!manifestPath) return false;
  const payload = Array.isArray(raw)
    ? entries
    : { ...(raw && typeof raw === 'object' ? raw : {}), entries };
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2));
  return true;
};

const ensureManifestEntry = ({
  dataRootDir,
  season,
  eventId,
  tournamentSlug,
  tournamentName,
  date,
  logger = console
} = {}) => {
  if (!dataRootDir || !season) return { entries: [], updated: false, entry: null, reason: 'missing_root' };
  const manifestPath = resolveManifestPath(dataRootDir, season);
  const seasonDir = path.resolve(dataRootDir, String(season));
  if (!fs.existsSync(seasonDir)) {
    fs.mkdirSync(seasonDir, { recursive: true });
  }
  const raw = readManifestRaw(manifestPath);
  const entries = Array.isArray(raw)
    ? raw.map(normalizeManifestEntry).filter(Boolean)
    : (Array.isArray(raw?.entries) ? raw.entries.map(normalizeManifestEntry).filter(Boolean) : []);

  const existing = resolveManifestEntryForEvent(entries, { eventId, tournamentSlug, tournamentName });
  if (existing) {
    return { entries, updated: false, entry: existing, reason: 'exists' };
  }

  const nameValue = String(tournamentName || '').trim();
  const slugValue = String(tournamentSlug || '').trim() || slugifyTournament(nameValue);
  if (!nameValue && !slugValue) {
    return { entries, updated: false, entry: null, reason: 'missing_name' };
  }

  const dateValue = String(date || '').trim() || formatDateUtc(getThursdayOfWeek());
  if (!dateValue) {
    return { entries, updated: false, entry: null, reason: 'missing_date' };
  }

  const placeholder = {
    eventId: null,
    tournamentSlug: slugValue,
    tournamentName: nameValue || slugValue,
    date: dateValue
  };

  const nextEntries = [...entries, placeholder]
    .map(normalizeManifestEntry)
    .filter(Boolean)
    .sort((a, b) => {
      const timeA = parseDateToUtcMs(a.date);
      const timeB = parseDateToUtcMs(b.date);
      if (Number.isNaN(timeA) || Number.isNaN(timeB)) return 0;
      return timeA - timeB;
    });

  writeManifestEntries(manifestPath, raw, nextEntries);
  logger?.log?.(`ℹ️  Manifest placeholder added: ${placeholder.tournamentName} (${placeholder.date})`);
  return { entries: nextEntries, updated: true, entry: placeholder, reason: 'inserted' };
};

module.exports = {
  slugifyTournament,
  parseDateToUtcMs,
  loadSeasonManifestEntries,
  resolveManifestEntryForEvent,
  resolveNextManifestEntry,
  resolvePreviousManifestEntry,
  resolveEventStartDateFromManifest,
  ensureManifestEntry,
  resolveApproachSnapshotPairForEvent
};
