const fs = require('fs');
const path = require('path');
const { ensureDirectory, readJsonFile } = require('./fileUtils');
const { loadConfigCells, getCell } = require('./configParser');
const { WEIGHT_TEMPLATES } = require('./weightTemplates');
const { formatTournamentDisplayName } = require('./namingUtils');
const { normalizeTournamentNameForSeason } = require('./tournamentPaths');
const { normalizeFinishPosition, parseNumericValue } = require('./parsingUtils');
const {
  getMetricGroupings,
  getMetricGroup,
  determineDetectedCourseType,
  calculateRecommendedWeight
} = require('./courseTypeUtils');
const { METRIC_ORDER } = require('./validationConstants');
const { isLowerBetterMetric } = require('./evaluationMetrics');
const { loadTournamentPredictions } = require('./validationPredictions');
const { flattenTemplateMetricWeights } = require('./validationTemplateCore');
const { resolveValidationSubdir } = require('./outputPaths');

const getConfigTemplateName = configCsvPath => {
  if (!configCsvPath || !fs.existsSync(configCsvPath)) return null;
  try {
    const cells = loadConfigCells(configCsvPath);
    for (let row = 0; row < cells.length; row += 1) {
      const rowValues = cells[row] || [];
      for (let col = 0; col < rowValues.length; col += 1) {
        const value = String(rowValues[col] || '').trim();
        if (!value) continue;
        const match = value.match(/Template\s*:\s*(.+)$/i);
        if (match && match[1]) return match[1].trim();
      }
    }
    return null;
  } catch {
    return null;
  }
};

const getConfigMetricWeights = configCsvPath => {
  if (!configCsvPath || !fs.existsSync(configCsvPath)) return {};
  try {
    const cells = loadConfigCells(configCsvPath);
    const readCell = (row, col) => getCell(cells, row, col);
    const metricWeights = {};

    metricWeights['Driving Distance'] = parseNumericValue(readCell(16, 7)) || 0;
    metricWeights['Driving Accuracy'] = parseNumericValue(readCell(16, 8)) || 0;
    metricWeights['SG OTT'] = parseNumericValue(readCell(16, 9)) || 0;

    metricWeights['Approach <100 GIR'] = parseNumericValue(readCell(17, 7)) || 0;
    metricWeights['Approach <100 SG'] = parseNumericValue(readCell(17, 8)) || 0;
    metricWeights['Approach <100 Prox'] = parseNumericValue(readCell(17, 9)) || 0;

    metricWeights['Approach <150 FW GIR'] = parseNumericValue(readCell(18, 7)) || 0;
    metricWeights['Approach <150 FW SG'] = parseNumericValue(readCell(18, 8)) || 0;
    metricWeights['Approach <150 FW Prox'] = parseNumericValue(readCell(18, 9)) || 0;
    metricWeights['Approach <150 Rough GIR'] = parseNumericValue(readCell(18, 10)) || 0;
    metricWeights['Approach <150 Rough SG'] = parseNumericValue(readCell(18, 11)) || 0;
    metricWeights['Approach <150 Rough Prox'] = parseNumericValue(readCell(18, 12)) || 0;

    metricWeights['Approach <200 FW GIR'] = parseNumericValue(readCell(19, 7)) || 0;
    metricWeights['Approach <200 FW SG'] = parseNumericValue(readCell(19, 8)) || 0;
    metricWeights['Approach <200 FW Prox'] = parseNumericValue(readCell(19, 9)) || 0;
    metricWeights['Approach >150 Rough GIR'] = parseNumericValue(readCell(19, 10)) || 0;
    metricWeights['Approach >150 Rough SG'] = parseNumericValue(readCell(19, 11)) || 0;
    metricWeights['Approach >150 Rough Prox'] = parseNumericValue(readCell(19, 12)) || 0;

    metricWeights['Approach >200 FW GIR'] = parseNumericValue(readCell(20, 7)) || 0;
    metricWeights['Approach >200 FW SG'] = parseNumericValue(readCell(20, 8)) || 0;
    metricWeights['Approach >200 FW Prox'] = parseNumericValue(readCell(20, 9)) || 0;

    metricWeights['SG Putting'] = parseNumericValue(readCell(21, 7)) || 0;
    metricWeights['SG Around Green'] = parseNumericValue(readCell(22, 7)) || 0;

    metricWeights['SG T2G'] = parseNumericValue(readCell(23, 7)) || 0;
    metricWeights['Scoring Average'] = parseNumericValue(readCell(23, 8)) || 0;
    metricWeights['Birdie Chances Created'] = parseNumericValue(readCell(23, 9)) || 0;
    metricWeights['Scoring: Approach <100 SG'] = parseNumericValue(readCell(23, 10)) || 0;
    metricWeights['Scoring: Approach <150 FW SG'] = parseNumericValue(readCell(23, 11)) || 0;
    metricWeights['Scoring: Approach <150 Rough SG'] = parseNumericValue(readCell(23, 12)) || 0;
    metricWeights['Scoring: Approach >150 Rough SG'] = parseNumericValue(readCell(23, 13)) || 0;
    metricWeights['Scoring: Approach <200 FW SG'] = parseNumericValue(readCell(23, 14)) || 0;
    metricWeights['Scoring: Approach >200 FW SG'] = parseNumericValue(readCell(23, 15)) || 0;

    metricWeights['Scrambling'] = parseNumericValue(readCell(24, 7)) || 0;
    metricWeights['Great Shots'] = parseNumericValue(readCell(24, 8)) || 0;
    metricWeights['Poor Shot Avoidance'] = parseNumericValue(readCell(24, 9)) || 0;
    metricWeights['Course Management: Approach <100 Prox'] = parseNumericValue(readCell(24, 10)) || 0;
    metricWeights['Course Management: Approach <150 FW Prox'] = parseNumericValue(readCell(24, 11)) || 0;
    metricWeights['Course Management: Approach <150 Rough Prox'] = parseNumericValue(readCell(24, 12)) || 0;
    metricWeights['Course Management: Approach >150 Rough Prox'] = parseNumericValue(readCell(24, 13)) || 0;
    metricWeights['Course Management: Approach <200 FW Prox'] = parseNumericValue(readCell(24, 14)) || 0;
    metricWeights['Course Management: Approach >200 FW Prox'] = parseNumericValue(readCell(24, 15)) || 0;

    return metricWeights;
  } catch {
    return {};
  }
};

