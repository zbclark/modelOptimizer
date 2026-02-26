const fs = require('fs');
const { parse } = require('csv-parse/sync');

const CONFIG_PARSER_WARN_BLANKS = (() => {
  const normalized = String(process.env.CONFIG_PARSER_WARN_BLANKS || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
})();

const isBlank = (value) => {
  if (value === null || value === undefined) return true;
  return String(value).trim() === '';
};

const cleanNumber = (value, fallbackOrOptions = 0) => {
  const options = (fallbackOrOptions && typeof fallbackOrOptions === 'object')
    ? fallbackOrOptions
    : { fallback: fallbackOrOptions };

  const fallback = Number.isFinite(options.fallback) ? options.fallback : 0;
  const label = options.label ? String(options.label) : null;
  const warnOnBlank = options.warnOnBlank !== undefined ? Boolean(options.warnOnBlank) : true;
  const warnOnParseFail = options.warnOnParseFail !== undefined ? Boolean(options.warnOnParseFail) : true;

  if (isBlank(value)) {
    if (CONFIG_PARSER_WARN_BLANKS && warnOnBlank) {
      const suffix = label ? ` (${label})` : '';
      console.warn(`[configParser] Blank numeric value${suffix}; using fallback ${fallback}`);
    }
    return fallback;
  }

  const raw = String(value).replace(/[^0-9.\-]/g, '');
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed)) return parsed;

  if (CONFIG_PARSER_WARN_BLANKS && warnOnParseFail) {
    const suffix = label ? ` (${label})` : '';
    console.warn(`[configParser] Invalid numeric value${suffix}: ${JSON.stringify(value)}; using fallback ${fallback}`);
  }
  return fallback;
};

const loadConfigCells = (configCsvPath) => {
  const raw = fs.readFileSync(configCsvPath, 'utf8');
  return parse(raw, {
    skip_empty_lines: false,
    relax_column_count: true
  });
};

const getCell = (cells, row, col) => {
  if (!cells[row - 1]) return null;
  return cells[row - 1][col - 1] || null;
};

const normalizeCourseName = value => {
  if (!value) return null;
  const raw = String(value).split('·')[0].trim();
  const stripped = raw.replace(/\(.*?\)/g, '').trim();
  if (!stripped) return null;
  return stripped
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

const findCourseName = cells => {
  for (let row = 0; row < cells.length; row++) {
    const rowValues = cells[row] || [];
    for (let col = 0; col < rowValues.length; col++) {
      if (String(rowValues[col] || '').trim() === '✅ Course') {
        return rowValues[col + 1] || null;
      }
    }
  }
  return null;
};

const parseEventIds = (value) => String(value || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => id && id !== '');

const collectEventIds = (cells, startRow, endRow, col) => {
  const ids = [];
  for (let row = startRow; row <= endRow; row++) {
    const cellValue = getCell(cells, row, col);
    if (!cellValue) continue;
    parseEventIds(cellValue).forEach(id => ids.push(id));
  }
  return ids;
};

const toBoolean = value => {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === 'y';
};

const getSharedConfig = (configCsvPath) => {
  const cells = loadConfigCells(configCsvPath);
  const readCell = (row, col) => getCell(cells, row, col);

  const readNumber = (row, col, fallback, label) => cleanNumber(readCell(row, col), {
    fallback,
    label: label || `R${row}C${col}`
  });

  const currentEventId = String(readCell(9, 7) || '2');
  const similarCourseIds = collectEventIds(cells, 33, 37, 7);
  const puttingCourseIds = collectEventIds(cells, 40, 44, 7);

  const courseSetupWeights = {
    under100: readNumber(17, 16, 0, 'courseSetupWeights.under100 (R17C16)'),
    from100to150: readNumber(18, 16, 0, 'courseSetupWeights.from100to150 (R18C16)'),
    from150to200: readNumber(19, 16, 0, 'courseSetupWeights.from150to200 (R19C16)'),
    over200: readNumber(20, 16, 0, 'courseSetupWeights.over200 (R20C16)')
  };

  const similarCoursesWeight = readNumber(33, 8, 0.7, 'similarCoursesWeight (R33C8)');
  const puttingCoursesWeight = readNumber(40, 8, 0.75, 'puttingCoursesWeight (R40C8)');

  const pastPerformanceEnabled = String(readCell(27, 6)).trim() === 'Yes';
  const pastPerformanceWeight = readNumber(27, 7, 0, 'pastPerformanceWeight (R27C7)');

  const courseNum = String(readCell(10, 7) || '').trim() || null;

  const courseNameRaw = findCourseName(cells);
  const courseNameKey = normalizeCourseName(courseNameRaw);

  const powerChecked = readCell(33, 2);
  const technicalChecked = readCell(34, 2);
  const balancedChecked = readCell(35, 2);
  const courseType = toBoolean(powerChecked)
    ? 'POWER'
    : (toBoolean(technicalChecked)
      ? 'TECHNICAL'
      : (toBoolean(balancedChecked)
        ? 'BALANCED'
        : null));

  return {
    cells,
    getCell: readCell,
    currentEventId,
    similarCourseIds,
    puttingCourseIds,
    similarCoursesWeight,
    puttingCoursesWeight,
    courseSetupWeights,
    pastPerformanceEnabled,
    pastPerformanceWeight,
    courseNameRaw,
    courseNameKey,
    courseType,
    courseNum
  };
};

module.exports = {
  cleanNumber,
  loadConfigCells,
  getCell,
  parseEventIds,
  collectEventIds,
  getSharedConfig,
  normalizeCourseName,
  findCourseName
};
