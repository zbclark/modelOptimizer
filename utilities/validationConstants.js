/**
 * Module: validationConstants
 * Purpose: Shared constants for validation workflows.
 */

const METRIC_ORDER = [
  'Driving Distance',
  'Driving Accuracy',
  'SG OTT',
  'Approach <100 GIR',
  'Approach <100 SG',
  'Approach <100 Prox',
  'Approach <150 FW GIR',
  'Approach <150 FW SG',
  'Approach <150 FW Prox',
  'Approach <150 Rough GIR',
  'Approach <150 Rough SG',
  'Approach <150 Rough Prox',
  'Approach <200 FW GIR',
  'Approach <200 FW SG',
  'Approach <200 FW Prox',
  'Approach >150 Rough GIR',
  'Approach >150 Rough SG',
  'Approach >150 Rough Prox',
  'Approach >200 FW GIR',
  'Approach >200 FW SG',
  'Approach >200 FW Prox',
  'SG Putting',
  'SG Around Green',
  'SG T2G',
  'Scoring Average',
  'Birdie Chances Created',
  'Birdies or Better',
  'Greens in Regulation',
  'Scoring: Approach <100 SG',
  'Scoring: Approach <150 FW SG',
  'Scoring: Approach <150 Rough SG',
  'Scoring: Approach >150 Rough SG',
  'Scoring: Approach <200 FW SG',
  'Scoring: Approach >200 FW SG',
  'Scrambling',
  'Great Shots',
  'Poor Shot Avoidance',
  'Course Management: Approach <100 Prox',
  'Course Management: Approach <150 FW Prox',
  'Course Management: Approach <150 Rough Prox',
  'Course Management: Approach >150 Rough Prox',
  'Course Management: Approach <200 FW Prox',
  'Course Management: Approach >200 FW Prox'
];

const APPROACH_EVENT_METRIC_MAP = {
  'Approach <100 GIR': '50_100_fw_gir_rate',
  'Approach <100 SG': '50_100_fw_sg_per_shot',
  'Approach <100 Prox': '50_100_fw_proximity_per_shot',
  'Approach <150 FW GIR': '100_150_fw_gir_rate',
  'Approach <150 FW SG': '100_150_fw_sg_per_shot',
  'Approach <150 FW Prox': '100_150_fw_proximity_per_shot',
  'Approach <150 Rough GIR': 'under_150_rgh_gir_rate',
  'Approach <150 Rough SG': 'under_150_rgh_sg_per_shot',
  'Approach <150 Rough Prox': 'under_150_rgh_proximity_per_shot',
  'Approach <200 FW GIR': '150_200_fw_gir_rate',
  'Approach <200 FW SG': '150_200_fw_sg_per_shot',
  'Approach <200 FW Prox': '150_200_fw_proximity_per_shot',
  'Approach >150 Rough GIR': 'over_150_rgh_gir_rate',
  'Approach >150 Rough SG': 'over_150_rgh_sg_per_shot',
  'Approach >150 Rough Prox': 'over_150_rgh_proximity_per_shot',
  'Approach >200 FW GIR': 'over_200_fw_gir_rate',
  'Approach >200 FW SG': 'over_200_fw_sg_per_shot',
  'Approach >200 FW Prox': 'over_200_fw_proximity_per_shot'
};

module.exports = {
  METRIC_ORDER,
  APPROACH_EVENT_METRIC_MAP
};
