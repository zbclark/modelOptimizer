const fs = require('fs');
const path = require('path');

const { ensureDirectory } = require('./fileUtils');
const { formatTimestamp } = require('./timeUtils');
const { formatTournamentDisplayName } = require('./namingUtils');
const { getMetricGroup } = require('./courseTypeUtils');
const {
  normalizeMetricAlias,
  computeTop20BlendShare,
  buildTemplateMapsFromRecommended,
  aggregateTop20BlendByType,
  blendTemplateMaps,
  flattenTemplateMetricWeights,
  buildRecommendedWeights,
  buildBlendedTemplateMapsByType
} = require('./validationTemplateCore');

const writeCorrelationSummary = (outputDir, name, metrics, options = {}) => {
  if (!outputDir) return null;
  ensureDirectory(outputDir);
  const jsonPath = path.resolve(outputDir, `${name}.json`);
  const csvPath = path.resolve(outputDir, `${name}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify({ metrics, generatedAt: formatTimestamp(new Date()) }, null, 2));

  const toCsvRow = values => values
    .map(value => (value === null || value === undefined ? '' : JSON.stringify(value)))
    .join(',');

  const displayType = options.type ? String(options.type).toUpperCase() : null;
  const tournamentNames = Array.isArray(options.tournaments) ? options.tournaments : [];
  const season = options.season ? String(options.season) : '';
  const formattedTournaments = tournamentNames
    .map(name => formatTournamentDisplayName(name))
    .filter(Boolean)
    .map(name => (season ? `${name} (${season})` : name));

  const lines = [];
  if (displayType) {
    lines.push(toCsvRow([`${displayType} - Aggregated Metric Analysis`]));
    lines.push(toCsvRow([
      `Tournaments: ${formattedTournaments.join(', ')}`
    ]));
    lines.push('');
  }

  lines.push(toCsvRow(['Metric', 'Avg Delta (Top 10 vs Field)', 'Avg Correlation', 'Tournament Count']));
  (metrics || []).forEach(entry => {
    lines.push(toCsvRow([
      entry.metric,
      entry.avgDelta.toFixed(3),
      entry.avgCorrelation.toFixed(4),
      entry.samples
    ]));
  });

  lines.push('');
  lines.push(toCsvRow(['Note: Metrics show average delta and correlation across all tournaments of this type']));

  fs.writeFileSync(csvPath, lines.join('\n'));
  return { jsonPath, csvPath };
};

const writeWeightCalibrationGuide = (outputDir, summariesByType, templatesByType, typeCounts = {}) => {
  ensureDirectory(outputDir);
  const jsonPath = path.resolve(outputDir, 'Weight_Calibration_Guide.json');
  const csvPath = path.resolve(outputDir, 'Weight_Calibration_Guide.csv');

  const guide = {
    generatedAt: formatTimestamp(new Date()),
    types: {}
  };

  const toCsvRow = values => values
    .map(value => (value === null || value === undefined ? '' : JSON.stringify(value)))
    .join(',');

  const lines = [];
  lines.push(toCsvRow(['WEIGHT CALIBRATION - Template vs Recommended by Course Type']));
  lines.push('');

  ['POWER', 'TECHNICAL', 'BALANCED'].forEach(type => {
    const summary = summariesByType[type] || [];
    const template = templatesByType[type] || null;
    const recommended = buildRecommendedWeights(summary, template);
    guide.types[type] = recommended;

    const tournamentCount = typeCounts[type] || 0;
    lines.push(toCsvRow([`${type} COURSES (${tournamentCount} tournaments)`]));
    lines.push(toCsvRow(['Metric', 'Template Weight', 'Recommended*', 'Gap', '% Change']));
    if (!summary.length) {
      lines.push(toCsvRow(['(no summary data available - using template weights)']));
    }

    recommended.forEach(entry => {
      const templateWeight = Number(entry.templateWeight) || 0;
      const recommendedWeight = Number(entry.recommendedWeight) || 0;
      const gap = recommendedWeight - templateWeight;
      const pctChange = templateWeight === 0 ? 'N/A%' : `${((gap / templateWeight) * 100).toFixed(2)}%`;

      lines.push(toCsvRow([
        entry.metric,
        templateWeight.toFixed(4),
        recommendedWeight.toFixed(4),
        gap.toFixed(4),
        pctChange
      ]));
    });

    lines.push(toCsvRow(['Note: Metrics show average delta and correlation across all tournaments of this type']));
    lines.push('');
  });

  lines.push('');
  lines.push(toCsvRow(['*Recommended weights are normalized from tournament correlation values (absolute)']));
  lines.push(toCsvRow(['Gap = Recommended - Template (positive = increase weight, negative = decrease)']));
  lines.push(toCsvRow(['% Change = (Gap / Template Weight) × 100']));

  fs.writeFileSync(jsonPath, JSON.stringify(guide, null, 2));
  fs.writeFileSync(csvPath, lines.join('\n'));
  return { jsonPath, csvPath };
};

const writeWeightTemplatesOutput = (outputDir, summariesByType, templatesByType, options = {}) => {
  ensureDirectory(outputDir);
  const jsonPath = path.resolve(outputDir, 'Weight_Templates.json');
  const csvPath = path.resolve(outputDir, 'Weight_Templates.csv');

  const output = {
    generatedAt: formatTimestamp(new Date()),
    templates: {},
    derivedTemplates: {}
  };

  const toCsvRow = values => values
    .map(value => (value === null || value === undefined ? '' : JSON.stringify(value)))
    .join(',');

  const lines = [];
  const typeOrder = ['POWER', 'TECHNICAL', 'BALANCED'];
  const configInfo = options.configInfo || new Map();
  const typeTournaments = options.typeTournaments || {};
  const top20BlendByTournament = options.top20BlendByTournament || new Map();

  typeOrder.forEach(type => {
    const summary = summariesByType[type] || [];
    const template = templatesByType[type] || null;
    const recommended = buildRecommendedWeights(summary, template);
    const baselineTemplateMaps = buildTemplateMapsFromRecommended(recommended);
    const top20Aggregate = aggregateTop20BlendByType(top20BlendByTournament, type);
    const blendShare = top20Aggregate ? computeTop20BlendShare(top20Aggregate.count) : 0;
    const blendedTemplateMaps = top20Aggregate
      ? blendTemplateMaps(baselineTemplateMaps, top20Aggregate, blendShare)
      : baselineTemplateMaps;

    const blendedMetricMap = blendedTemplateMaps.metricWeights || {};
    output.templates[type] = recommended.reduce((acc, entry) => {
      const metricName = normalizeMetricAlias(entry.metric);
      const groupName = getMetricGroup(metricName) || '__UNGROUPED__';
      const blendedKey = `${groupName}::${metricName}`;
      const blendedWeight = typeof blendedMetricMap[blendedKey] === 'number'
        ? blendedMetricMap[blendedKey]
        : entry.recommendedWeight;
      acc[entry.metric] = {
        templateWeight: entry.templateWeight,
        recommendedWeight: blendedWeight,
        correlation: entry.correlation
      };
      return acc;
    }, {});

    const tournaments = Array.isArray(typeTournaments[type]) ? typeTournaments[type] : [];
    lines.push(toCsvRow([`${type} COURSES (${tournaments.length} tournaments)`]));
    lines.push(toCsvRow(['Tournament', 'Config Template (Q27)']));
    tournaments.forEach(slug => {
      const info = configInfo.get(slug);
      lines.push(toCsvRow([
        info?.displayName || formatTournamentDisplayName(slug),
        info?.templateName || ''
      ]));
    });
    lines.push('');

    lines.push(toCsvRow([
      'Metric',
      'Config Weight',
      'Template Weight',
      'Recommended Weight',
      'Config vs Template',
      'Config vs Recommended'
    ]));
    if (!summary.length) {
      lines.push(toCsvRow(['(no summary data available - using template weights)']));
    }

    const configBuckets = {};
    tournaments.forEach(slug => {
      const info = configInfo.get(slug);
      const weights = info?.configWeights || {};
      Object.entries(weights).forEach(([metric, weight]) => {
        if (!configBuckets[metric]) configBuckets[metric] = [];
        if (Number.isFinite(weight)) configBuckets[metric].push(weight);
      });
    });

    recommended.forEach(entry => {
      const templateWeight = Number(entry.templateWeight) || 0;
      const metricName = normalizeMetricAlias(entry.metric);
      const groupName = getMetricGroup(metricName) || '__UNGROUPED__';
      const blendedKey = `${groupName}::${metricName}`;
      const blendedWeight = typeof blendedMetricMap[blendedKey] === 'number'
        ? blendedMetricMap[blendedKey]
        : entry.recommendedWeight;
      const recommendedWeight = Number(blendedWeight) || 0;
      const configValues = configBuckets[entry.metric] || [];
      const configWeight = configValues.length > 0
        ? configValues.reduce((sum, value) => sum + value, 0) / configValues.length
        : null;

      const configVsTemplate = (configWeight === null || templateWeight === 0)
        ? 'N/A'
        : `${(((configWeight - templateWeight) / templateWeight) * 100).toFixed(1)}%`;
      const configVsRecommended = (configWeight === null || recommendedWeight === 0)
        ? 'N/A'
        : `${(((configWeight - recommendedWeight) / recommendedWeight) * 100).toFixed(1)}%`;

      lines.push(toCsvRow([
        entry.metric,
        configWeight === null ? '' : Number(configWeight.toFixed(4)).toString(),
        Number(templateWeight.toFixed(4)).toString(),
        Number(recommendedWeight.toFixed(4)).toString(),
        configVsTemplate,
        configVsRecommended
      ]));
    });

    lines.push('');
  });

  if (top20BlendByTournament.size > 0) {
    top20BlendByTournament.forEach((blend, slug) => {
      const recommendedType = blend?.recommendedType;
      if (!recommendedType) return;
      const summary = summariesByType[recommendedType] || [];
      const template = templatesByType[recommendedType] || null;
      const baselineRecommended = buildRecommendedWeights(summary, template);
      if (baselineRecommended.length === 0) return;
      const baselineMaps = buildTemplateMapsFromRecommended(baselineRecommended);
      const blendShare = 0.5;
      const tournamentOverlay = {
        groupWeights: blend?.blendedGroups || {},
        metricWeights: blend?.blendedMetrics || {}
      };
      const tournamentMaps = blendTemplateMaps(baselineMaps, tournamentOverlay, blendShare);
      const nestedMetrics = {};
      Object.entries(tournamentMaps.metricWeights || {}).forEach(([key, value]) => {
        const [group, metric] = key.split('::');
        if (!group || !metric) return;
        if (!nestedMetrics[group]) nestedMetrics[group] = {};
        nestedMetrics[group][metric] = { weight: value };
      });

      output.derivedTemplates[slug] = {
        sourcePath: blend.sourcePath || null,
        meta: blend.meta || null,
        alignmentScores: blend.scores || null,
        signalMap: blend.signalMap || null,
        blendedGroups: blend.blendedGroups || null,
        blendedMetrics: blend.blendedMetrics || null,
        tournamentTemplate: {
          groupWeights: tournamentMaps.groupWeights || {},
          metricWeights: nestedMetrics
        }
      };
    });
  }

  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  fs.writeFileSync(csvPath, lines.join('\n'));
  return { jsonPath, csvPath };
};

const buildNestedMetricWeights = (flatMetricWeights = {}) => {
  const nested = {};
  Object.entries(flatMetricWeights).forEach(([key, value]) => {
    const [group, metric] = key.split('::');
    if (!group || !metric) return;
    if (!nested[group]) nested[group] = {};
    nested[group][metric] = { weight: value };
  });
  return nested;
};

const applyTemplateUpdateComment = (content, commentLine) => {
  if (!commentLine || typeof commentLine !== 'string') return content;
  const sanitizedComment = commentLine.replace(/[\r\n]+/g, ' ');
  const trimmed = sanitizedComment.trim();
  if (trimmed.length === 0) return content;
  const normalizedComment = trimmed.startsWith('//')
    ? trimmed
    : `// ${trimmed}`;
  if (!normalizedComment) return content;
  const lines = String(content || '').split('\n');
  const firstNonEmpty = lines.findIndex(line => line.trim().length > 0);
  if (firstNonEmpty === -1) {
    return `${normalizedComment}\n${content || ''}`.trimEnd();
  }
  const existing = lines[firstNonEmpty].trim();
  if (/^\/\/\s*Updated\s+(before|after)\s+/i.test(existing)) {
    lines[firstNonEmpty] = normalizedComment;
  } else {
    lines.splice(firstNonEmpty, 0, normalizedComment);
  }
  return lines.join('\n');
};

const formatWeightTemplatesFile = (templates = {}) => {
  return `const WEIGHT_TEMPLATES = ${JSON.stringify(templates, null, 2)};\n\nmodule.exports = { WEIGHT_TEMPLATES };\n`;
};

const updateBaselineTemplatesFile = ({ blendedTemplatesByType, logger = console, dryRun = false, outputDir = null, updateComment = null }) => {
  if (!blendedTemplatesByType || Object.keys(blendedTemplatesByType).length === 0) return null;
  const templatePath = path.resolve(__dirname, '..', 'utilities', 'weightTemplates.js');
  let existingTemplates = {};
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    existingTemplates = require(templatePath)?.WEIGHT_TEMPLATES || {};
  } catch (error) {
    logger.warn(`⚠️  Unable to load existing baseline templates: ${error.message}`);
    existingTemplates = {};
  }

  const updated = { ...existingTemplates };
  ['POWER', 'TECHNICAL', 'BALANCED'].forEach(type => {
    const maps = blendedTemplatesByType[type];
    if (!maps) return;
    const groupWeights = maps.groupWeights || {};
    const metricWeights = buildNestedMetricWeights(maps.metricWeights || {});
    const existing = updated[type] || { name: type };
    updated[type] = {
      ...existing,
      name: existing.name || type,
      groupWeights,
      metricWeights
    };
  });

  let payload = formatWeightTemplatesFile(updated);
  if (updateComment) {
    payload = applyTemplateUpdateComment(payload, updateComment);
  }
  if (dryRun) {
    const baseName = path.basename(templatePath, path.extname(templatePath));
    const dryRunName = `dryrun_${baseName}${path.extname(templatePath) || '.js'}`;
    const targetDir = outputDir ? path.resolve(outputDir, 'dryrun') : path.resolve(path.dirname(templatePath), 'dryrun');
    ensureDirectory(targetDir);
    const dryRunPath = path.resolve(targetDir, dryRunName);
    fs.writeFileSync(dryRunPath, payload);
    return dryRunPath;
  }

  fs.writeFileSync(templatePath, payload);
  return templatePath;
};

module.exports = {
  flattenTemplateMetricWeights,
  writeCorrelationSummary,
  writeWeightCalibrationGuide,
  writeWeightTemplatesOutput,
  buildBlendedTemplateMapsByType,
  updateBaselineTemplatesFile
};
