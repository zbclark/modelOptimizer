const fs = require('fs');
const path = require('path');

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

const formatDateUtc = dateValue => {
  if (!dateValue) return '';
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
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
  if (currentIndex === -1) return sorted.find(entry => entry.time < currentTime) || null;
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
  ensureManifestEntry
};
