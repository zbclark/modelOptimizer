const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizePercentile = value => {
  if (!Number.isFinite(value)) return null;
  const normalized = value > 1 ? value / 100 : value;
  if (!Number.isFinite(normalized)) return null;
  return clamp(normalized, 0, 1);
};

const normalizeSelectionMode = value => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'probability';
  if (['edge', 'edge_only'].includes(raw)) return 'edge';
  if (['probability', 'p_model', 'pmodel', 'prob'].includes(raw)) return 'probability';
  if (['hybrid'].includes(raw)) return 'hybrid';
  return raw;
};

const computeEdgeZCutoff = (values, percentile) => {
  if (!Array.isArray(values) || !values.length) return null;
  const normalized = normalizePercentile(percentile);
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - normalized) * (sorted.length - 1))));
  return sorted[idx];
};

const applyEdgeZPercentile = (rows, percentile, options = {}) => {
  const normalized = normalizePercentile(percentile);
  if (!Number.isFinite(normalized) || normalized <= 0) return rows;
  const scope = String(options.scope || 'market').trim().toLowerCase();
  const getKey = typeof options.getKey === 'function' ? options.getKey : (() => 'all');
  if (scope !== 'market') {
    const values = rows.map(row => Number(row.edge_z)).filter(Number.isFinite);
    const cutoff = computeEdgeZCutoff(values, normalized);
    if (!Number.isFinite(cutoff)) return rows;
    return rows.filter(row => Number.isFinite(Number(row.edge_z)) && Number(row.edge_z) >= cutoff);
  }

  const grouped = new Map();
  rows.forEach(row => {
    const key = getKey(row) || 'unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const filtered = [];
  grouped.forEach(group => {
    const values = group.map(row => Number(row.edge_z)).filter(Number.isFinite);
    const cutoff = computeEdgeZCutoff(values, normalized);
    if (!Number.isFinite(cutoff)) {
      filtered.push(...group);
      return;
    }
    group.forEach(row => {
      const value = Number(row.edge_z);
      if (Number.isFinite(value) && value >= cutoff) {
        filtered.push(row);
      }
    });
  });

  return filtered;
};

const getSelectionComparator = ({ mode, edgeTieDelta = 0, pModelTieDelta = 0, preferMatchup = false } = {}) => {
  const normalizedMode = normalizeSelectionMode(mode || 'probability');
  return (a, b) => {
    const aEdge = Number(a.edge);
    const bEdge = Number(b.edge);
    const aModel = Number(a.p_model);
    const bModel = Number(b.p_model);
    const edgeDiff = (Number.isFinite(aEdge) ? aEdge : -Infinity) - (Number.isFinite(bEdge) ? bEdge : -Infinity);
    const modelDiff = (Number.isFinite(aModel) ? aModel : -Infinity) - (Number.isFinite(bModel) ? bModel : -Infinity);

    if (normalizedMode === 'edge') {
      if (edgeDiff !== 0) return edgeDiff > 0 ? -1 : 1;
      if (modelDiff !== 0) return modelDiff > 0 ? -1 : 1;
    } else {
      if (modelDiff !== 0) return modelDiff > 0 ? -1 : 1;
      if (edgeDiff !== 0) return edgeDiff > 0 ? -1 : 1;
    }

    if (preferMatchup) {
      const isTieOnEdge = Number.isFinite(edgeTieDelta) ? Math.abs(edgeDiff) <= edgeTieDelta : false;
      const isTieOnModel = Number.isFinite(pModelTieDelta) ? Math.abs(modelDiff) <= pModelTieDelta : false;
      if (isTieOnEdge && isTieOnModel) {
        const aMatch = Boolean(a.isMatchup);
        const bMatch = Boolean(b.isMatchup);
        if (aMatch !== bMatch) return aMatch ? -1 : 1;
      }
    }

    return 0;
  };
};

const rankCandidates = (rows, options = {}) => {
  const comparator = getSelectionComparator(options);
  return [...rows].sort(comparator);
};

module.exports = {
  normalizePercentile,
  normalizeSelectionMode,
  applyEdgeZPercentile,
  computeEdgeZCutoff,
  getSelectionComparator,
  rankCandidates
};