const buildConfigWeightsFromTemplate = template => {
  if (!template) return {};
  const weights = {};
  const flat = flattenTemplateMetricWeights(template);
  flat.forEach(entry => {
    const weight = typeof entry.weight === 'number' && !Number.isNaN(entry.weight) ? entry.weight : null;
    if (weight === null) return;
    const groupName = entry.groupName || null;
    const metricName = entry.metric || null;
    if (!metricName) return;
    const key = (groupName === 'Scoring' || groupName === 'Course Management')
      ? `${groupName}: ${metricName}`
      : metricName;
    weights[key] = weight;
  });
  return weights;
};

const getTemplateWeightForMetric = (courseType, metricName) => {
  if (!courseType || !metricName) return 0;
  const template = WEIGHT_TEMPLATES?.[courseType] || null;
  if (!template) return 0;
  const group = getMetricGroup(metricName);
  const metricWeight = template?.metricWeights?.[group]?.[metricName]?.weight;
  return Number.isFinite(metricWeight) ? metricWeight : 0;
};

const formatWeightValue = value => {
  if (!Number.isFinite(value)) return '';
  return Number(value.toFixed(4)).toString();
};

const formatDeltaValue = (metricKey, deltaValue) => {
  if (deltaValue === undefined || deltaValue === null || Number.isNaN(deltaValue)) return '';
  if (metricKey.includes('Distance') || metricKey === 'Scoring Average') {
    return Number(deltaValue.toFixed(0));
  }
  if (metricKey.includes('Accuracy') || metricKey.includes('Proximity') || metricKey.includes('GIR')) {
    return Number(deltaValue.toFixed(1));
  }
  return Number(deltaValue.toFixed(2));
};

const getMetricAnalysisDir = outputDir => {
  if (!outputDir) return null;
  return resolveValidationSubdir({ validationRoot: outputDir, kind: 'METRIC_ANALYSIS' });
};

