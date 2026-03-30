const DEFAULT_TIMEZONE = String(process.env.MODEL_TIMEZONE || 'America/Chicago').trim();

const getTimeZone = override => {
  const value = String(override || '').trim();
  return value || DEFAULT_TIMEZONE;
};

const parseOffsetToIso = offsetText => {
  if (!offsetText) return null;
  const match = String(offsetText).match(/(GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return null;
  const [, , sign, hoursRaw, minutesRaw] = match;
  const hours = String(hoursRaw || '').padStart(2, '0');
  const minutes = String(minutesRaw || '00').padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
};

const UTC_TIMESTAMP_WITH_LABEL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*UTC$/i;
const ISO_TIMESTAMP_WITH_TZ = /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const SIMPLE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const CENTRAL_LABEL_REGEX = /\bCT\b|\bCST\b|\bCDT\b/i;

const parseUtcTimestampString = value => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const utcMatch = trimmed.match(UTC_TIMESTAMP_WITH_LABEL);
  if (utcMatch) {
    const [, year, month, day, hour, minute, second] = utcMatch;
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ));
  }

  if (ISO_TIMESTAMP_WITH_TZ.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (SIMPLE_TIMESTAMP.test(trimmed)) {
    const parsed = new Date(`${trimmed}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const parseTimestampToMs = value => {
  const parsed = parseUtcTimestampString(value);
  if (!parsed) return null;
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? null : ms;
};

const buildParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset'
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach(part => {
    if (part.type && part.value) {
      map[part.type] = part.value;
    }
  });
  return map;
};

const formatTimestamp = (dateValue = new Date(), timeZoneOverride = null) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const timeZone = getTimeZone(timeZoneOverride);
  try {
    const parts = buildParts(date, timeZone);
    const year = parts.year;
    const month = parts.month;
    const day = parts.day;
    const hour = parts.hour;
    const minute = parts.minute;
    const second = parts.second;
    const offset = parseOffsetToIso(parts.timeZoneName);
    if (!year || !month || !day || !hour || !minute || !second || !offset) {
      return date.toISOString();
    }
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
  } catch {
    return date.toISOString();
  }
};

const formatCentralTimestamp = (dateValue = new Date(), timeZoneOverride = null, label = 'CT') => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const timeZone = getTimeZone(timeZoneOverride);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map = {};
    parts.forEach(part => {
      if (part.type && part.value) {
        map[part.type] = part.value;
      }
    });
    if (!map.year || !map.month || !map.day || !map.hour || !map.minute || !map.second) {
      return null;
    }
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} ${label}`;
  } catch {
    return null;
  }
};

const buildCentralTimestampFromUtcString = (value, options = {}) => {
  if (!value) return null;
  const parsed = parseUtcTimestampString(value);
  if (!parsed) return null;
  const label = typeof options.label === 'string' ? options.label : 'CT';
  const timeZoneOverride = options.timeZoneOverride || null;
  return formatCentralTimestamp(parsed, timeZoneOverride, label);
};

const convertTimestampStringToCentral = (value, options = {}) => {
  if (typeof value !== 'string') return value;
  if (!value.trim() || CENTRAL_LABEL_REGEX.test(value)) return value;
  const parsed = parseUtcTimestampString(value);
  if (!parsed) return value;
  const label = typeof options.label === 'string' ? options.label : 'CT';
  const formatted = formatCentralTimestamp(parsed, options.timeZoneOverride || null, label);
  return formatted || value;
};

const convertPayloadTimestampsToCentral = (payload, options = {}) => {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'string') return convertTimestampStringToCentral(payload, options);
  if (Array.isArray(payload)) {
    return payload.map(entry => convertPayloadTimestampsToCentral(entry, options));
  }
  if (typeof payload === 'object') {
    const output = {};
    Object.entries(payload).forEach(([key, value]) => {
      output[key] = convertPayloadTimestampsToCentral(value, options);
    });
    return output;
  }
  return payload;
};

const formatDateKey = (dateValue = new Date(), timeZoneOverride = null) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const timeZone = getTimeZone(timeZoneOverride);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const map = {};
    parts.forEach(part => {
      if (part.type && part.value) map[part.type] = part.value;
    });
    if (!map.year || !map.month || !map.day) return date.toISOString().slice(0, 10);
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

const formatTimestampForFilename = (dateValue = new Date(), timeZoneOverride = null) => {
  const formatted = formatTimestamp(dateValue, timeZoneOverride);
  if (!formatted) return null;
  return formatted.replace(/[:.]/g, '-');
};

module.exports = {
  DEFAULT_TIMEZONE,
  getTimeZone,
  formatTimestamp,
  formatDateKey,
  formatTimestampForFilename,
  formatCentralTimestamp,
  buildCentralTimestampFromUtcString,
  parseTimestampToMs,
  convertTimestampStringToCentral,
  convertPayloadTimestampsToCentral
};
