/**
 * Module: argParser
 * Purpose: Lightweight CLI argument parsing helpers.
 */

const normalizeToken = token => String(token || '').trim();

const parseArgs = (argv = []) => {
  const args = Array.isArray(argv) ? argv : [];
  const entries = new Map();
  const flags = new Set();

  for (let i = 0; i < args.length; i += 1) {
    const tokenRaw = args[i];
    if (!tokenRaw || typeof tokenRaw !== 'string' || !tokenRaw.startsWith('-')) continue;
    const token = normalizeToken(tokenRaw);

    if (token.includes('=')) {
      const [key, ...rest] = token.split('=');
      const value = rest.join('=');
      if (key) entries.set(key, value);
      continue;
    }

    const next = args[i + 1];
    if (next !== undefined && next !== null && typeof next === 'string' && !next.startsWith('-')) {
      entries.set(token, normalizeToken(next));
      i += 1;
      continue;
    }

    flags.add(token);
  }

  const hasFlag = (candidates = []) => {
    return candidates.some(candidate => flags.has(candidate) || entries.has(candidate));
  };

  const getValue = (candidates = []) => {
    for (const candidate of candidates) {
      if (entries.has(candidate)) return entries.get(candidate);
    }
    return null;
  };

  return {
    flags,
    entries,
    hasFlag,
    getValue
  };
};

module.exports = {
  parseArgs
};
