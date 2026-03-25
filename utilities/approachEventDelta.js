/**
 * Module: approachEventDelta
 * Purpose: Shared helpers for event-aligned approach delta derivation.
 */

const { METRIC_DEFS } = require('./approachDelta');
const { normalizeApproachSG } = require('../core/modelCore');

const EVENT_ONLY_LOW_DATA_THRESHOLD = 0;

const normalizeApproachRateValue = value => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value > 1 ? value / 100 : value;
};

const resolveDeltaShotCountKey = metricKey => {
  const suffixes = ['gir_rate', 'good_shot_rate', 'poor_shot_avoid_rate', 'proximity_per_shot', 'sg_per_shot'];
  const suffixMatch = suffixes.find(suffix => metricKey.endsWith(`_${suffix}`));
  if (!suffixMatch) return null;
  return metricKey.replace(new RegExp(`_${suffixMatch}$`), '_shot_count');
};

const parseApproachNumber = (value, isPercent = false) => {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[%,$]/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (isPercent) return parsed > 1 ? parsed / 100 : parsed;
  return parsed;
};

const buildApproachIndex = rows => {
  const index = new Map();
  (rows || []).forEach(row => {
    const dgId = row?.dg_id !== undefined && row?.dg_id !== null
      ? String(row.dg_id).split('.')[0].trim()
      : '';
    if (!dgId) return;
    const metrics = {};
    (METRIC_DEFS || []).forEach(def => {
      metrics[def.key] = parseApproachNumber(row?.[def.key], def.isPercent);
    });
    index.set(dgId, { dgId, metrics });
  });
  return index;
};

const buildEventOnlyApproachRowsFromSnapshots = ({ beforeRows, afterRows }) => {
  const beforeIndex = buildApproachIndex(beforeRows || []);
  const afterIndex = buildApproachIndex(afterRows || []);
  const allIds = new Set([...beforeIndex.keys(), ...afterIndex.keys()]);
  const rows = [];
  let playersWithShots = 0;

  allIds.forEach(dgId => {
    const before = beforeIndex.get(dgId);
    const after = afterIndex.get(dgId);
    if (!before && !after) return;

    const row = { dg_id: dgId };
    let hasShots = false;

    (METRIC_DEFS || []).forEach(def => {
      const key = def.key;
      const beforeValue = before?.metrics?.[key] ?? null;
      const afterValue = after?.metrics?.[key] ?? null;

      if (key.endsWith('_shot_count')) {
        const deltaShots = (afterValue ?? 0) - (beforeValue ?? 0);
        if (deltaShots > 0) {
          row[key] = deltaShots;
          hasShots = true;
        } else {
          row[key] = null;
        }
        return;
      }

      if (key.endsWith('_low_data_indicator')) {
        const bucket = key.replace('_low_data_indicator', '');
        const shotKey = `${bucket}_shot_count`;
        const beforeShots = before?.metrics?.[shotKey] ?? null;
        const afterShots = after?.metrics?.[shotKey] ?? null;
        const deltaShots = (afterShots ?? 0) - (beforeShots ?? 0);
        const flag = (beforeValue === 1 || afterValue === 1 || (deltaShots > 0 && deltaShots < EVENT_ONLY_LOW_DATA_THRESHOLD)) ? 1 : 0;
        row[key] = flag;
        return;
      }

      const shotCountKey = resolveDeltaShotCountKey(key);
      if (!shotCountKey) {
        row[key] = afterValue ?? beforeValue ?? null;
        return;
      }

      const beforeShots = before?.metrics?.[shotCountKey] ?? null;
      const afterShots = after?.metrics?.[shotCountKey] ?? null;
      const deltaShots = (afterShots ?? 0) - (beforeShots ?? 0);
      const hasAfterShots = typeof afterShots === 'number' && Number.isFinite(afterShots) && afterShots > 0;
      const hasBeforeShots = typeof beforeShots === 'number' && Number.isFinite(beforeShots) && beforeShots > 0;
      if (!hasAfterShots || afterValue === null) {
        row[key] = null;
        return;
      }

      if (!hasBeforeShots || beforeValue === null || deltaShots <= 0) {
        row[key] = afterValue;
        hasShots = true;
        return;
      }

      const eventValue = ((afterValue * afterShots) - (beforeValue * beforeShots)) / deltaShots;
      row[key] = Number.isFinite(eventValue) ? eventValue : null;
      if (deltaShots > 0) hasShots = true;
    });

    if (hasShots) {
      playersWithShots += 1;
      rows.push(row);
    }
  });

  return { rows, playersWithShots };
};