const writeMetricAnalysis = (outputDir, metricAnalysis, options = {}) => {
  if (!metricAnalysis?.tournament) return null;
  const metricDir = getMetricAnalysisDir(outputDir) || outputDir;
  ensureDirectory(metricDir);
  const baseName = `${metricAnalysis.tournament}_metric_analysis`;
  const jsonPath = path.resolve(metricDir, `${baseName}.json`);
  const csvPath = path.resolve(metricDir, `${baseName}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify(metricAnalysis, null, 2));

  const toCsvRow = values => values
    .map(value => (value === null || value === undefined ? '' : JSON.stringify(value)))
    .join(',');

  const season = options.season ? String(options.season) : '';
  const safeTournamentName = normalizeTournamentNameForSeason(
    options.tournamentName || metricAnalysis.tournament,
    season
  );
  const displayTournament = formatTournamentDisplayName(safeTournamentName);
  const tournamentLabel = displayTournament && season
    ? `${displayTournament} (${season})`
    : displayTournament || metricAnalysis.tournament;

  const configType = String(options.courseType || metricAnalysis.courseType || 'UNKNOWN').toUpperCase();
  const templateName = options.templateName || getConfigTemplateName(options.configCsvPath) || configType;
  const detectedType = determineDetectedCourseType(metricAnalysis.metrics);

  let validationLine = '';
  if (configType !== 'UNKNOWN' && detectedType !== 'UNKNOWN') {
    if (configType === detectedType) {
      validationLine = `✔️ Template matches data-driven type (${configType})`;
    } else {
      validationLine = `⚠️ Template (${configType}) does NOT match data-driven type (${detectedType}) - REVIEW`;
    }
  } else {
    validationLine = `⚠️ Unable to validate template type (Config: ${configType}, Data: ${detectedType})`;
  }

  const totalFinishers = metricAnalysis.totalFinishers ?? 0;
  const top10Finishers = metricAnalysis.top10Finishers ?? 0;

  let configWeights = getConfigMetricWeights(options.configCsvPath);
  const templateType = templateName
    || (configType !== 'UNKNOWN' ? configType : null)
    || metricAnalysis.courseType
    || 'BALANCED';
  let configWeightSource = 'config_csv';
  const hasFiniteConfigWeights = Object.values(configWeights)
    .some(value => typeof value === 'number' && Number.isFinite(value));
  if (!options.configCsvPath || !fs.existsSync(options.configCsvPath) || Object.keys(configWeights).length === 0 || !hasFiniteConfigWeights) {
    const fallbackTemplate = WEIGHT_TEMPLATES?.[templateType] || null;
    configWeights = buildConfigWeightsFromTemplate(fallbackTemplate);
    configWeightSource = 'template_fallback';
  }

  const groupMaxCorrelations = {};
  const metricGroups = getMetricGroupings();
  Object.entries(metricGroups).forEach(([groupName, metrics]) => {
    let maxCorrelation = 0;
    metrics.forEach(metricName => {
      const metricEntry = metricAnalysis.metrics.find(entry => entry.metric === metricName);
      const corr = Math.abs(metricEntry?.correlation || 0);
      if (corr > maxCorrelation) maxCorrelation = corr;
    });
    groupMaxCorrelations[groupName] = maxCorrelation;
  });

  const recommendedWeightsByMetric = {};
  const recommendedGroupTotals = {};
  METRIC_ORDER.forEach(metricName => {
    const metricEntry = metricAnalysis.metrics.find(entry => entry.metric === metricName);
    const correlation = metricEntry?.correlation || 0;
    const templateWeight = getTemplateWeightForMetric(templateType, metricName);
    const recommended = calculateRecommendedWeight(metricName, correlation, {
      templateWeight,
      groupMaxCorrelations
    });
    const groupName = getMetricGroup(metricName) || '__UNGROUPED__';
    const base = Math.abs(Number(recommended) || 0);
    recommendedWeightsByMetric[metricName] = { base, groupName };
    recommendedGroupTotals[groupName] = (recommendedGroupTotals[groupName] || 0) + base;
  });

  const lines = [];
  lines.push(toCsvRow([`${tournamentLabel} - Metric Analysis (${templateName})`]));
  lines.push(toCsvRow([validationLine]));
  if (configWeightSource === 'template_fallback') {
    lines.push(toCsvRow([`Config weights unavailable; using ${templateType} template weights as fallback.`]));
  }
  lines.push(toCsvRow([`Top 10: ${top10Finishers} | Total Finishers: ${totalFinishers}`]));
  lines.push('');
  lines.push(toCsvRow([
    'Metric',
    'Top 10 Avg',
    'Field Avg',
    'Delta',
    '% Above Field',
    'Correlation',
    'Config Weight',
    'Template Weight',
    'Recommended Weight'
  ]));

  const metricMap = new Map(metricAnalysis.metrics.map(entry => [entry.metric, entry]));
  METRIC_ORDER.forEach(metricName => {
    const metricEntry = metricMap.get(metricName) || {
      top10Avg: 0,
      fieldAvg: 0,
      delta: 0,
      correlation: 0
    };
    let pct = 'N/A';
    if (metricEntry.fieldAvg !== 0) {
      if (isLowerBetterMetric(metricName)) {
        let adjustedDelta = metricEntry.delta;
        if (metricEntry.top10Avg < metricEntry.fieldAvg) {
          adjustedDelta = Math.abs(metricEntry.delta);
        } else if (metricEntry.top10Avg > metricEntry.fieldAvg) {
          adjustedDelta = -Math.abs(metricEntry.delta);
        }
        pct = `${((adjustedDelta / Math.abs(metricEntry.fieldAvg)) * 100).toFixed(1)}%`;
      } else {
        pct = `${((metricEntry.delta / metricEntry.fieldAvg) * 100).toFixed(1)}%`;
      }
    }

    const templateWeight = getTemplateWeightForMetric(templateType, metricName);
    const rawConfigWeight = configWeights[metricName];
    const configWeight = (typeof rawConfigWeight === 'number' && Number.isFinite(rawConfigWeight))
      ? rawConfigWeight
      : (configWeightSource === 'template_fallback' ? templateWeight : rawConfigWeight);
    const recommendedInfo = recommendedWeightsByMetric[metricName] || { base: 0, groupName: '__UNGROUPED__' };
    const groupTotal = recommendedGroupTotals[recommendedInfo.groupName] || 0;
    const recommendedWeight = groupTotal > 0 ? recommendedInfo.base / groupTotal : 0;

    lines.push(toCsvRow([
      metricName,
      metricEntry.top10Avg.toFixed(3),
      metricEntry.fieldAvg.toFixed(3),
      metricEntry.delta.toFixed(3),
      pct,
      metricEntry.correlation.toFixed(4),
      formatWeightValue(configWeight ?? ''),
      formatWeightValue(templateWeight),
      formatWeightValue(recommendedWeight)
    ]));
  });

  const resultsPayload = readJsonFile(options.resultsJsonPath);
  const resultsRows = Array.isArray(resultsPayload?.results)
    ? resultsPayload.results
    : (Array.isArray(resultsPayload) ? resultsPayload : []);
  const predictions = loadTournamentPredictions({
    rankingsJsonPath: options.rankingsJsonPath,
    rankingsCsvPath: options.rankingsCsvPath,
    resultsJsonPath: options.resultsJsonPath,
    resultsCsvPath: options.resultsCsvPath
  }).predictions;
  const predictionMap = new Map(predictions.map(entry => [entry.dgId, entry.rank]));

  const deltaMetrics = [
    'Driving Distance',
    'Driving Accuracy',
    'SG OTT',
    'SG Putting',
    'SG Around Green',
    'SG T2G',
    'Greens in Regulation',
    'Fairway Proximity',
    'Rough Proximity',
    'SG Approach',
    'SG Total'
  ];

  const players = resultsRows
    .map(row => {
      const dgId = String(row?.['DG ID'] || '').trim();
      if (!dgId) return null;
      const playerName = String(row?.['Player Name'] || '').trim();
      const finishText = String(row?.['Finish Position'] || '').trim();
      const finishPos = normalizeFinishPosition(finishText);
      if (finishPos === null || Number.isNaN(finishPos)) return null;
      const modelRankRaw = row?.['Model Rank'];
      const modelRank = Number.isFinite(modelRankRaw)
        ? modelRankRaw
        : parseInt(String(modelRankRaw || '').trim(), 10);
      const rankValue = Number.isFinite(modelRank) ? modelRank : (predictionMap.get(dgId) || null);

      if (!rankValue) return null;
      const missScore = rankValue - finishPos;
      let gapAnalysis = '';
      if (missScore === 0) {
        gapAnalysis = 'Perfect';
      } else if (missScore > 0) {
        gapAnalysis = `Predicted ${missScore} spots too high`;
      } else {
        gapAnalysis = `Predicted ${Math.abs(missScore)} spots too low`;
      }

      const deltas = deltaMetrics.map(metricName => {
        const actualValueRaw = row?.[metricName];
        const modelValueRaw = row?.[`${metricName} - Model`];
        const actualValue = typeof actualValueRaw === 'number' ? actualValueRaw : parseNumericValue(actualValueRaw);
        const modelValue = typeof modelValueRaw === 'number' ? modelValueRaw : parseNumericValue(modelValueRaw);
        if (!Number.isFinite(actualValue) && !Number.isFinite(modelValue)) return '';
        const safeActual = Number.isFinite(actualValue) ? actualValue : 0;
        const safeModel = Number.isFinite(modelValue) ? modelValue : 0;
        return formatDeltaValue(metricName, safeModel - safeActual);
      });

      return {
        playerName: playerName || 'Unknown',
        modelRank: rankValue,
        finishText,
        missScore,
        gapAnalysis,
        deltas
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.modelRank - b.modelRank);

  if (players.length > 0) {
    lines.push('');
    lines.push(toCsvRow(['PLAYER-LEVEL ACCURACY ANALYSIS']));
    lines.push(toCsvRow([
      'Player',
      'Model Rank',
      'Finish Pos',
      'Miss Score',
      'Gap Analysis',
      ...deltaMetrics.map(metric => `${metric} Δ`)
    ]));

    players.forEach(player => {
      lines.push(toCsvRow([
        player.playerName,
        player.modelRank,
        player.finishText,
        player.missScore,
        player.gapAnalysis,
        ...player.deltas
      ]));
    });
  }

  fs.writeFileSync(csvPath, lines.join('\n'));
  return { jsonPath, csvPath };
};

module.exports = {
  getConfigTemplateName,
  getConfigMetricWeights,
  buildConfigWeightsFromTemplate,
  getTemplateWeightForMetric,
  formatWeightValue,
  formatDeltaValue,
  writeMetricAnalysis
};
