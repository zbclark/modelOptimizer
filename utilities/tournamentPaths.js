const fs = require('fs');
const path = require('path');

const { slugifyTournament } = require('./manifestUtils');

const DEFAULT_OUTPUT_DIR_NAME = 'validation_outputs';

const listSeasonTournamentDirs = (dataRootDir, season) => {
  if (!dataRootDir || !season) return [];
  const seasonDir = path.resolve(dataRootDir, String(season));
  if (!fs.existsSync(seasonDir)) return [];
  return fs
    .readdirSync(seasonDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => entry.name !== DEFAULT_OUTPUT_DIR_NAME)
    .filter(entry => entry.name.toLowerCase() !== 'all')
    .map(entry => path.resolve(seasonDir, entry.name));
};

const normalizeTournamentNameForSeason = (value, season) => {
  const raw = String(value || '').trim();
  if (!raw || !season) return raw;
  const seasonTag = `(${season})`;
  if (raw.endsWith(seasonTag)) {
    return raw.slice(0, raw.length - seasonTag.length).trim();
  }
  return raw;
};

const buildSlugCandidates = ({ tournamentSlug, tournamentName, tournamentDir }) => {
  const baseSlug = tournamentSlug || slugifyTournament(tournamentName);
  const fromDir = tournamentDir ? path.basename(tournamentDir) : null;
  const normalizedBase = baseSlug ? baseSlug.replace(/_/g, '-') : null;
  const withoutThe = normalizedBase ? normalizedBase.replace(/^the-/, '') : null;
  const candidates = [fromDir, baseSlug, normalizedBase, withoutThe].filter(Boolean);
  const expanded = new Set();
  candidates.forEach(candidate => {
    expanded.add(candidate);
    expanded.add(candidate.replace(/-/g, '_'));
    expanded.add(candidate.replace(/_/g, '-'));
    if (!candidate.startsWith('the-')) {
      expanded.add(`the-${candidate}`);
      expanded.add(`the-${candidate}`.replace(/-/g, '_'));
    }
  });
  return Array.from(expanded).filter(Boolean);
};

const inferTournamentNameFromInputs = (inputsDir, season, fallbackName) => {
  if (!inputsDir || !fs.existsSync(inputsDir)) return fallbackName || null;
  const files = fs.readdirSync(inputsDir);
  const patterns = [
    season ? new RegExp(`^(.*) \(${season}\) - Configuration Sheet\\.csv$`, 'i') : null,
    season ? new RegExp(`^(.*) \(${season}\) - Historical Data\\.csv$`, 'i') : null,
    new RegExp('^(.*) - Configuration Sheet\\.csv$', 'i'),
    new RegExp('^(.*) - Historical Data\\.csv$', 'i')
  ].filter(Boolean);

  for (const file of files) {
    for (const pattern of patterns) {
      const match = file.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  }

  return fallbackName || null;
};

const resolveExistingPath = (dir, candidates = [], suffix) => {
  if (!dir || !suffix) return null;
  for (const candidate of candidates) {
    const filePath = path.resolve(dir, `${candidate}${suffix}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
};

const resolveExistingPathMulti = (dir, candidates = [], suffixes = []) => {
  for (const suffix of suffixes) {
    const direct = resolveExistingPath(dir, candidates, suffix);
    if (direct) return direct;
  }
  return null;
};

const resolveResultsPath = (dir, candidates, primarySlug, suffixes = []) => {
  if (!dir || !suffixes.length) return null;
  const existing = resolveExistingPathMulti(dir, candidates, suffixes);
  if (existing) return existing;
  return path.resolve(dir, `${primarySlug}${suffixes[0]}`);
};

const resolveInputCsvPath = ({ inputsDir, season, suffix }) => {
  if (!inputsDir || !suffix || !fs.existsSync(inputsDir)) return null;
  const files = fs.readdirSync(inputsDir).filter(file => file.toLowerCase().includes(suffix.toLowerCase()));
  if (files.length === 0) return null;
  if (season) {
    const seasonTag = `(${season})`;
    const seasonMatch = files.find(file => file.includes(seasonTag));
    if (seasonMatch) return path.resolve(inputsDir, seasonMatch);
  }
  return path.resolve(inputsDir, files[0]);
};

const resolveRankingPath = (dir, candidates, suffix) => {
  const direct = resolveExistingPath(dir, candidates, suffix);
  if (direct) return direct;
  if (!dir || !fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.endsWith(suffix));
  if (!entries.length) return null;
  const withStats = entries.map(name => {
    const filePath = path.resolve(dir, name);
    let mtime = 0;
    try {
      mtime = fs.statSync(filePath).mtimeMs || 0;
    } catch {
      mtime = 0;
    }
    return { name, path: filePath, mtime };
  });
  withStats.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return withStats[0]?.path || null;
};

const resolveTournamentDir = (dataRootDir, season, tournamentName, tournamentSlug) => {
  if (!dataRootDir || !season) return null;
  const seasonDir = path.resolve(dataRootDir, String(season));
  const normalized = tournamentSlug || slugifyTournament(tournamentName);
  if (!fs.existsSync(seasonDir)) return normalized ? path.resolve(seasonDir, normalized) : seasonDir;
  const entries = fs.readdirSync(seasonDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== DEFAULT_OUTPUT_DIR_NAME)
    .map(entry => entry.name);
  if (normalized && entries.includes(normalized)) return path.resolve(seasonDir, normalized);
  if (normalized) {
    const tokens = normalized.split('-').filter(Boolean);
    if (tokens.length > 0) {
      let best = null;
      entries.forEach(name => {
        const dirTokens = name.split('-').filter(Boolean);
        const overlap = tokens.filter(token => dirTokens.includes(token)).length;
        if (!best || overlap > best.overlap) {
          best = { name, overlap };
        }
      });
      if (best && best.overlap > 0) {
        return path.resolve(seasonDir, best.name);
      }
    }
  }
  return normalized ? path.resolve(seasonDir, normalized) : seasonDir;
};

module.exports = {
  DEFAULT_OUTPUT_DIR_NAME,
  listSeasonTournamentDirs,
  normalizeTournamentNameForSeason,
  buildSlugCandidates,
  inferTournamentNameFromInputs,
  resolveExistingPath,
  resolveExistingPathMulti,
  resolveResultsPath,
  resolveInputCsvPath,
  resolveRankingPath,
  resolveTournamentDir
};
