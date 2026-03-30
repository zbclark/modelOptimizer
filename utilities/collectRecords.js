// Utility to collect historical records (shared)
const fs = require('fs');
/**
 * Module: collectRecords
 * Purpose: Load CSV inputs and collect normalized records for runs.
 */

const path = require('path');
const { loadCsv } = require('./csvLoader');
const { extractHistoricalRowsFromSnapshotPayload } = require('./extractHistoricalRows');

// Helper functions (minimal, for shared use)
const isHistoricalFile = (filePath) => filePath.toLowerCase().includes('historical data') && filePath.toLowerCase().endsWith('.csv');

const walkDir = (dir) => {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walkDir(fullPath));
    } else {
      entries.push(fullPath);
    }
  });
  return entries;
};

const collectRecords = async ({
  years = [],
  tours = [],
  dataDir,
  datagolfApiKey,
  datagolfCacheDir,
  datagolfHistoricalTtlMs,
  getDataGolfHistoricalRounds,
  includeApi = false,
  preferApi = false,
  preferCache = false,
  returnMeta = false
}) => {
  const allRows = [];
  const shouldFetchApi = years.length && tours.length && getDataGolfHistoricalRounds;
  const meta = {
    years,
    tours,
    dataDir,
    preferApi,
    preferCache,
    includeApi,
    ttlMs: datagolfHistoricalTtlMs,
    refreshPolicy: datagolfHistoricalTtlMs === 0 ? 'force-refresh' : (preferCache ? 'prefer-cache' : 'default'),
    api: { cache: 0, cacheStale: 0, api: 0, missingKey: 0, missingYear: 0, errors: 0 },
    csv: { files: 0, rows: 0 },
    rowsFromApi: 0,
    rowsFromCsv: 0
  };

  const fetchApiRows = async () => {
    for (const tour of tours) {
      for (const year of years) {
        try {
          const apiSnapshot = await getDataGolfHistoricalRounds({
            apiKey: datagolfApiKey,
            cacheDir: datagolfCacheDir,
            ttlMs: datagolfHistoricalTtlMs,
            allowStale: true,
            preferCache,
            tour,
            eventId: 'all',
            year,
            fileFormat: 'json'
          });
          const source = apiSnapshot?.source || 'unknown';
          if (source === 'cache') meta.api.cache += 1;
          else if (source === 'cache-stale') meta.api.cacheStale += 1;
          else if (source === 'api') meta.api.api += 1;
          else if (source === 'missing-key') meta.api.missingKey += 1;
          else if (source === 'missing-year') meta.api.missingYear += 1;

          const apiRows = extractHistoricalRowsFromSnapshotPayload(apiSnapshot?.payload);
          if (apiRows.length > 0) {
            allRows.push(...apiRows);
            meta.rowsFromApi += apiRows.length;
          }
        } catch {
          meta.api.errors += 1;
        }
      }
    }
  };

  if (shouldFetchApi && preferApi) {
    await fetchApiRows();
  }

  if (!preferApi && dataDir && fs.existsSync(dataDir)) {
    const files = walkDir(dataDir).filter(isHistoricalFile);
    meta.csv.files += files.length;
    for (const filePath of files) {
      try {
        const rows = loadCsv(filePath, { skipFirstColumn: true })
          .filter(Boolean);
        allRows.push(...rows);
        meta.csv.rows += rows.length;
        meta.rowsFromCsv += rows.length;
      } catch {
        // Ignore
      }
    }
  }

  if ((allRows.length === 0 || includeApi) && shouldFetchApi && !preferApi) {
    await fetchApiRows();
  }

  if (preferApi && allRows.length === 0 && dataDir && fs.existsSync(dataDir)) {
    const files = walkDir(dataDir).filter(isHistoricalFile);
    meta.csv.files += files.length;
    for (const filePath of files) {
      try {
        const rows = loadCsv(filePath, { skipFirstColumn: true })
          .filter(Boolean);
        allRows.push(...rows);
        meta.csv.rows += rows.length;
        meta.rowsFromCsv += rows.length;
      } catch {
        // Ignore
      }
    }
  }

  return returnMeta ? { rows: allRows, meta } : allRows;
};

module.exports = collectRecords;
