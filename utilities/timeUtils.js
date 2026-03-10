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
  } catch (error) {
    return date.toISOString();
  }
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
  } catch (error) {
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
  formatTimestampForFilename
};
