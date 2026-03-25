const clamp01 = value => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const normalizeShotDistribution = courseSetupWeights => {
  const under100 = typeof courseSetupWeights?.under100 === 'number' ? courseSetupWeights.under100 : 0;
  const from100to150 = typeof courseSetupWeights?.from100to150 === 'number' ? courseSetupWeights.from100to150 : 0;
  const from150to200 = typeof courseSetupWeights?.from150to200 === 'number' ? courseSetupWeights.from150to200 : 0;
  const over200 = typeof courseSetupWeights?.over200 === 'number' ? courseSetupWeights.over200 : 0;
  const total = under100 + from100to150 + from150to200 + over200;
  if (total <= 0) {
    return {
      total: 0,
      distribution: [0, 0, 0, 0],
      map: {
        under100: 0,
        from100to150: 0,
        from150to200: 0,
        over200: 0
      }
    };
  }
  const distribution = [under100, from100to150, from150to200, over200].map(value => value / total);
  return {
    total,
    distribution,
    map: {
      under100: distribution[0],
      from100to150: distribution[1],
      from150to200: distribution[2],
      over200: distribution[3]
    }
  };
};

const applyShotDistributionToMetricWeights = (metricWeights = {}, courseSetupWeights = {}) => {
  const normalized = { ...metricWeights };
  const normalizedShot = normalizeShotDistribution(courseSetupWeights);
  if (normalizedShot.total <= 0) return normalized;

  const [distUnder100, dist100to150, dist150to200, distOver200] = normalizedShot.distribution;

  const applyToGroup = (groupName, metricNames) => {
    const weights = metricNames.map(name => {
      const key = `${groupName}::${name}`;
      const value = normalized[key];
      return typeof value === 'number' ? value : 0;
    });
    const signs = weights.map(value => (Math.sign(value) || 1));
    const totalAbs = weights.reduce((sum, value) => sum + Math.abs(value), 0);
    if (totalAbs <= 0) return;

    const adjusted = [
      distUnder100 * totalAbs * signs[0],
      (dist100to150 * totalAbs / 2) * signs[1],
      (dist100to150 * totalAbs / 2) * signs[2],
      dist150to200 * totalAbs * signs[3],
      (distOver200 * totalAbs / 2) * signs[4],
      (distOver200 * totalAbs / 2) * signs[5]
    ];

    metricNames.forEach((name, index) => {
      const key = `${groupName}::${name}`;
      normalized[key] = adjusted[index];
    });
  };

  applyToGroup('Scoring', [
    'Scoring: Approach <100 SG',
    'Scoring: Approach <150 FW SG',
    'Scoring: Approach <150 Rough SG',
    'Scoring: Approach <200 FW SG',
    'Scoring: Approach >200 FW SG',
    'Scoring: Approach >150 Rough SG'
  ]);

  applyToGroup('Course Management', [
    'Course Management: Approach <100 Prox',
    'Course Management: Approach <150 FW Prox',
    'Course Management: Approach <150 Rough Prox',
    'Course Management: Approach <200 FW Prox',
    'Course Management: Approach >200 FW Prox',
    'Course Management: Approach >150 Rough Prox'
  ]);

  return normalized;
};

const applyShotDistributionToApproachGroupWeights = (groupWeights = {}, courseSetupWeights = {}, options = {}) => {
  const normalized = { ...groupWeights };
  const normalizedShot = normalizeShotDistribution(courseSetupWeights);
  if (normalizedShot.total <= 0) return normalized;

  const distribution = {
    'Approach - Short (<100)': normalizedShot.map.under100,
    'Approach - Mid (100-150)': normalizedShot.map.from100to150,
    'Approach - Long (150-200)': normalizedShot.map.from150to200,
    'Approach - Very Long (>200)': normalizedShot.map.over200
  };

  const approachKeys = Object.keys(distribution).filter(key => typeof normalized[key] === 'number');
  if (approachKeys.length === 0) return normalized;

  const totalApproach = approachKeys.reduce((sum, key) => sum + (normalized[key] || 0), 0);
  if (totalApproach <= 0) return normalized;

  const distSum = approachKeys.reduce((sum, key) => sum + (distribution[key] || 0), 0) || 1;
  approachKeys.forEach(key => {
    normalized[key] = (distribution[key] || 0) / distSum * totalApproach;
  });

  const normalizeWeights = typeof options.normalizeWeights === 'function' ? options.normalizeWeights : null;
  return normalizeWeights ? normalizeWeights(normalized) : normalized;
};

module.exports = {
  clamp01,
  normalizeShotDistribution,
  applyShotDistributionToMetricWeights,
  applyShotDistributionToApproachGroupWeights
};
