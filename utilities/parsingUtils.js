/**
 * Module: parsingUtils
 * Purpose: Shared parsing helpers for numeric + position fields.
 */

const parseFinishPosition = value => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'CUT' || raw === 'WD' || raw === 'DQ') return null;
  if (raw.startsWith('T')) {
    const parsed = parseInt(raw.substring(1), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (/^\d+T$/.test(raw)) {
    const parsed = parseInt(raw.replace('T', ''), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizeFinishPosition = value => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'CUT' || raw === 'WD' || raw === 'DQ') return null;
  if (raw.startsWith('T')) {
    const parsed = parseInt(raw.substring(1), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (/^\d+T$/.test(raw)) {
    const parsed = parseInt(raw.replace('T', ''), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseNumericValue = value => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '').replace(/%/g, '');
  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed)) return null;
  if (raw.includes('%') && parsed > 1.5) {
    return parsed / 100;
  }
  return parsed;
};

const formatPositionText = value => {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw;
};

module.exports = {
  parseFinishPosition,
  normalizeFinishPosition,
  parseNumericValue,
  formatPositionText
};
