const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');

const readJson = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const hasOddsEntries = payload => {
  if (!payload) return false;
  if (Array.isArray(payload)) return payload.length > 0;
  const candidates = [
    payload.data,
    payload.odds,
    payload.players,
    payload.results,
    payload.match_list
  ];
  return candidates.some(entry => Array.isArray(entry) && entry.length > 0);
};

const resolveManifestEntry = ({ season, eventId, tournamentSlug, tournamentName }) => {
  if (!season) return null;
  const manifestPath = path.resolve(DATA_DIR, String(season), 'manifest.json');
  const manifest = readJson(manifestPath) || [];
  if (eventId) {
    const match = manifest.find(entry => String(entry.eventId) === String(eventId));
    if (match) return match;
  }
  if (tournamentSlug) {
    const match = manifest.find(entry => String(entry.tournamentSlug) === String(tournamentSlug));
    if (match) return match;
  }
  if (tournamentName) {
    const match = manifest.find(entry => String(entry.tournamentName).toLowerCase() === String(tournamentName).toLowerCase());
    if (match) return match;
  }
  return null;
};

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

const runNodeScript = (scriptPath, args, label, options = {}) => {
  const cmd = 'node';
  const fullArgs = [scriptPath, ...args];
  const result = spawnSync(cmd, fullArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    if (options.allowFailure) {
      const message = label ? `⚠️  ${label} failed (continuing).` : '⚠️  Script failed (continuing).';
      console.warn(message);
      return false;
    }
    const message = label ? `❌ ${label} failed.` : '❌ Script failed.';
    console.error(message);
    process.exit(result.status || 1);
  }
  return true;
};

const requireArg = (value, label) => {
  if (!value) {
    console.error(`❌ Missing --${label}.`);
    process.exit(1);
  }
};

