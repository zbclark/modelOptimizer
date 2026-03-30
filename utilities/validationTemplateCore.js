/**
 * Module: validationTemplateCore
 * Purpose: Compute-only helpers for template blending and weighting.
 */

const { normalizeMetricLabel } = require('./metricLabels');
const { getMetricGroup } = require('./courseTypeUtils');

const normalizeMetricAlias = metricName => normalizeMetricLabel(metricName);

const computeTop20BlendShare = count => {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count < 3) return 0;
  if (count >= 15) return 0.7;
  if (count >= 10) {
    const span = 15 - 10;
    return 0.5 + ((count - 10) / span) * (0.7 - 0.5);
  }
  if (count >= 5) {
    const span = 10 - 5;
    return 0.3 + ((count - 5) / span) * (0.5 - 0.3);
  }
  const span = 5 - 3;
  return 0.2 + ((count - 3) / span) * (0.3 - 0.2);
};

const normalizeGroupWeights = groupWeights => {
  const entries = Object.entries(groupWeights || {});
  const total = entries.reduce((sum, [, value]) => sum + Math.abs(value || 0), 0);
  if (!total) return {};
  return entries.reduce((acc, [key, value]) => {
    acc[key] = (value || 0) / total;
    return acc;
  }, {});
};

const normalizeMetricWeightsByGroup = metricWeights => {
  const updated = { ...(metricWeights || {}) };
  const groupTotals = {};
  Object.entries(updated).forEach(([key, value]) => {
    const [group] = key.split('::');
    if (!group) return;
    groupTotals[group] = (groupTotals[group] || 0) + Math.abs(value || 0);
  });
  Object.entries(updated).forEach(([key, value]) => {
    const [group] = key.split('::');
    const total = groupTotals[group] || 0;
    if (!total) return;
    updated[key] = (value || 0) / total;
  });
  return updated;
};

const buildTemplateMapsFromRecommended = recommended => {
  const metricWeights = {};
  const groupTotals = {};
  (recommended || []).forEach(entry => {
    const metricName = normalizeMetricAlias(entry.metric);
    const group = getMetricGroup(metricName) || '__UNGROUPED__';
    const weight = typeof entry.recommendedWeight === 'number' ? entry.recommendedWeight : 0;
    metricWeights[`${group}::${metricName}`] = weight;
    groupTotals[group] = (groupTotals[group] || 0) + Math.abs(weight || 0);
  });
  const groupWeights = normalizeGroupWeights(groupTotals);
  return {
    groupWeights,
    metricWeights: normalizeMetricWeightsByGroup(metricWeights)
  };
};

const aggregateTop20BlendByType = (top20BlendByTournament, type) => {
  const entries = Array.from(top20BlendByTournament.entries())
    .filter(([, blend]) => blend?.recommendedType === type)
    .map(([, blend]) => blend);
  if (!entries.length) return null;

  const groupTotals = {};
  const groupWeights = {};
  const metricTotals = {};
  const metricWeights = {};

  entries.forEach(blend => {
    const weight = Math.abs(blend?.scores?.[type] || 0) || 1;
    const groups = blend?.blendedGroups || {};
    const metrics = blend?.blendedMetrics || {};
    Object.entries(groups).forEach(([group, value]) => {
      groupTotals[group] = (groupTotals[group] || 0) + weight;
      groupWeights[group] = (groupWeights[group] || 0) + weight * (value || 0);
    });
    Object.entries(metrics).forEach(([key, value]) => {
      metricTotals[key] = (metricTotals[key] || 0) + weight;
      metricWeights[key] = (metricWeights[key] || 0) + weight * (value || 0);
    });
  });

  Object.entries(groupWeights).forEach(([group, value]) => {
    const total = groupTotals[group] || 0;
    groupWeights[group] = total ? value / total : 0;
  });
  Object.entries(metricWeights).forEach(([key, value]) => {
    const total = metricTotals[key] || 0;
    metricWeights[key] = total ? value / total : 0;
  });

  return {
    count: entries.length,
    groupWeights: normalizeGroupWeights(groupWeights),
    metricWeights: normalizeMetricWeightsByGroup(metricWeights)
  };
};

