/**
 * Module: validationSummaries
 * Purpose: Summary builders for validation outputs.
 */

const { METRIC_ORDER } = require('./validationConstants');
const { determineDetectedCourseType } = require('./courseTypeUtils');
const { formatTournamentDisplayName } = require('./namingUtils');

const buildCorrelationSummary = metricAnalyses => {
  const aggregates = new Map();
  metricAnalyses.forEach(analysis => {
    analysis.metrics.forEach(entry => {
      const key = entry.metric;
      const record = aggregates.get(key) || { metric: key, sumCorrelation: 0, sumDelta: 0, count: 0 };
      record.sumCorrelation += entry.correlation;
      record.sumDelta += typeof entry.delta === 'number' ? entry.delta : 0;
      record.count += 1;
      aggregates.set(key, record);
    });
  });

  const sortIndex = new Map(METRIC_ORDER.map((metric, index) => [metric, index]));
  const metrics = Array.from(aggregates.values())
    .map(entry => ({
      metric: entry.metric,
      avgDelta: entry.count > 0 ? entry.sumDelta / entry.count : 0,
      avgCorrelation: entry.count > 0 ? entry.sumCorrelation / entry.count : 0,
      samples: entry.count
    }))
    .sort((a, b) => {
      const indexA = sortIndex.has(a.metric) ? sortIndex.get(a.metric) : Number.MAX_SAFE_INTEGER;
      const indexB = sortIndex.has(b.metric) ? sortIndex.get(b.metric) : Number.MAX_SAFE_INTEGER;
      if (indexA !== indexB) return indexA - indexB;
      return a.metric.localeCompare(b.metric);
    });

  return metrics;
};

const buildCourseTypeClassificationEntries = ({ metricAnalyses, season, top20BlendByTournament = new Map() }) => {
  const byKey = new Map();
  const normalizeKey = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const sourcePriority = source => {
    const normalized = String(source || '').trim().toLowerCase();
    if (normalized === 'top20_blend') return 3;
    if (normalized === 'config_csv') return 2;
    return 1;
  };
  (metricAnalyses || []).forEach(analysis => {
    const detectedType = analysis?.detectedCourseType || determineDetectedCourseType(analysis?.metrics || []);
    if (!analysis?.tournament || !analysis?.courseType || !detectedType) return;
    const baseName = formatTournamentDisplayName(analysis.tournament);
    const displayName = baseName && season ? `${baseName} (${season})` : baseName || analysis.tournament;
    const blendInfo = top20BlendByTournament.get(analysis.tournament) || null;
    const resolvedCourseType = detectedType || analysis.courseType;
    const resolvedSource = analysis.courseTypeSource || analysis.source || 'metric_analysis';
    const entry = {
      tournament: analysis.tournament,
      displayName,
      eventId: analysis.eventId || null,
      courseType: resolvedCourseType,
      source: resolvedSource,
      alignmentScores: blendInfo?.scores || null,
      blendSource: blendInfo?.sourcePath || null
    };

    const key = entry.eventId ? String(entry.eventId).trim() : normalizeKey(entry.tournament);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      return;
    }

    const existingPriority = sourcePriority(existing.source);
    const entryPriority = sourcePriority(entry.source);
    if (entryPriority > existingPriority) {
      byKey.set(key, entry);
      return;
    }

    if (entryPriority === existingPriority) {
      const existingBlend = !!existing.blendSource;
      const entryBlend = !!entry.blendSource;
      if (entryBlend && !existingBlend) {
        byKey.set(key, entry);
      }
    }
  });
  return Array.from(byKey.values());
};

module.exports = {
  buildCorrelationSummary,
  buildCourseTypeClassificationEntries
};