const main = () => {
  const args = parseArgs();

  const season = args.season;
  const year = args.year || season;
  const eventId = args.eventId || args.event;
  const tournamentSlug = args.tournamentSlug || args.slug;
  const tournamentName = args.tournamentName || args.name;
  const tour = args.tour || 'pga';
  const market = args.market || 'all';
  const DEFAULT_BOOKS = ['bet365', 'caesars', 'draftkings', 'sportsbook'];
  const book = args.book ? String(args.book).trim().toLowerCase() : null;
  const oddsFormat = args.oddsFormat || args.odds_format || 'decimal';
  const oddsSource = args.oddsSource || args.odds_source || 'historical';
  const normalizedOddsSource = String(oddsSource || 'historical').trim().toLowerCase();
  const oddsPoint = args.oddsPoint || (normalizedOddsSource === 'live' ? 'current' : 'close');
  const skipOddsFetch = args.skipOddsFetch || false;
  const skipModelProbs = args.skipModelProbs || false;
  const skipJoin = args.skipJoin || false;
  const skipEval = args.skipEval || false;
  const skipMonthly = args.skipMonthly || false;
  const skipSummary = args.skipSummary || false;
  const runDk = args.runDk || args.run_dk || false;
  const skipDk = args.skipDk || args.skip_dk || !runDk;
  const stake = args.stake;
  const dkSite = args.dkSite || 'draftkings';
  const dkSlate = args.dkSlate || 'main';
  const dkSlatesArg = args.dkSlates || args.dk_slates || null;
  const dkTopN = args.dkTopN || args.dk_top_n || 20;
  const dkSalaryCap = args.dkSalaryCap || 50000;
  const dkLineupSize = args.dkLineupSize || 6;
  const dkMinSalaryUsed = args.dkMinSalaryUsed || null;
  const dkMinProjPoints = args.dkMinProjPoints || null;
  const dkMaxOwnership = args.dkMaxOwnership || null;
  const dkMaxExposure = args.dkMaxExposure || null;
  const dkOwnershipWeight = args.dkOwnershipWeight || null;
  const dkLock = args.dkLock || args.dk_lock || null;
  const dkExclude = args.dkExclude || args.dk_exclude || null;
  const dkInput = args.dkInput || args.dk_input || null;
  const dkProbThreshold = args.dkProbThreshold || args.dk_prob_threshold || 0.12;
  const dkModelMarket = args.dkModelMarket || args.dk_model_market || 'top_10';
  const dkProbThresholdAlt = args.dkProbThresholdAlt || args.dk_prob_threshold_alt || null;
  const dkModelMarketAlt = args.dkModelMarketAlt || args.dk_model_market_alt || null;
  const includeCurrentYearHistorical = args.includeCurrentYearHistorical
    || args.include_current_year_historical
    || (['historical', 'both'].includes(normalizedOddsSource));

  requireArg(season, 'season');
  requireArg(eventId || tournamentSlug || tournamentName, 'eventId (or tournamentSlug/name)');

  const manifestEntry = resolveManifestEntry({ season, eventId, tournamentSlug, tournamentName });
  const resolvedEventId = eventId || manifestEntry?.eventId || null;

  const resolveHistoricalYears = () => {
    const seasonYear = Number(season || year);
    if (args.years || args.years === '') {
      const raw = String(args.years || '').trim();
      if (raw) {
        const parsed = raw.split(',').map(value => value.trim()).filter(Boolean);
        if (includeCurrentYearHistorical) {
          return parsed;
        }
        const filtered = parsed.filter(value => Number(value) !== seasonYear);
        if (filtered.length !== parsed.length) {
          console.warn(`⚠️  Excluding current season ${seasonYear} from historical years.`);
        }
        return filtered;
      }
    }
    const tourDir = path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'outrights', String(tour || 'pga'));
    if (fs.existsSync(tourDir)) {
      const years = fs.readdirSync(tourDir)
        .filter(entry => /^\d{4}$/.test(entry))
        .sort();
      if (includeCurrentYearHistorical) {
        return years;
      }
      const filtered = years.filter(value => Number(value) !== seasonYear);
      if (!filtered.length && Number.isFinite(seasonYear)) {
        return [String(seasonYear - 1)];
      }
      return filtered;
    }
    if (Number.isFinite(seasonYear)) {
      if (includeCurrentYearHistorical) {
        return [String(seasonYear)];
      }
      return [String(seasonYear - 1)];
    }
    return [String(year)];
  };

  const resolveMarkets = (sourceKey) => {
    const raw = String(market || '').trim().toLowerCase();
    if (raw && raw !== 'all') return [raw];

    if (sourceKey === 'historical') {
      return [
        'win',
        'top_5',
        'top_10',
        'top_20',
        'make_cut',
        'mc'
      ];
    }

    return [
      'win',
      'top_5',
      'top_10',
      'top_20',
      'make_cut',
      'mc',
      'frl',
      'tournament_matchups',
      'round_matchups',
      '3_balls'
    ];
  };

  const supportedModelMarkets = new Set([
    'win',
    'top_5',
    'top_10',
    'top_20',
    'tournament_matchups',
    'round_matchups',
    '3_balls',
    '3balls',
    '3-ball',
    '3ball'
  ]);

  const historicalOutrightBooks = [...DEFAULT_BOOKS];
  const historicalMatchupBooks = [...DEFAULT_BOOKS];

  const resolveBooksForMarket = (marketKey) => {
    if (book) {
      return [book];
    }
    const isMatchupMarket = ['tournament_matchups', 'round_matchups', '3_balls', '3balls', '3-ball', '3ball'].includes(marketKey);
    return isMatchupMarket ? historicalMatchupBooks : historicalOutrightBooks;
  };

  const runForOddsSource = (source, options = {}) => {
    const sourceKey = String(source || '').trim().toLowerCase();
    const yearTag = options.yearTag ? String(options.yearTag).trim() : null;
    const historicalYear = options.yearValue ? String(options.yearValue).trim() : String(year);
    const marketValue = options.marketValue !== undefined ? options.marketValue : args.market;
    const marketSlug = String(marketValue || '').trim().toLowerCase();
    const isMatchupMarket = ['tournament_matchups', 'round_matchups', '3_balls', '3balls', '3-ball', '3ball'].includes(marketSlug);

    let successfulBooks = resolveBooksForMarket(marketSlug);

    if (!skipOddsFetch) {
      if (sourceKey === 'live') {
        const fetchArgs = [
          '--tour', tour,
          '--market', String(marketValue),
          '--oddsFormat', String(oddsFormat),
          '--fileFormat', 'json'
        ];
        if (isMatchupMarket) {
          runNodeScript(path.resolve(__dirname, 'fetch_live_matchups.js'), fetchArgs, 'fetch_live_matchups');
        } else {
          runNodeScript(path.resolve(__dirname, 'fetch_live_odds.js'), fetchArgs, 'fetch_live_odds');
        }
      } else {
        console.log('↪ Skipping historical odds fetch (using cached odds_archive files).');
      }
    }

    if (sourceKey === 'historical') {
      successfulBooks = resolveBooksForMarket(marketSlug);
    }

    if (!skipJoin) {
      let booksToJoin = sourceKey === 'historical' ? successfulBooks : (book ? [book] : successfulBooks);
      if (sourceKey === 'historical') {
        booksToJoin = booksToJoin.filter(nextBook => {
          const archivePath = isMatchupMarket
            ? resolveMatchupsPath({ tour, year: historicalYear, book: nextBook, eventId: eventId || tournamentSlug || tournamentName })
            : resolveOutrightsPath({ tour, year: historicalYear, market: marketValue, book: nextBook, eventId: eventId || tournamentSlug || tournamentName });
          if (archivePath && fs.existsSync(archivePath)) return true;
          console.warn(`⚠️  Missing historical odds archive for ${marketValue} ${nextBook} ${historicalYear} (event ${eventId || tournamentSlug || tournamentName}); skipping join.`);
          return false;
        });
      }
      if (!booksToJoin.length) {
        console.warn(`⚠️  No ${sourceKey} books available for market ${marketValue}; skipping join/eval/summary.`);
        return;
      }
      booksToJoin.forEach(nextBook => {
        if (sourceKey === 'historical') {
          const archivePath = isMatchupMarket
            ? resolveMatchupsPath({ tour, year: historicalYear, book: nextBook, eventId: eventId || tournamentSlug || tournamentName })
            : resolveOutrightsPath({ tour, year: historicalYear, market: marketValue, book: nextBook, eventId: eventId || tournamentSlug || tournamentName });
          const payload = readJson(archivePath);
          if (!hasOddsEntries(payload)) {
            console.warn(`⚠️  Odds payload empty for ${marketValue} ${nextBook} ${historicalYear} (event ${eventId || tournamentSlug || tournamentName}); skipping join.`);
            return;
          }
        }
        const joinArgs = [
          '--season', String(season),
          '--year', String(historicalYear),
          '--tour', String(tour),
          '--market', String(marketValue),
          '--book', String(nextBook),
          '--oddsPoint', String(sourceKey === 'live' ? 'current' : oddsPoint),
          '--oddsSource', String(sourceKey)
        ];
        if (yearTag) {
          joinArgs.push('--yearTag', String(yearTag));
        }
        if (eventId) {
          joinArgs.push('--eventId', String(eventId));
        }
        if (tournamentSlug) {
          joinArgs.push('--tournamentSlug', String(tournamentSlug));
        }
        if (tournamentName) {
          joinArgs.push('--tournamentName', String(tournamentName));
        }
        runNodeScript(
          path.resolve(__dirname, 'build_odds_join.js'),
          joinArgs,
          `build_odds_join (${sourceKey}, ${nextBook})`,
          { allowFailure: sourceKey === 'historical' }
        );
      });
    }

    if (!skipEval) {
      let booksToEval = sourceKey === 'historical' ? successfulBooks : (book ? [book] : successfulBooks);
      if (sourceKey === 'historical') {
        booksToEval = booksToEval.filter(nextBook => {
          const archivePath = isMatchupMarket
            ? resolveMatchupsPath({ tour, year: historicalYear, book: nextBook, eventId: eventId || tournamentSlug || tournamentName })
            : resolveOutrightsPath({ tour, year: historicalYear, market: marketValue, book: nextBook, eventId: eventId || tournamentSlug || tournamentName });
          return archivePath && fs.existsSync(archivePath);
        });
      }
      booksToEval.forEach(nextBook => {
        const evalArgs = [
          '--season', String(season),
          '--market', String(marketValue),
          '--oddsSource', String(sourceKey),
          '--book', String(nextBook)
        ];
        if (yearTag) {
          evalArgs.push('--yearTag', String(yearTag));
        }
        if (eventId) {
          evalArgs.push('--eventId', String(eventId));
        }
        if (tournamentSlug) {
          evalArgs.push('--tournamentSlug', String(tournamentSlug));
        }
        if (tournamentName) {
          evalArgs.push('--tournamentName', String(tournamentName));
        }
        runNodeScript(path.resolve(__dirname, 'run_edge_evaluation.js'), evalArgs, `run_edge_evaluation (${sourceKey}, ${nextBook})`);
      });
    }

    if (!skipMonthly && !options.deferWeekly) {
      const monthlyArgs = [
        '--season', String(season),
        '--market', String(marketValue),
        '--oddsSource', String(sourceKey)
      ];
      const resolvedMonthlyEventId = resolvedEventId || eventId;
      if (resolvedMonthlyEventId) {
        monthlyArgs.push('--eventId', String(resolvedMonthlyEventId));
      }
      if (tournamentSlug) {
        monthlyArgs.push('--tournamentSlug', String(tournamentSlug));
      }
      if (stake !== undefined && stake !== null && stake !== '') {
        monthlyArgs.push('--stake', String(stake));
      }
      runNodeScript(path.resolve(__dirname, 'run_weekly_simulation.js'), monthlyArgs, `run_weekly_simulation (${sourceKey})`);
    }

    if (!skipSummary) {
      let booksToSummarize = sourceKey === 'historical' ? successfulBooks : (book ? [book] : successfulBooks);
      if (sourceKey === 'historical') {
        booksToSummarize = booksToSummarize.filter(nextBook => {
          const archivePath = isMatchupMarket
            ? resolveMatchupsPath({ tour, year: historicalYear, book: nextBook, eventId: eventId || tournamentSlug || tournamentName })
            : resolveOutrightsPath({ tour, year: historicalYear, market: marketValue, book: nextBook, eventId: eventId || tournamentSlug || tournamentName });
          return archivePath && fs.existsSync(archivePath);
        });
      }
      booksToSummarize.forEach(nextBook => {
        const summaryArgs = [
          '--season', String(season),
          '--market', String(marketValue),
          '--oddsSource', String(sourceKey),
          '--book', String(nextBook)
        ];
        if (yearTag) {
          summaryArgs.push('--yearTag', String(yearTag));
        }
        if (tournamentSlug) {
          summaryArgs.push('--tournamentSlug', String(tournamentSlug));
        }
        runNodeScript(path.resolve(__dirname, 'run_wagering_summary.js'), summaryArgs, `run_wagering_summary (${sourceKey}, ${nextBook})`);
      });
    }
  };

  const historicalYears = resolveHistoricalYears();

  const resolveOutrightsPath = ({ tour, year, market, book, eventId }) => {
    const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
    const safeYear = String(year || '').trim();
    const safeMarket = String(market || 'win').trim().toLowerCase() || 'win';
    const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
    const safeEventId = String(eventId || '').trim();
    return path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'outrights', safeTour, safeYear, safeMarket, safeEventId, `${safeBook}.json`);
  };

  const resolveMatchupsPath = ({ tour, year, book, eventId }) => {
    const safeTour = String(tour || 'pga').trim().toLowerCase() || 'pga';
    const safeYear = String(year || '').trim();
    const safeBook = String(book || 'draftkings').trim().toLowerCase() || 'draftkings';
    const safeEventId = String(eventId || '').trim();
    return path.resolve(DATA_DIR, 'wagering', 'odds_archive', 'matchups', safeTour, safeYear, safeEventId, `${safeBook}.json`);
  };

  const runMarketBatch = (sourceKey) => {
    const markets = resolveMarkets(sourceKey);
    markets.forEach(nextMarket => {
    const priorMarket = market;
    args.market = nextMarket;
    const normalizedMarket = String(nextMarket).trim().toLowerCase();
    const isSupportedModel = supportedModelMarkets.has(normalizedMarket);
    const isMatchupMarket = ['tournament_matchups', 'round_matchups', '3_balls', '3balls', '3-ball', '3ball'].includes(normalizedMarket);

    if (!skipModelProbs) {
      if (!isSupportedModel) {
        console.warn(`⚠️  Skipping model_probs for unsupported market: ${nextMarket}`);
      } else {
        const modelArgs = [
          '--season', String(season),
          '--market', String(nextMarket)
        ];
        if (isMatchupMarket) {
          modelArgs.push('--oddsSource', String(sourceKey));
          modelArgs.push('--tour', String(tour));
          modelArgs.push('--year', String(year));
          if (book) {
            modelArgs.push('--book', String(book));
          }
        }
        if (eventId) {
          modelArgs.push('--eventId', String(eventId));
        }
        if (tournamentSlug) {
          modelArgs.push('--tournamentSlug', String(tournamentSlug));
        }
        if (tournamentName) {
          modelArgs.push('--tournamentName', String(tournamentName));
        }
        runNodeScript(path.resolve(__dirname, 'build_model_probs.js'), modelArgs, `build_model_probs (${nextMarket})`);
      }
    }

    if (sourceKey === 'historical') {
      historicalYears.forEach(yearValue => {
        if (!resolvedEventId) {
          console.warn('⚠️  Skipping historical cache update: missing --eventId/--tournamentSlug/--tournamentName.');
        } else {
          const marketKey = String(nextMarket || '').trim().toLowerCase();
          const isMatchupMarket = ['tournament_matchups', 'round_matchups', '3_balls', '3balls', '3-ball', '3ball'].includes(marketKey);
          const booksToFetch = resolveBooksForMarket(marketKey);

          booksToFetch.forEach(nextBook => {
            const archivePath = isMatchupMarket
              ? resolveMatchupsPath({ tour, year: yearValue, book: nextBook, eventId: resolvedEventId })
              : resolveOutrightsPath({ tour, year: yearValue, market: nextMarket, book: nextBook, eventId: resolvedEventId });

            if (archivePath && fs.existsSync(archivePath)) {
              return;
            }

            const fetchArgs = [
              '--type', isMatchupMarket ? 'matchups' : 'outrights',
              '--tour', String(tour),
              '--year', String(yearValue),
              '--eventId', String(resolvedEventId),
              '--book', String(nextBook),
              '--oddsFormat', String(oddsFormat),
              '--fileFormat', 'json'
            ];
            if (!isMatchupMarket) {
              fetchArgs.push('--market', String(nextMarket));
            }
            runNodeScript(
              path.resolve(__dirname, 'fetch_historical_odds.js'),
              fetchArgs,
              `fetch_historical_odds (${yearValue} ${nextMarket} ${nextBook})`,
              { allowFailure: true }
            );
          });
        }

        runForOddsSource('historical', { yearTag: yearValue, yearValue });
      });
    } else {
      runForOddsSource(sourceKey || 'historical', { deferWeekly: sourceKey === 'live' });
    }

    args.market = priorMarket;
  });
    if (!skipMonthly && sourceKey === 'live') {
      const monthlyArgs = [
        '--season', String(season),
        '--market', 'all',
        '--oddsSource', String(sourceKey)
      ];
      const resolvedMonthlyEventId = resolvedEventId || eventId;
      if (resolvedMonthlyEventId) {
        monthlyArgs.push('--eventId', String(resolvedMonthlyEventId));
      }
      if (tournamentSlug) {
        monthlyArgs.push('--tournamentSlug', String(tournamentSlug));
      }
      if (stake !== undefined && stake !== null && stake !== '') {
        monthlyArgs.push('--stake', String(stake));
      }
      runNodeScript(path.resolve(__dirname, 'run_weekly_simulation.js'), monthlyArgs, `run_weekly_simulation (${sourceKey})`);
    }
  };

  if (normalizedOddsSource === 'both') {
    runMarketBatch('historical');
    runMarketBatch('live');
  } else {
    runMarketBatch(normalizedOddsSource || 'historical');
  }

  if (!skipDk) {
    const slates = (dkSlatesArg || dkSlate || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    if (!slates.length) {
      slates.push('main');
    }

    slates.forEach(slateName => {
      const dkArgs = [
        '--tour', String(tour),
        '--site', String(dkSite),
        '--slate', String(slateName),
        '--topN', String(dkTopN),
        '--salaryCap', String(dkSalaryCap),
        '--lineupSize', String(dkLineupSize)
      ];
      if (dkMinSalaryUsed) {
        dkArgs.push('--minSalaryUsed', String(dkMinSalaryUsed));
      }
      if (dkMinProjPoints) {
        dkArgs.push('--minProjPoints', String(dkMinProjPoints));
      }
      if (dkMaxOwnership) {
        dkArgs.push('--maxOwnership', String(dkMaxOwnership));
      }
      if (dkMaxExposure) {
        dkArgs.push('--maxExposure', String(dkMaxExposure));
      }
      if (dkOwnershipWeight) {
        dkArgs.push('--ownershipWeight', String(dkOwnershipWeight));
      }
      if (dkLock) {
        dkArgs.push('--lock', String(dkLock));
      }
      if (dkExclude) {
        dkArgs.push('--exclude', String(dkExclude));
      }
      if (dkInput) {
        dkArgs.push('--input', String(dkInput));
      }
      if (season) {
        dkArgs.push('--season', String(season));
      }
      if (tournamentSlug) {
        dkArgs.push('--tournamentSlug', String(tournamentSlug));
      }
      if (dkProbThreshold) {
        dkArgs.push('--probThreshold', String(dkProbThreshold));
        dkArgs.push('--modelMarket', String(dkModelMarket));
      }
      if (dkProbThresholdAlt) {
        dkArgs.push('--probThresholdAlt', String(dkProbThresholdAlt));
        if (dkModelMarketAlt) {
          dkArgs.push('--modelMarketAlt', String(dkModelMarketAlt));
        }
      }
      runNodeScript(path.resolve(__dirname, 'run_dk_lineup_optimizer.js'), dkArgs, `run_dk_lineup_optimizer (${slateName})`);
    });
  }

  console.log('✓ End-to-end wagering pipeline complete.');
};

main();
