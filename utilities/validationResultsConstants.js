/**
 * Module: validationResultsConstants
 * Purpose: Shared results schema constants for validation workflows.
 */

const RESULTS_HEADERS = [
  'Performance Analysis',
  'DG ID',
  'Player Name',
  'Model Rank',
  'Finish Position',
  'Score',
  'SG Total',
  'SG Total - Model',
  'Driving Distance',
  'Driving Distance - Model',
  'Driving Accuracy',
  'Driving Accuracy - Model',
  'SG T2G',
  'SG T2G - Model',
  'SG Approach',
  'SG Approach - Model',
  'SG Around Green',
  'SG Around Green - Model',
  'SG OTT',
  'SG OTT - Model',
  'SG Putting',
  'SG Putting - Model',
  'Greens in Regulation',
  'Greens in Regulation - Model',
  'Fairway Proximity',
  'Fairway Proximity - Model',
  'Rough Proximity',
  'Rough Proximity - Model',
  'SG BS',
  'Scoring Average',
  'Birdies or Better',
  'Scrambling',
  'Great Shots',
  'Poor Shot Avoidance'
];

const RESULTS_METRIC_TYPES = {
  LOWER_BETTER: new Set([
    'Fairway Proximity',
    'Rough Proximity',
    'Fairway Proximity - Model',
    'Rough Proximity - Model'
  ]),
  HIGHER_BETTER: new Set([
    'SG Total',
    'SG T2G',
    'SG Approach',
    'SG Around Green',
    'SG OTT',
    'SG Putting',
    'SG BS',
    'SG Total - Model',
    'SG T2G - Model',
    'SG Approach - Model',
    'SG Around Green - Model',
    'SG OTT - Model',
    'SG Putting - Model',
    'Driving Distance',
    'Driving Distance - Model',
    'Driving Accuracy',
    'Driving Accuracy - Model',
    'Greens in Regulation',
    'Greens in Regulation - Model'
  ]),
  PERCENTAGE: new Set([
    'Driving Accuracy',
    'Driving Accuracy - Model',
    'Greens in Regulation',
    'Greens in Regulation - Model'
  ]),
  HAS_MODEL: new Set([
    'SG Total',
    'SG T2G',
    'SG Approach',
    'SG Around Green',
    'SG OTT',
    'SG Putting',
    'Driving Distance',
    'Driving Accuracy',
    'Greens in Regulation',
    'Fairway Proximity',
    'Rough Proximity',
    'WAR'
  ]),
  DECIMAL_3: new Set([
    'SG Total',
    'SG T2G',
    'SG Approach',
    'SG Around Green',
    'SG OTT',
    'SG Putting',
    'SG BS',
    'SG Total - Model',
    'SG T2G - Model',
    'SG Approach - Model',
    'SG Around Green - Model',
    'SG OTT - Model',
    'SG Putting - Model'
  ]),
  DECIMAL_2: new Set([
    'Driving Distance',
    'Driving Distance - Model',
    'Fairway Proximity',
    'Fairway Proximity - Model',
    'Rough Proximity',
    'Rough Proximity - Model'
  ]),
  RANK: new Set(['Model Rank', 'Finish Position'])
};

const RESULT_METRIC_FIELDS = [
  { label: 'SG Total', key: 'sg_total' },
  { label: 'Driving Distance', key: 'driving_dist' },
  { label: 'Driving Accuracy', key: 'driving_acc' },
  { label: 'SG T2G', key: 'sg_t2g' },
  { label: 'SG Approach', key: 'sg_app' },
  { label: 'SG Around Green', key: 'sg_arg' },
  { label: 'SG OTT', key: 'sg_ott' },
  { label: 'SG Putting', key: 'sg_putt' },
  { label: 'Greens in Regulation', key: 'gir' },
  { label: 'Fairway Proximity', key: 'prox_fw' },
  { label: 'Rough Proximity', key: 'prox_rgh' },
  { label: 'SG BS', key: 'sg_bs', hasModel: false },
  { label: 'Scoring Average', key: 'scoring_avg' },
  { label: 'Birdies or Better', key: 'birdies_or_better' },
  { label: 'Scrambling', key: 'scrambling' },
  { label: 'Great Shots', key: 'great_shots' },
  { label: 'Poor Shot Avoidance', key: 'poor_shot_avoid' }
];

const RESULTS_REQUIRED_FIELDS = [
  'Scoring Average',
  'Birdies or Better',
  'Scrambling',
  'Great Shots',
  'Poor Shot Avoidance'
];

module.exports = {
  RESULTS_HEADERS,
  RESULTS_METRIC_TYPES,
  RESULT_METRIC_FIELDS,
  RESULTS_REQUIRED_FIELDS
};
