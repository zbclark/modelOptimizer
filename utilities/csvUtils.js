const fs = require('fs');
const { parse } = require('csv-parse/sync');

const parseCsvRows = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    relax_column_count: true,
    skip_empty_lines: false
  });
};

const normalizeHeader = value => String(value || '').trim().toLowerCase();

const findHeaderRowIndex = (rows, requiredHeaders = []) => {
  const normalizedRequired = requiredHeaders.map(header => normalizeHeader(header));
  let bestIndex = -1;
  let bestScore = 0;

  rows.forEach((row, idx) => {
    const cells = row.map(cell => normalizeHeader(cell));
    const matches = normalizedRequired.filter(header => cells.includes(header)).length;
    if (matches > bestScore) {
      bestScore = matches;
      bestIndex = idx;
    }
  });

  if (bestScore === 0) return -1;
  return bestIndex;
};

const buildHeaderIndexMap = headers => {
  const map = new Map();
  headers.forEach((header, idx) => {
    const normalized = normalizeHeader(header);
    if (!map.has(normalized)) map.set(normalized, idx);
  });
  return map;
};

module.exports = {
  parseCsvRows,
  normalizeHeader,
  findHeaderRowIndex,
  buildHeaderIndexMap
};
