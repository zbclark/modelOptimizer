const fs = require('fs');
const path = require('path');
const { ensureDirectory } = require('./fileUtils');
const { OUTPUT_NAMES } = require('./validationOutputNames');
const { formatTournamentDisplayName } = require('./namingUtils');

const writeCourseTypeClassification = (outputDir, classification) => {
  ensureDirectory(outputDir);
  const jsonPath = path.resolve(outputDir, `${OUTPUT_NAMES.courseTypeClassification}.json`);
  const csvPath = path.resolve(outputDir, `${OUTPUT_NAMES.courseTypeClassification}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify(classification, null, 2));

  const toCsvRow = values => values
    .map(value => (value === null || value === undefined ? '' : JSON.stringify(value)))
    .join(',');

  const entries = Array.isArray(classification?.entries) ? classification.entries : [];
  const grouped = {
    POWER: [],
    TECHNICAL: [],
    BALANCED: []
  };

  entries.forEach(entry => {
    const courseType = String(entry.courseType || '').trim().toUpperCase();
    if (!grouped[courseType]) return;
    grouped[courseType].push(entry);
  });

  const descriptions = {
    POWER: 'Driving Distance & Power Metrics Dominant',
    TECHNICAL: 'Short Game & Approach Metrics Dominant',
    BALANCED: 'Multiple Metric Types Equally Important'
  };

  const lines = [];
  lines.push(toCsvRow(['COURSE TYPE CLASSIFICATION (Based on Correlation Patterns)']));
  lines.push('');

  ['POWER', 'TECHNICAL', 'BALANCED'].forEach(type => {
    const items = grouped[type] || [];
    if (items.length === 0) return;
    lines.push(toCsvRow([
      `${type} - ${descriptions[type]} (${items.length} courses)`
    ]));
    lines.push(toCsvRow(['Tournaments:']));
    items
      .map(entry => entry.displayName || formatTournamentDisplayName(entry.tournament))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .forEach(name => {
        lines.push(toCsvRow([`  • ${name}`]));
      });
    lines.push('');
  });

  const totalTournaments = entries.length;
  lines.push(toCsvRow(['SUMMARY']));
  lines.push(toCsvRow([`POWER Courses: ${grouped.POWER.length}`]));
  lines.push(toCsvRow([`TECHNICAL Courses: ${grouped.TECHNICAL.length}`]));
  lines.push(toCsvRow([`BALANCED Courses: ${grouped.BALANCED.length}`]));
  lines.push(toCsvRow([`Total Tournaments: ${totalTournaments}`]));

  fs.writeFileSync(csvPath, lines.join('\n'));
  return { jsonPath, csvPath };
};

module.exports = {
  writeCourseTypeClassification
};
