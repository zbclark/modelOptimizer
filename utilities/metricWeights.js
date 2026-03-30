function flattenMetricWeights(metricConfigOrWeights, maybeWeights) {
  const hasMetricConfig = maybeWeights !== undefined;
  const metricConfig = hasMetricConfig ? metricConfigOrWeights : null;
  const metricWeights = hasMetricConfig ? maybeWeights : metricConfigOrWeights;

  if (!metricWeights || typeof metricWeights !== 'object') return {};

  if (metricConfig && Array.isArray(metricConfig.groups)) {
    const flattened = {};
    metricConfig.groups.forEach(group => {
      group.metrics.forEach(metric => {
        const flatKey = `${group.name}::${metric.name}`;
        if (Object.prototype.hasOwnProperty.call(metricWeights, flatKey)) {
          const value = metricWeights[flatKey];
          flattened[flatKey] = typeof value === 'number' ? value : (value?.weight ?? null);
          return;
        }
        const groupBlock = metricWeights[group.name];
        if (groupBlock && Object.prototype.hasOwnProperty.call(groupBlock, metric.name)) {
          const entry = groupBlock[metric.name];
          flattened[flatKey] = typeof entry === 'number' ? entry : (entry?.weight ?? null);
        }
      });
    });
    return flattened;
  }

  const flatWeights = {};
  const keys = Object.keys(metricWeights);
  const hasFlat = keys.some(key => key.includes('::') && typeof metricWeights[key] === 'number');

  if (hasFlat) {
    keys.forEach(key => {
      if (typeof metricWeights[key] === 'number') {
        flatWeights[key] = metricWeights[key];
      }
    });
    return flatWeights;
  }

  keys.forEach(groupName => {
    const groupMetrics = metricWeights[groupName];
    if (!groupMetrics || typeof groupMetrics !== 'object') return;
    Object.entries(groupMetrics).forEach(([metricName, metricConfigEntry]) => {
      if (metricConfigEntry && typeof metricConfigEntry.weight === 'number') {
        flatWeights[`${groupName}::${metricName}`] = metricConfigEntry.weight;
      }
    });
  });

  return flatWeights;
}

module.exports = { flattenMetricWeights };
