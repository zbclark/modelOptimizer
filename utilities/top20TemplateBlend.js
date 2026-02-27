const DEFAULT_BLEND_OPTIONS = {
  signalBlend: {
    correlation: 0.55,
    logistic: 0.45
  },
  templateBlend: {
    baseline: 0.7,
    model: 0.3
  },
  guardrails: {
    minGroupWeight: 0.03,
    maxGroupWeight: 0.35,
    maxGroupShift: 0.08,
    maxMetricShift: 0.2
  }
};

const normalizeMetricLabel = (label) => String(label || '')
  .replace(/^(Scoring|Course Management):\s*/i, '')
  .trim();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeWeights = (weightMap) => {
  const entries = Object.entries(weightMap || {});
  const total = entries.reduce((sum, [, value]) => sum + Math.abs(value || 0), 0);
  if (!total) return {};
  return entries.reduce((acc, [key, value]) => {
    acc[key] = (value || 0) / total;
    return acc;
  }, {});
};

const buildSignalMap = (top20Correlations = [], top20Logistic = null, metricLabels = [], options = {}) => {
  const blend = options.signalBlend || DEFAULT_BLEND_OPTIONS.signalBlend;
  const corrEntries = Array.isArray(top20Correlations)
    ? top20Correlations.filter(entry => typeof entry?.correlation === 'number')
    : [];

  const corrMap = {};
  if (corrEntries.length) {
    const total = corrEntries.reduce((sum, entry) => sum + Math.abs(entry.correlation), 0) || 0;
    corrEntries.forEach(entry => {
      const key = normalizeMetricLabel(entry.label);
      if (!key) return;
      const value = entry.correlation;
      corrMap[key] = total > 0 ? value / total : value;
    });
  }

  const logisticMap = {};
  if (top20Logistic && top20Logistic.success && Array.isArray(top20Logistic.weights) && metricLabels.length) {
    const weights = top20Logistic.weights.map(value => Number(value) || 0);
    const total = weights.reduce((sum, value) => sum + Math.abs(value), 0) || 0;
    weights.forEach((value, idx) => {
      const key = normalizeMetricLabel(metricLabels[idx]);
      if (!key) return;
      logisticMap[key] = total > 0 ? value / total : value;
    });
  }

  const merged = {};
  const keys = new Set([...Object.keys(corrMap), ...Object.keys(logisticMap)]);
  keys.forEach(key => {
    const corrWeight = corrMap[key] || 0;
    const logisticWeight = logisticMap[key] || 0;
    merged[key] = (blend.correlation * corrWeight) + (blend.logistic * logisticWeight);
  });

  return normalizeWeights(merged);
};

const buildMetricLabelToGroupMap = (metricConfig) => {
  const map = {};
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return map;
  metricConfig.groups.forEach(group => {
    group.metrics.forEach(metric => {
      map[normalizeMetricLabel(metric.name)] = group.name;
    });
  });
  return map;
};

const buildSuggestedGroupWeights = (metricConfig, signalMap = {}) => {
  const labelToGroup = buildMetricLabelToGroupMap(metricConfig);
  const totals = {};
  Object.entries(signalMap).forEach(([label, weight]) => {
    const group = labelToGroup[label];
    if (!group) return;
    totals[group] = (totals[group] || 0) + Math.abs(weight || 0);
  });
  return normalizeWeights(totals);
};

const buildSuggestedMetricWeights = (metricConfig, signalMap = {}) => {
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return {};
  const metricWeights = {};
  metricConfig.groups.forEach(group => {
    const groupEntries = group.metrics.map(metric => {
      const key = normalizeMetricLabel(metric.name);
      return { name: metric.name, weight: signalMap[key] || 0 };
    });
    const total = groupEntries.reduce((sum, entry) => sum + Math.abs(entry.weight), 0);
    groupEntries.forEach(entry => {
      const normalized = total > 0 ? entry.weight / total : 0;
      metricWeights[`${group.name}::${entry.name}`] = normalized;
    });
  });
  return metricWeights;
};

