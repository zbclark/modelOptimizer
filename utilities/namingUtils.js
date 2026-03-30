/**
 * Module: namingUtils
 * Purpose: Naming helpers for display labels.
 */

const formatTournamentDisplayName = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
};

module.exports = {
  formatTournamentDisplayName
};
