/**
 * Module: courseTypeUtils
 * Purpose: Course type detection + metric grouping helpers.
 */

const { normalizeMetricLabel } = require('./metricLabels');

const DEFAULT_DETECTED_TYPE_DOMINANCE_RATIO = 1.12;
const DEFAULT_DETECTED_TYPE_MIN_SCORE = 0.0001;
const DEFAULT_BALANCED_GROUP_WEIGHTS = {
  'Driving Performance': 1 / 9,
  'Approach - Short (<100)': 1 / 9,
  'Approach - Mid (100-150)': 1 / 9,
  'Approach - Long (150-200)': 1 / 9,
  'Approach - Very Long (>200)': 1 / 9,
  'Putting': 1 / 9,
  'Around the Green': 1 / 9,
  'Scoring': 1 / 9,
  'Course Management': 1 / 9
};

const getMetricGroupings = () => ({
  'Driving Performance': [
    'Driving Distance', 'Driving Accuracy', 'SG OTT'
  ],
  'Approach - Short (<100)': [
    'Approach <100 GIR', 'Approach <100 SG', 'Approach <100 Prox'
  ],
  'Approach - Mid (100-150)': [
    'Approach <150 FW GIR', 'Approach <150 FW SG', 'Approach <150 FW Prox',
    'Approach <150 Rough GIR', 'Approach <150 Rough SG', 'Approach <150 Rough Prox'
  ],
  'Approach - Long (150-200)': [
    'Approach <200 FW GIR', 'Approach <200 FW SG', 'Approach <200 FW Prox',
    'Approach >150 Rough GIR', 'Approach >150 Rough SG', 'Approach >150 Rough Prox'
  ],
  'Approach - Very Long (>200)': [
    'Approach >200 FW GIR', 'Approach >200 FW SG', 'Approach >200 FW Prox'
  ],
  'Putting': [
    'SG Putting'
  ],
  'Around the Green': [
    'SG Around Green'
  ],
  'Scoring': [
    'SG T2G', 'Scoring Average', 'Birdie Chances Created',
    'Birdies or Better', 'Greens in Regulation',
    'Scoring: Approach <100 SG', 'Scoring: Approach <150 FW SG',
    'Scoring: Approach <150 Rough SG', 'Scoring: Approach >150 Rough SG',
    'Scoring: Approach <200 FW SG', 'Scoring: Approach >200 FW SG'
  ],
  'Course Management': [
    'Scrambling', 'Great Shots', 'Poor Shot Avoidance',
    'Course Management: Approach <100 Prox', 'Course Management: Approach <150 FW Prox',
    'Course Management: Approach <150 Rough Prox', 'Course Management: Approach >150 Rough Prox',
    'Course Management: Approach <200 FW Prox', 'Course Management: Approach >200 FW Prox'
  ]
});

const getMetricGroup = metricName => {
  const groupings = getMetricGroupings();
  const normalized = normalizeMetricLabel(metricName);
  for (const [groupName, metrics] of Object.entries(groupings)) {
    if (metrics.includes(normalized)) {
      return groupName;
    }
  }
  return null;
};

const determineDetectedCourseType = metrics => {
  const entries = Array.isArray(metrics) ? metrics : [];
  if (!entries.length) return 'BALANCED';

  const sorted = entries
    .slice()
    .sort((a, b) => Math.abs(b.correlation || 0) - Math.abs(a.correlation || 0))
    .slice(0, 15);

  let powerScore = 0;
  let technicalScore = 0;
  let balancedScore = 0;

  const drivingCorrelationMap = new Map([
    ['Driving Distance', 0],
    ['SG OTT', 0],
    ['Driving Accuracy', 0]
  ]);

  sorted.forEach(entry => {
    const group = getMetricGroup(entry.metric);
    if (!group) return;
    const strength = Math.abs(entry.correlation || 0);
    if (strength === 0) return;
    if (group === 'Driving Performance') {
      powerScore += strength;
      if (drivingCorrelationMap.has(entry.metric)) {
        drivingCorrelationMap.set(entry.metric, strength);
      }
    } else if (group.startsWith('Approach') || group === 'Course Management') {
      technicalScore += strength;
    } else if (group === 'Putting' || group === 'Around the Green' || group === 'Scoring') {
      balancedScore += strength;
    }
  });

  if (powerScore === 0 && technicalScore === 0 && balancedScore === 0) return 'BALANCED';

  const scores = [
    { type: 'POWER', score: powerScore },
    { type: 'TECHNICAL', score: technicalScore },
    { type: 'BALANCED', score: balancedScore }
  ].sort((a, b) => b.score - a.score);

  const topScore = scores[0].score || 0;
  const runnerUp = scores[1].score || 0;
  if (topScore >= DEFAULT_DETECTED_TYPE_MIN_SCORE) {
    if (runnerUp === 0 || topScore >= runnerUp * DEFAULT_DETECTED_TYPE_DOMINANCE_RATIO) {
      return scores[0].type;
    }
  }
  return 'BALANCED';
};

const calculateRecommendedWeight = (metricName, correlation, options = {}) => {
  const templateWeight = options.templateWeight || 0;
  const groupMaxCorrelations = options.groupMaxCorrelations || {};

  const safeCorrelation = Number.isFinite(correlation) ? correlation : 0;
  const metricGroup = getMetricGroup(metricName);
  const maxAbsCorr = metricGroup && groupMaxCorrelations[metricGroup] > 0
    ? groupMaxCorrelations[metricGroup]
    : 0;
  const ratio = maxAbsCorr > 0 ? safeCorrelation / maxAbsCorr : 0;

  let baseWeight = 0;
  if (templateWeight && templateWeight > 0) {
    baseWeight = templateWeight;
  }

  let recommendedWeight = baseWeight > 0 ? baseWeight * ratio : safeCorrelation;
  if ((metricName === 'SG Around Green' || metricName === 'SG Putting') && recommendedWeight < 0) {
    recommendedWeight = Math.abs(recommendedWeight);
  }

  return recommendedWeight;
};

module.exports = {
  DEFAULT_DETECTED_TYPE_DOMINANCE_RATIO,
  DEFAULT_DETECTED_TYPE_MIN_SCORE,
  DEFAULT_BALANCED_GROUP_WEIGHTS,
  getMetricGroupings,
  getMetricGroup,
  determineDetectedCourseType,
  calculateRecommendedWeight
};