const applyGroupGuardrails = (baseline, suggested, guardrails) => {
  const output = {};
  const minWeight = guardrails.minGroupWeight ?? 0;
  const maxWeight = guardrails.maxGroupWeight ?? 1;
  const maxShift = guardrails.maxGroupShift ?? 1;

  Object.entries(baseline || {}).forEach(([group, baseValue]) => {
    const target = typeof suggested[group] === 'number' ? suggested[group] : baseValue;
    const clamped = clamp(target, baseValue - maxShift, baseValue + maxShift);
    output[group] = clamp(clamped, minWeight, maxWeight);
  });

  return normalizeWeights(output);
};

const applyMetricGuardrails = (baseline, suggested, guardrails) => {
  const output = { ...(baseline || {}) };
  const maxShift = guardrails.maxMetricShift ?? 1;

  Object.entries(suggested || {}).forEach(([key, value]) => {
    const baseValue = typeof baseline?.[key] === 'number' ? baseline[key] : 0;
    const baseAbs = Math.abs(baseValue || 0);
    const targetAbs = Math.abs(value || 0);
    const clampedAbs = clamp(targetAbs, Math.max(0, baseAbs - maxShift), baseAbs + maxShift);
    const signed = (value || 0) < 0 ? -clampedAbs : clampedAbs;
    output[key] = clamp(signed, -1, 1);
  });

  return output;
};

const renormalizeMetricWeights = (metricConfig, metricWeights = {}) => {
  if (!metricConfig || !Array.isArray(metricConfig.groups)) return { ...metricWeights };
  const updated = { ...metricWeights };
  metricConfig.groups.forEach(group => {
    const keys = group.metrics.map(metric => `${group.name}::${metric.name}`);
    const total = keys.reduce((sum, key) => sum + Math.abs(updated[key] || 0), 0);
    if (!total) return;
    keys.forEach(key => {
      const value = updated[key] || 0;
      updated[key] = value / total;
    });
  });
  return updated;
};

const blendTemplateWeights = ({
  metricConfig,
  baselineGroupWeights,
  baselineMetricWeights,
  top20Correlations,
  top20Logistic,
  metricLabels,
  options = {}
}) => {
  const resolvedOptions = {
    ...DEFAULT_BLEND_OPTIONS,
    ...options,
    signalBlend: { ...DEFAULT_BLEND_OPTIONS.signalBlend, ...(options.signalBlend || {}) },
    templateBlend: { ...DEFAULT_BLEND_OPTIONS.templateBlend, ...(options.templateBlend || {}) },
    guardrails: { ...DEFAULT_BLEND_OPTIONS.guardrails, ...(options.guardrails || {}) }
  };

  const signalMap = buildSignalMap(top20Correlations, top20Logistic, metricLabels, resolvedOptions);
  const suggestedGroups = buildSuggestedGroupWeights(metricConfig, signalMap);
  const suggestedMetrics = buildSuggestedMetricWeights(metricConfig, signalMap);

  const blendGroup = resolvedOptions.templateBlend;
  const blendedGroupsRaw = {};
  Object.entries(baselineGroupWeights || {}).forEach(([group, baseValue]) => {
    const modelValue = typeof suggestedGroups[group] === 'number' ? suggestedGroups[group] : baseValue;
    blendedGroupsRaw[group] = (blendGroup.baseline * baseValue) + (blendGroup.model * modelValue);
  });

  const blendedMetricRaw = {};
  Object.entries(baselineMetricWeights || {}).forEach(([key, baseValue]) => {
    const modelValue = typeof suggestedMetrics[key] === 'number' ? suggestedMetrics[key] : baseValue;
    blendedMetricRaw[key] = (blendGroup.baseline * baseValue) + (blendGroup.model * modelValue);
  });

  const blendedGroups = applyGroupGuardrails(baselineGroupWeights, blendedGroupsRaw, resolvedOptions.guardrails);
  const clampedMetrics = applyMetricGuardrails(baselineMetricWeights, blendedMetricRaw, resolvedOptions.guardrails);
  const blendedMetrics = renormalizeMetricWeights(metricConfig, clampedMetrics);

  return {
    options: resolvedOptions,
    signalMap,
    suggestedGroups,
    suggestedMetrics,
    blendedGroups,
    blendedMetrics
  };
};

module.exports = {
  DEFAULT_BLEND_OPTIONS,
  buildSignalMap,
  buildSuggestedGroupWeights,
  buildSuggestedMetricWeights,
  blendTemplateWeights
};