const buildEventOnlyApproachRowsFromDeltaRows = deltaRows => {
  if (!Array.isArray(deltaRows)) return [];
  const mapped = deltaRows.map(row => {
    const dgId = row?.dg_id !== undefined && row?.dg_id !== null
      ? String(row.dg_id).split('.')[0].trim()
      : '';
    if (!dgId) return null;
    const output = {
      dg_id: dgId,
      player_name: row?.player_name || row?.playerName || null
    };
    let hasShots = false;

    (METRIC_DEFS || []).forEach(def => {
      const key = def.key;
      const prevValue = row?.[`prev_${key}`] ?? null;
      const currValue = row?.[`curr_${key}`] ?? null;

      if (key.endsWith('_shot_count')) {
        const deltaShots = (currValue ?? 0) - (prevValue ?? 0);
        if (deltaShots > 0) {
          output[key] = deltaShots;
          hasShots = true;
        } else {
          output[key] = null;
        }
        return;
      }

      if (key.endsWith('_low_data_indicator')) {
        const bucket = key.replace('_low_data_indicator', '');
        const shotKey = `${bucket}_shot_count`;
        const prevShots = row?.[`prev_${shotKey}`] ?? null;
        const currShots = row?.[`curr_${shotKey}`] ?? null;
        const deltaShots = (currShots ?? 0) - (prevShots ?? 0);
        const flag = (prevValue === 1 || currValue === 1 || (deltaShots > 0 && deltaShots < EVENT_ONLY_LOW_DATA_THRESHOLD)) ? 1 : 0;
        output[key] = flag;
        return;
      }

      const shotCountKey = resolveDeltaShotCountKey(key);
      if (!shotCountKey) {
        output[key] = currValue ?? prevValue ?? null;
        return;
      }

      const prevShots = row?.[`prev_${shotCountKey}`] ?? null;
      const currShots = row?.[`curr_${shotCountKey}`] ?? null;
      const deltaShots = (currShots ?? 0) - (prevShots ?? 0);
      const hasAfterShots = typeof currShots === 'number' && Number.isFinite(currShots) && currShots > 0;
      const hasBeforeShots = typeof prevShots === 'number' && Number.isFinite(prevShots) && prevShots > 0;

      if (!hasAfterShots || currValue === null) {
        output[key] = null;
        return;
      }

      if (!hasBeforeShots || prevValue === null || deltaShots <= 0) {
        output[key] = currValue;
        hasShots = true;
        return;
      }

      const eventValue = ((currValue * currShots) - (prevValue * prevShots)) / deltaShots;
      output[key] = Number.isFinite(eventValue) ? eventValue : null;
      if (deltaShots > 0) hasShots = true;
    });

    return hasShots ? output : null;
  }).filter(Boolean);
  return mapped;
};

const buildApproachMetricValuesFromRow = row => {
  if (!row || typeof row !== 'object') return null;
  const under100GIR = normalizeApproachRateValue(row['50_100_fw_gir_rate']);
  const under100SG = typeof row['50_100_fw_sg_per_shot'] === 'number'
    ? normalizeApproachSG(row['50_100_fw_sg_per_shot'])
    : null;
  const under100Prox = typeof row['50_100_fw_proximity_per_shot'] === 'number'
    ? row['50_100_fw_proximity_per_shot']
    : null;

  const fw150GIR = normalizeApproachRateValue(row['100_150_fw_gir_rate']);
  const fw150SG = typeof row['100_150_fw_sg_per_shot'] === 'number'
    ? normalizeApproachSG(row['100_150_fw_sg_per_shot'])
    : null;
  const fw150Prox = typeof row['100_150_fw_proximity_per_shot'] === 'number'
    ? row['100_150_fw_proximity_per_shot']
    : null;

  const rough150GIR = normalizeApproachRateValue(row['under_150_rgh_gir_rate']);
  const rough150SG = typeof row['under_150_rgh_sg_per_shot'] === 'number'
    ? normalizeApproachSG(row['under_150_rgh_sg_per_shot'])
    : null;
  const rough150Prox = typeof row['under_150_rgh_proximity_per_shot'] === 'number'
    ? row['under_150_rgh_proximity_per_shot']
    : null;

  const roughOver150GIR = normalizeApproachRateValue(row['over_150_rgh_gir_rate']);
  const roughOver150SG = typeof row['over_150_rgh_sg_per_shot'] === 'number'
    ? normalizeApproachSG(row['over_150_rgh_sg_per_shot'])
    : null;
  const roughOver150Prox = typeof row['over_150_rgh_proximity_per_shot'] === 'number'
    ? row['over_150_rgh_proximity_per_shot']
    : null;

  const fw200GIR = normalizeApproachRateValue(row['150_200_fw_gir_rate']);
  const fw200SG = typeof row['150_200_fw_sg_per_shot'] === 'number'
    ? normalizeApproachSG(row['150_200_fw_sg_per_shot'])
    : null;
  const fw200Prox = typeof row['150_200_fw_proximity_per_shot'] === 'number'
    ? row['150_200_fw_proximity_per_shot']
    : null;

  const fw200plusGIR = normalizeApproachRateValue(row['over_200_fw_gir_rate']);
  const fw200plusSG = typeof row['over_200_fw_sg_per_shot'] === 'number'
    ? normalizeApproachSG(row['over_200_fw_sg_per_shot'])
    : null;
  const fw200plusProx = typeof row['over_200_fw_proximity_per_shot'] === 'number'
    ? row['over_200_fw_proximity_per_shot']
    : null;

  return {
    approach100GIR: under100GIR,
    approach100SG: under100SG,
    approach100Prox: under100Prox,
    approach150fwGIR: fw150GIR,
    approach150fwSG: fw150SG,
    approach150fwProx: fw150Prox,
    approach150roughGIR: rough150GIR,
    approach150roughSG: rough150SG,
    approach150roughProx: rough150Prox,
    approachOver150roughGIR: roughOver150GIR,
    approachOver150roughSG: roughOver150SG,
    approachOver150roughProx: roughOver150Prox,
    approach200fwGIR: fw200GIR,
    approach200fwSG: fw200SG,
    approach200fwProx: fw200Prox,
    approach200plusGIR: fw200plusGIR,
    approach200plusSG: fw200plusSG,
    approach200plusProx: fw200plusProx
  };
};

module.exports = {
  resolveDeltaShotCountKey,
  buildEventOnlyApproachRowsFromSnapshots,
  buildEventOnlyApproachRowsFromDeltaRows,
  buildApproachMetricValuesFromRow
};
