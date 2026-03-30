/**
 * Module: metricLabels
 * Purpose: Metric label normalization helpers.
 */

const METRIC_ALIASES = {
  'Poor Shots': 'Poor Shot Avoidance',
  'Scoring - Approach <100 SG': 'Scoring: Approach <100 SG',
  'Scoring - Approach <150 FW SG': 'Scoring: Approach <150 FW SG',
  'Scoring - Approach <150 Rough SG': 'Scoring: Approach <150 Rough SG',
  'Scoring - Approach >150 Rough SG': 'Scoring: Approach >150 Rough SG',
  'Scoring - Approach <200 FW SG': 'Scoring: Approach <200 FW SG',
  'Scoring - Approach >200 FW SG': 'Scoring: Approach >200 FW SG',
  'Course Management - Approach <100 Prox': 'Course Management: Approach <100 Prox',
  'Course Management - Approach <150 FW Prox': 'Course Management: Approach <150 FW Prox',
  'Course Management - Approach <150 Rough Prox': 'Course Management: Approach <150 Rough Prox',
  'Course Management - Approach >150 Rough Prox': 'Course Management: Approach >150 Rough Prox',
  'Course Management - Approach <200 FW Prox': 'Course Management: Approach <200 FW Prox',
  'Course Management - Approach >200 FW Prox': 'Course Management: Approach >200 FW Prox'
};

const normalizeMetricLabel = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return METRIC_ALIASES[raw] || raw;
};

module.exports = {
  METRIC_ALIASES,
  normalizeMetricLabel
};
