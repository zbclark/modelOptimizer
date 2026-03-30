/**
 * Module: envParser
 * Purpose: Shared environment variable parsing helpers.
 */

const normalizeEnvValue = name => String(process.env[name] ?? '').trim();

const parseEnvString = (name, defaultValue = '') => {
  const raw = normalizeEnvValue(name);
  if (raw === '') return defaultValue;
  return raw;
};

const parseEnvBoolean = (name, defaultValue = false) => {
  const raw = normalizeEnvValue(name).toLowerCase();
  if (raw === '') return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return defaultValue;
};

const parseEnvNumber = (name, defaultValue = null, options = {}) => {
  const raw = normalizeEnvValue(name);
  if (raw === '') return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  const { min = null, max = null } = options;
  if (Number.isFinite(min) && parsed < min) return min;
  if (Number.isFinite(max) && parsed > max) return max;
  return parsed;
};

const parseEnvInteger = (name, defaultValue = null, options = {}) => {
  const raw = normalizeEnvValue(name);
  if (raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  const { min = null, max = null } = options;
  if (Number.isFinite(min) && parsed < min) return min;
  if (Number.isFinite(max) && parsed > max) return max;
  return parsed;
};

module.exports = {
  parseEnvString,
  parseEnvBoolean,
  parseEnvNumber,
  parseEnvInteger
};
