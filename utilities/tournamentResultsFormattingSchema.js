const GENERATED_METRIC_LABELS = [
  'SG Total',
  'Driving Distance',
  'Driving Accuracy',
  'SG T2G',
  'SG Approach',
  'SG Around Green',
  'SG OTT',
  'SG Putting',
  'Greens in Regulation',
  'Scrambling',
  'Great Shots',
  'Poor Shots',
  'Scoring Average',
  'Fairway Proximity',
  'Rough Proximity',
  'Approach <100 GIR',
  'Approach <100 SG',
  'Approach <100 Prox',
  'Approach <150 FW GIR',
  'Approach <150 FW SG',
  'Approach <150 FW Prox',
  'Approach <150 Rough GIR',
  'Approach <150 Rough SG',
  'Approach <150 Rough Prox',
  'Approach >150 Rough GIR',
  'Approach >150 Rough SG',
  'Approach >150 Rough Prox',
  'Approach <200 FW GIR',
  'Approach <200 FW SG',
  'Approach <200 FW Prox',
  'Approach >200 FW GIR',
  'Approach >200 FW SG',
  'Approach >200 FW Prox'
];

const PERCENT_FORMAT = '0.00%';
const DEFAULT_FORMAT = '0.000';

const percentMetrics = new Set([
  'Driving Accuracy',
  'Greens in Regulation',
  'Scrambling',
  'Approach <100 GIR',
  'Approach <150 FW GIR',
  'Approach <150 Rough GIR',
  'Approach >150 Rough GIR',
  'Approach <200 FW GIR',
  'Approach >200 FW GIR'
]);

const isProximityMetric = metric => metric.includes('Prox') || metric.includes('Proximity');
const isLowerBetterMetric = metric => (
  metric === 'Poor Shots'
  || metric === 'Scoring Average'
  || isProximityMetric(metric)
);

const buildColumns = () => {
  const columns = [
    { name: 'DG ID', format: '0', width: 70 },
    { name: 'Player Name', format: 'text', width: 140 },
    { name: 'Finish Position', format: '0', width: 70 },
    { name: 'Model Rank', format: '0', width: 70 }
  ];

  GENERATED_METRIC_LABELS.forEach(metric => {
    const format = percentMetrics.has(metric) ? PERCENT_FORMAT : DEFAULT_FORMAT;
    const direction = isLowerBetterMetric(metric) ? 'lower_better' : 'higher_better';
    columns.push({
      name: `${metric} (Actual)`,
      group: 'actual',
      format,
      direction
    });
    columns.push({
      name: `${metric} (Model)`,
      group: 'model',
      format,
      direction
    });
  });

  return columns;
};

const TOURNAMENT_RESULTS_FORMATTING_SCHEMA = {
  sheetName: 'Tournament Results',
  headerRow: 5,
  dataStartRow: 6,
  notesColumn: 1,
  notesColumnHeader: 'Performance Notes',
  tableStartColumn: 2,
  notesColumnWidth: 350,
  columnDefaults: {
    width: 110,
    format: DEFAULT_FORMAT
  },
  columns: buildColumns(),
  tournamentResultsHighlighting: {
    finishPosition: {
      label: 'Finish Position',
      medalRanges: [
        { min: 1, max: 1, background: '#FFD700', bold: true },
        { min: 2, max: 5, background: '#C0C0C0', bold: true },
        { min: 6, max: 10, background: '#CD7F32' }
      ]
    },
    modelRankComparison: {
      label: 'Model Rank',
      finishLabel: 'Finish Position',
      bigMiss: { rankThreshold: 100, finishThreshold: 10, background: '#FFC7CE', fontColor: '#9C0006', bold: true },
      strongHit: { rankThreshold: 20, finishThreshold: 10, background: '#C6EFCE', fontColor: '#006100', bold: true }
    },
    actualVsModelColors: {
      better: '#DFF0D8',
      worse: '#F2DEDE'
    }
  }
};

const getTournamentResultsFormattingSchema = () => ({
  ...TOURNAMENT_RESULTS_FORMATTING_SCHEMA,
  columns: [...TOURNAMENT_RESULTS_FORMATTING_SCHEMA.columns]
});

module.exports = {
  GENERATED_METRIC_LABELS,
  TOURNAMENT_RESULTS_FORMATTING_SCHEMA,
  getTournamentResultsFormattingSchema
};