const blendTemplateMaps = (baseline, overlay, share) => {
  if (!overlay || !share) return baseline;
  const blendedGroups = { ...(baseline.groupWeights || {}) };
  Object.entries(overlay.groupWeights || {}).forEach(([group, value]) => {
    const base = typeof blendedGroups[group] === 'number' ? blendedGroups[group] : 0;
    blendedGroups[group] = (1 - share) * base + share * (value || 0);
  });

  const blendedMetrics = { ...(baseline.metricWeights || {}) };
  Object.entries(overlay.metricWeights || {}).forEach(([key, value]) => {
    const base = typeof blendedMetrics[key] === 'number' ? blendedMetrics[key] : 0;
    blendedMetrics[key] = (1 - share) * base + share * (value || 0);
  });

  return {
    groupWeights: normalizeGroupWeights(blendedGroups),
    metricWeights: normalizeMetricWeightsByGroup(blendedMetrics)
  };
};

const flattenTemplateMetricWeights = template => {
  const metricWeights = template?.metricWeights || {};
  const flattened = [];
  Object.entries(metricWeights).forEach(([groupName, groupMetrics]) => {
    if (!groupMetrics || typeof groupMetrics !== 'object') return;
    Object.entries(groupMetrics).forEach(([metricName, metricConfig]) => {
      const weight = typeof metricConfig === 'number'
        ? metricConfig
        : (typeof metricConfig?.weight === 'number' ? metricConfig.weight : 0);
      flattened.push({
        groupName,
        metric: metricName,
        weight
      });
    });
  });
  return flattened;
};

const buildRecommendedWeights = (summaryMetrics, template) => {
  const summaryList = Array.isArray(summaryMetrics) ? summaryMetrics : [];
  if (!template) return [];
  const templateMetrics = flattenTemplateMetricWeights(template);
  const correlationMap = new Map(
    summaryList.map(entry => [normalizeMetricAlias(entry.metric), entry.avgCorrelation || 0])
  );

  const metricsByGroup = new Map();
  templateMetrics.forEach(entry => {
    const metricName = normalizeMetricAlias(entry.metric);
    if (!metricsByGroup.has(entry.groupName)) metricsByGroup.set(entry.groupName, []);
    metricsByGroup.get(entry.groupName).push({
      metric: metricName,
      templateMetric: entry.metric,
      templateWeight: entry.weight,
      correlation: correlationMap.get(metricName) || 0
    });
  });

  const recommended = [];
  metricsByGroup.forEach((entries, groupName) => {
    const maxAbs = Math.max(...entries.map(entry => Math.abs(entry.correlation || 0)), 0);
    const withBases = entries.map(entry => ({
      ...entry,
      base: maxAbs > 0 ? Math.abs(entry.correlation || 0) / maxAbs : 0,
      group: groupName
    }));
    const sumBase = withBases.reduce((sum, entry) => sum + entry.base, 0);
    withBases.forEach(entry => {
      const recommendedWeight = sumBase > 0
        ? entry.base / sumBase
        : (summaryList.length === 0 ? entry.templateWeight : 0);
      recommended.push({
        metric: entry.metric,
        templateMetric: entry.templateMetric,
        group: groupName,
        templateWeight: entry.templateWeight,
        correlation: entry.correlation,
        recommendedWeight
      });
    });
  });

  return recommended;
};

const buildBlendedTemplateMapsByType = ({ summariesByType, templatesByType, top20BlendByTournament }) => {
  const blendedByType = {};
  const typeOrder = ['POWER', 'TECHNICAL', 'BALANCED'];
  typeOrder.forEach(type => {
    const summary = summariesByType[type] || [];
    const template = templatesByType[type] || null;
    if (!template) return;
    if (!summary.length) return;
    const recommended = buildRecommendedWeights(summary, template);
    const baselineTemplateMaps = buildTemplateMapsFromRecommended(recommended);
    const top20Aggregate = aggregateTop20BlendByType(top20BlendByTournament, type);
    const blendShare = top20Aggregate ? computeTop20BlendShare(top20Aggregate.count) : 0;
    blendedByType[type] = top20Aggregate
      ? blendTemplateMaps(baselineTemplateMaps, top20Aggregate, blendShare)
      : baselineTemplateMaps;
  });
  return blendedByType;
};

module.exports = {
  normalizeMetricAlias,
  computeTop20BlendShare,
  normalizeGroupWeights,
  normalizeMetricWeightsByGroup,
  buildTemplateMapsFromRecommended,
  aggregateTop20BlendByType,
  blendTemplateMaps,
  flattenTemplateMetricWeights,
  buildRecommendedWeights,
  buildBlendedTemplateMapsByType
};
