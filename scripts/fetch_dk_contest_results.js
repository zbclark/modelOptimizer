const path = require('path');

const { fetchContestWithCache, DEFAULT_BASE_URL } = require('../utilities/draftkingsContestClient');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.replace(/^--/, '').trim();
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
};

const parseListArg = value => {
  if (!value) return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const main = async () => {
  const args = parseArgs();
  const contestIds = parseListArg(args.contestIds || args.contest_ids || args.ids);
  const baseUrl = args.baseUrl || args.base_url || DEFAULT_BASE_URL;
  const force = String(args.force || '').toLowerCase() === 'true';

  if (!contestIds.length) {
    console.error('❌ Provide --contestIds as a comma-separated list.');
    process.exit(1);
  }

  for (const contestId of contestIds) {
    try {
      const result = await fetchContestWithCache({ contestId, baseUrl, force });
      const relPath = path.relative(process.cwd(), result.filePath);
      const status = result.cached ? 'cached' : 'fetched';
      console.log(`✓ ${status}: ${contestId} -> ${relPath}`);
    } catch (error) {
      console.error(`❌ Failed to fetch contest ${contestId}: ${error.message}`);
    }
  }
};

main();
