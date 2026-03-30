const fs = require('fs');
const path = require('path');
const { ensureDirectory } = require('./fileUtils');
const { RESULTS_HEADERS } = require('./validationResultsConstants');

const writeTournamentResultsCsv = (csvPath, rows, meta = {}) => {
  if (!csvPath) return null;
  ensureDirectory(path.dirname(csvPath));
  const lines = [];
  lines.push('');
  lines.push([`Tournament: ${meta.tournament || ''}`, `Last updated: ${meta.lastUpdated || ''}`].join(','));
  lines.push([`Course: ${meta.courseName || ''}`, `Found ${rows.length} players from ${meta.source || ''}`].join(','));
  lines.push([`Data Date: ${meta.generatedAt || ''}`].join(','));
  lines.push(RESULTS_HEADERS.join(','));
  rows.forEach(row => {
    const line = RESULTS_HEADERS.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      return JSON.stringify(value);
    }).join(',');
    lines.push(line);
  });
  fs.writeFileSync(csvPath, lines.join('\n'));
  return csvPath;
};

const writeTournamentResultsSnapshot = (resultsJsonPath, payload) => {
  if (!resultsJsonPath) return null;
  ensureDirectory(path.dirname(resultsJsonPath));
  fs.writeFileSync(resultsJsonPath, JSON.stringify(payload, null, 2));
  return resultsJsonPath;
};

const writeResultsSheetCsv = (csvPath, csvContent) => {
  if (!csvPath) return null;
  ensureDirectory(path.dirname(csvPath));
  fs.writeFileSync(csvPath, csvContent || '');
  return csvPath;
};

module.exports = {
  writeTournamentResultsCsv,
  writeTournamentResultsSnapshot,
  writeResultsSheetCsv
};
