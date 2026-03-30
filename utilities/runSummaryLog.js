const fs = require('fs');
const path = require('path');
const { buildArtifactPath, OUTPUT_ARTIFACTS } = require('./outputPaths');
const { formatTimestamp } = require('./timeUtils');

function writeCleanRunSummaryLog(options = {}) {
  const {
    summaryOutputBaseName,
    summaryTournamentSlug,
    isPostRun,
    outputDir,
    tournamentName,
    tournamentNameFallback,
    canonicalTournamentName,
    currentEventId,
    currentSeason,
    runContext,
    courseContextEntryFinal,
    sharedConfig,
    courseTemplateKey,
    shouldRunPreEventArtifacts,
    regressionSnapshot,
    rampSummary,
    rampPlayers,
    rampMaxEvents,
    validationData,
    validationOutputsDir,
    validationTemplateName,
    applyValidationOutputs,
    rankingsSnapshot,
    approachSkillSnapshot,
    playerDecompositionsSnapshot,
    skillRatingsValueSnapshot,
    skillRatingsRankSnapshot,
    datagolfApproachPeriod,
    approachDataCurrentSource,
    approachDataCurrentCount,
    approachSnapshotYtd,
    approachSnapshotL12,
    approachSnapshotL24,
    approachBlendWeights,
    approachBlendWeightsRaw,
    approachEventOnlyMeta,
    approachYtdUpdatedThisRun,
    fieldUpdatesSnapshot,
    fieldUpdatesUpdatedThisRun,
    fieldDataLength,
    weatherEnabled,
    weatherWaveSummary,
    lastFiveYears,
    effectiveSeason,
    tours,
    datagolfHistoricalEventId,
    datagolfCacheDir,
    step1cUsedRounds,
    historyData,
    allEventRounds,
    roundsByYear,
    hasCurrentResults,
    trainingMetricNotes,
    validationYears,
    approachDeltaPriorMode,
    approachDeltaPriorFiles,
    approachDeltaPriorMeta,
    approachDeltaRowsUsed,
    approachDeltaRowsTotal,
    approachDeltaPriorWeight,
    approachDeltaPriorLabel,
    optimizationObjectiveWeights,
    optimizationApproachCap,
    optimizationLoeoPenalty,
    optimizationLoeoTopN,
    validationRunSummary,
    resultsJsonPath,
    resultsTextPath,
    preEventRankingPath,
    preEventRankingCsvPath,
    signalReportPath,
    dryRunTemplatePath,
    dryRunDeltaScoresPath,
    resolveFileTimestamp,
    resolveCourseNumFromHistoryRow,
    formatSnapshotUsageLine,
    resolveSnapshotUpdatedAt,
    buildHistoricalCachePaths,
    courseContextPath,
    templateFilePath,
    humanSummaryLines
  } = options;

  if (!summaryOutputBaseName || !outputDir) return;

  const summaryArtifactType = isPostRun
    ? OUTPUT_ARTIFACTS.POST_EVENT_LOG_TXT
    : OUTPUT_ARTIFACTS.PRE_EVENT_LOG_TXT;
  const summaryLogPath = buildArtifactPath({
    artifactType: summaryArtifactType,
    outputBaseName: summaryOutputBaseName,
    tournamentSlug: summaryTournamentSlug || null,
    tournamentName: tournamentName || tournamentNameFallback,
    modeRoot: outputDir
  }) || path.resolve(
    outputDir,
    `${summaryOutputBaseName}_${isPostRun ? 'post_event' : 'pre_event'}_log.txt`
  );

  const summaryTimestamp = formatTimestamp(new Date());
  const historyYearsForLog = (() => {
    const base = Array.isArray(lastFiveYears) ? lastFiveYears : [];
    if (!isPostRun) {
      const filtered = base.filter(year => Number(year) < effectiveSeason);
      return filtered.length ? filtered : base;
    }
    return base;
  })();
  const historyYearRangeLabel = historyYearsForLog.length
    ? `${Math.min(...historyYearsForLog)}–${Math.max(...historyYearsForLog)}`
    : 'n/a';
  const historyCachePaths = buildHistoricalCachePaths({
    cacheDir: datagolfCacheDir,
    tours,
    years: historyYearsForLog,
    eventId: datagolfHistoricalEventId,
    fileFormat: 'json'
  });
  const historySourceRangeLabel = historyCachePaths.length
    ? `${historyCachePaths[0]} … ${historyYearsForLog[historyYearsForLog.length - 1]}`
    : 'history cache';
  const resolveYearFromRow = row => {
    const raw = row?.year ?? row?.season ?? row?.season_year ?? row?.seasonYear ?? null;
    const parsed = parseInt(String(raw || '').trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  };
  const eventCoursePairsForStep1c = (() => {
    const pairs = new Map();
    const addPair = (eventId, courseNum) => {
      const eventKey = String(eventId || '').trim();
      const courseKey = String(courseNum || '').trim();
      if (!eventKey || !courseKey) return;
      pairs.set(`${eventKey}|${courseKey}`, { eventId: eventKey, courseNum: courseKey });
    };
    const baseCourses = Array.isArray(courseContextEntryFinal?.courseNums)
      ? courseContextEntryFinal.courseNums
      : [courseContextEntryFinal?.courseNum || sharedConfig?.courseNum].filter(Boolean);
    baseCourses.forEach(courseNum => addPair(currentEventId, courseNum));
    const similarMap = courseContextEntryFinal?.similarCourseCourseNums || {};
    Object.entries(similarMap).forEach(([eventId, courseNums]) => {
      (courseNums || []).forEach(courseNum => addPair(eventId, courseNum));
    });
    const puttingMap = courseContextEntryFinal?.puttingCourseCourseNums || {};
    Object.entries(puttingMap).forEach(([eventId, courseNums]) => {
      (courseNums || []).forEach(courseNum => addPair(eventId, courseNum));
    });
    return Array.from(pairs.values());
  })();
  const step1cRoundsSource = Array.isArray(step1cUsedRounds) && step1cUsedRounds.length > 0
    ? step1cUsedRounds
    : historyData;
  const eventCourseYearSummary = eventCoursePairsForStep1c.map(pair => {
    const yearCounts = {};
    let total = 0;
    const yearPool = Array.from(new Set(
      (step1cRoundsSource || []).map(row => resolveYearFromRow(row)).filter(year => year !== null)
    ));
    const yearsToCount = yearPool.length > 0 ? yearPool : historyYearsForLog;
    yearsToCount.forEach(year => {
      const count = (step1cRoundsSource || []).reduce((acc, row) => {
        const rowEventId = String(row?.event_id || '').trim();
        if (rowEventId !== String(pair.eventId)) return acc;
        const rowCourseNum = resolveCourseNumFromHistoryRow(row);
        if (String(rowCourseNum || '').trim() !== String(pair.courseNum)) return acc;
        const rowYear = resolveYearFromRow(row);
        if (rowYear !== year) return acc;
        return acc + 1;
      }, 0);
      yearCounts[year] = count;
      total += count;
    });
    return { ...pair, yearCounts, total };
  });
  eventCourseYearSummary.sort((a, b) => {
    const eventDiff = Number(a.eventId) - Number(b.eventId);
    if (!Number.isNaN(eventDiff) && eventDiff !== 0) return eventDiff;
    const courseDiff = Number(a.courseNum) - Number(b.courseNum);
    if (!Number.isNaN(courseDiff) && courseDiff !== 0) return courseDiff;
    return String(a.courseNum).localeCompare(String(b.courseNum));
  });
  const regressionSnapshotPath = regressionSnapshot?.path || null;
  const regressionCompletedAt = regressionSnapshotPath ? resolveFileTimestamp(regressionSnapshotPath) : null;
  const rampSummaryPath = rampSummary?.path || null;
  const rampCompletedAt = rampSummaryPath ? resolveFileTimestamp(rampSummaryPath) : null;
  const selectedTemplateKey = courseContextEntryFinal?.templateKey || courseTemplateKey || String(currentEventId);
  const validationFiles = [];
  if (validationData?.weightTemplatesPath && fs.existsSync(validationData.weightTemplatesPath)) {
    validationFiles.push(validationData.weightTemplatesPath);
    const jsonPath = validationData.weightTemplatesPath.replace(/\.csv$/i, '.json');
    if (jsonPath && fs.existsSync(jsonPath)) validationFiles.push(jsonPath);
  } else if (validationOutputsDir) {
    const fallbackJson = path.resolve(validationOutputsDir, 'Weight_Templates.json');
    const fallbackCsv = path.resolve(validationOutputsDir, 'Weight_Templates.csv');
    if (fs.existsSync(fallbackJson)) validationFiles.push(fallbackJson);
    if (fs.existsSync(fallbackCsv)) validationFiles.push(fallbackCsv);
  }

  const summaryLines = [];
  summaryLines.push(`Logging to ${summaryLogPath}`);
  summaryLines.push('');
  summaryLines.push(`=== ${isPostRun ? 'POST-EVENT' : 'PRE-EVENT'} RUN SUMMARY ===`);
  summaryLines.push(`Event: ${currentEventId} (${canonicalTournamentName || tournamentName || 'Event'})`);
  summaryLines.push(`CourseNum: ${sharedConfig?.courseNum || 'n/a'}`);
  summaryLines.push(`CourseNameKey: ${sharedConfig?.courseNameKey || courseContextEntryFinal?.courseNameKey || 'n/a'}`);
  summaryLines.push(`Season: ${currentSeason}`);
  summaryLines.push(`Run Mode: ${runContext}`);
  summaryLines.push(`Timestamp: ${summaryTimestamp}`);
  summaryLines.push('');
  summaryLines.push('🔄 Course context / configuration');
  summaryLines.push('- Config source: course_context.json');
  summaryLines.push(`- Config file: ${courseContextPath}`);
  summaryLines.push(`- Applied overrides: eventId=${currentEventId}, courseNum=${sharedConfig?.courseNum || 'n/a'}`);
  summaryLines.push(`- Course type: ${courseContextEntryFinal?.courseType || sharedConfig?.courseType || 'n/a'}`);
  summaryLines.push(`- Template key: ${courseContextEntryFinal?.templateKey || courseTemplateKey || 'n/a'}`);
  summaryLines.push('');
  summaryLines.push('🔄 Course history regression');
  summaryLines.push(`- Inputs ${shouldRunPreEventArtifacts ? 'generated' : 'skipped'}`);
  if (regressionSnapshotPath) {
    summaryLines.push(`- Regression snapshot: ${regressionSnapshotPath}`);
    if (regressionCompletedAt) summaryLines.push(`- Completed date: ${regressionCompletedAt}`);
  }
  summaryLines.push('');
  summaryLines.push('🔄 Player ramp summary');
  if (rampSummaryPath) {
    summaryLines.push(`- File: ${rampSummaryPath}`);
    if (rampCompletedAt) summaryLines.push(`- Completed date: ${rampCompletedAt}`);
  }
  if (Array.isArray(rampPlayers) && rampPlayers.length > 0) {
    summaryLines.push(`- Loaded: ${rampPlayers.length} players (maxEvents=${rampMaxEvents})`);
  }
  summaryLines.push('');
  summaryLines.push('🔄 Templates');
  summaryLines.push('');
  summaryLines.push(`- Selected template: ${selectedTemplateKey} (eventId=${currentEventId})`);
  summaryLines.push(`\tFile: ${templateFilePath}`);
  if (validationTemplateName) {
    const validationMode = applyValidationOutputs ? 'applied' : 'reporting only';
    summaryLines.push(`- Validation template loaded: ${validationTemplateName} (${validationMode})`);
    if (validationFiles.length > 0) {
      summaryLines.push(`\tFiles:`);
      validationFiles.forEach(filePath => summaryLines.push(`\t- ${filePath}`));
    }
  }
  summaryLines.push('');
  summaryLines.push('🔄 Data sources (used this run)');
  summaryLines.push('');
  summaryLines.push('DataGolf');
  const dataGolfLines = [];
  const dataGolfUpdatedLines = [];
  if (rankingsSnapshot?.payload && rankingsSnapshot?.source === 'api' && rankingsSnapshot?.path) {
    dataGolfUpdatedLines.push('- Rankings: updated (not used)');
  }
  if (fieldUpdatesSnapshot?.payload) {
    const fieldLine = formatSnapshotUsageLine('Field updates', fieldUpdatesSnapshot);
    dataGolfLines.push(fieldUpdatesUpdatedThisRun ? `${fieldLine} (updated this run)` : fieldLine);
  }
  if (approachSkillSnapshot?.payload) {
    const label = `Approach skill (${datagolfApproachPeriod === 'l24' ? 'last 24 months' : datagolfApproachPeriod || 'unknown'})`;
    if (approachDataCurrentSource === 'api_fallback') {
      dataGolfLines.push(formatSnapshotUsageLine(label, approachSkillSnapshot));
    } else {
      dataGolfUpdatedLines.push(`- ${label}: updated (not used)`);
    }
  }
  if (playerDecompositionsSnapshot?.payload) {
    const line = formatSnapshotUsageLine('Player decompositions', playerDecompositionsSnapshot);
    if (isPostRun) dataGolfLines.push(line);
    else dataGolfUpdatedLines.push('- Player decompositions: updated (not used)');
  }
  if (skillRatingsValueSnapshot?.payload) {
    const line = formatSnapshotUsageLine('Skill ratings (value)', skillRatingsValueSnapshot);
    if (isPostRun) dataGolfLines.push(line);
    else dataGolfUpdatedLines.push('- Skill ratings (value): updated (not used)');
  }
  if (skillRatingsRankSnapshot?.payload) {
    const line = formatSnapshotUsageLine('Skill ratings (rank)', skillRatingsRankSnapshot);
    if (isPostRun) dataGolfLines.push(line);
    else dataGolfUpdatedLines.push('- Skill ratings (rank): updated (not used)');
  }
  if (dataGolfLines.length === 0) {
    summaryLines.push('- None');
  } else {
    dataGolfLines.filter(Boolean).forEach(line => summaryLines.push(line));
  }
  if (dataGolfUpdatedLines.length > 0) {
    summaryLines.push('');
    summaryLines.push('DataGolf (updated, not used)');
    dataGolfUpdatedLines.forEach(line => summaryLines.push(line));
  }
  if (approachDataCurrentSource === 'snapshot_ytd' && approachSnapshotYtd?.path) {
    summaryLines.push('');
    summaryLines.push('Approach snapshots');
    const eventAligned = approachSnapshotYtd?.source === 'snapshot_archive' ? ' (event-aligned)' : '';
    const snapshotUpdatedAt = resolveSnapshotUpdatedAt(approachSnapshotYtd);
    const updatedSuffix = snapshotUpdatedAt ? ` (last updated ${snapshotUpdatedAt})` : '';
    const runUpdatedSuffix = approachYtdUpdatedThisRun ? ' (updated this run)' : '';
    summaryLines.push(`- YTD snapshot used: ${approachSnapshotYtd.path}${eventAligned}${updatedSuffix}${runUpdatedSuffix}`);
  }
  if (approachDataCurrentSource === 'snapshot_blend' || approachBlendWeights) {
    summaryLines.push('');
    summaryLines.push('Approach snapshots (blend)');
    if (approachSnapshotYtd?.path) summaryLines.push(`- YTD: ${approachSnapshotYtd.path}`);
    if (approachSnapshotL12?.path) summaryLines.push(`- L12: ${approachSnapshotL12.path}`);
    if (approachSnapshotL24?.path) summaryLines.push(`- L24: ${approachSnapshotL24.path}`);
    if (approachBlendWeights) {
      summaryLines.push(`- Blend weights: ytd=${(approachBlendWeights.ytd * 100).toFixed(0)}%, l12=${(approachBlendWeights.l12 * 100).toFixed(0)}%, l24=${(approachBlendWeights.l24 * 100).toFixed(0)}%`);
    } else if (approachBlendWeightsRaw) {
      summaryLines.push(`- Blend weights (raw): ${approachBlendWeightsRaw}`);
    }
  } else if (approachSnapshotL12?.path || approachSnapshotL24?.path) {
    summaryLines.push('');
    summaryLines.push('Approach snapshots');
    if (approachSnapshotYtd?.path) summaryLines.push(`- YTD: ${approachSnapshotYtd.path}`);
    if (approachSnapshotL12?.path) summaryLines.push(`- L12: ${approachSnapshotL12.path}`);
    if (approachSnapshotL24?.path) summaryLines.push(`- L24: ${approachSnapshotL24.path}`);
  }
  summaryLines.push('');
  summaryLines.push('Field');
  if (fieldUpdatesSnapshot?.path && fs.existsSync(fieldUpdatesSnapshot.path)) {
    const fieldUpdatedAt = resolveSnapshotUpdatedAt(fieldUpdatesSnapshot);
    const fieldUpdatedSuffix = fieldUpdatedAt ? ` (last updated ${fieldUpdatedAt})` : '';
    const fieldLabel = fieldUpdatesSnapshot.source === 'csv_field' ? 'CSV' : 'cache';
    summaryLines.push(`- Field updates ${fieldLabel}: ${fieldUpdatesSnapshot.path}${fieldUpdatedSuffix}`);
  }
  summaryLines.push(`- Field loaded: ${fieldDataLength} players`);
  summaryLines.push('');
  summaryLines.push('Weather (Meteoblue)');
  if (weatherWaveSummary?.enabled) {
    const penalties = weatherWaveSummary.combinedPenalties || weatherWaveSummary.penalties || {};
    const r1Am = penalties.R1_AM?.total ?? penalties.R1_AM ?? 0;
    const r1Pm = penalties.R1_PM?.total ?? penalties.R1_PM ?? 0;
    const r2Am = penalties.R2_AM?.total ?? penalties.R2_AM ?? 0;
    const r2Pm = penalties.R2_PM?.total ?? penalties.R2_PM ?? 0;
    const basePenalties = weatherWaveSummary.basePenalties || null;
    const weatherAdjustments = weatherWaveSummary.weatherAdjustments?.adjustments || weatherWaveSummary.weatherAdjustments || null;
    const computeWaveAverages = rankingPath => {
      if (!rankingPath || !fs.existsSync(rankingPath)) return null;
      let payload = null;
      try {
        payload = JSON.parse(fs.readFileSync(rankingPath, 'utf8'));
      } catch {
        return null;
      }
      const players = Array.isArray(payload?.players) ? payload.players : [];
      if (players.length === 0) return null;
      const stats = {
        R1_AM: { sum: 0, count: 0 },
        R1_PM: { sum: 0, count: 0 },
        R2_AM: { sum: 0, count: 0 },
        R2_PM: { sum: 0, count: 0 }
      };
      players.forEach(player => {
        if (!player || typeof player !== 'object') return;
        const r1Penalty = typeof player.weatherWavePenaltyR1 === 'number' && Number.isFinite(player.weatherWavePenaltyR1)
          ? player.weatherWavePenaltyR1
          : null;
        const r2Penalty = typeof player.weatherWavePenaltyR2 === 'number' && Number.isFinite(player.weatherWavePenaltyR2)
          ? player.weatherWavePenaltyR2
          : null;
        const wave1 = String(player.waveRound1 || '').trim().toLowerCase();
        const wave2 = String(player.waveRound2 || '').trim().toLowerCase();
        if (r1Penalty !== null) {
          if (wave1 === 'early' || wave1 === 'am' || wave1 === 'morning') {
            stats.R1_AM.sum += r1Penalty;
            stats.R1_AM.count += 1;
          } else if (wave1 === 'late' || wave1 === 'pm' || wave1 === 'afternoon') {
            stats.R1_PM.sum += r1Penalty;
            stats.R1_PM.count += 1;
          }
        }
        if (r2Penalty !== null) {
          if (wave2 === 'early' || wave2 === 'am' || wave2 === 'morning') {
            stats.R2_AM.sum += r2Penalty;
            stats.R2_AM.count += 1;
          } else if (wave2 === 'late' || wave2 === 'pm' || wave2 === 'afternoon') {
            stats.R2_PM.sum += r2Penalty;
            stats.R2_PM.count += 1;
          }
        }
      });
      const avg = key => (stats[key].count > 0 ? (stats[key].sum / stats[key].count) : null);
      return {
        R1_AM: avg('R1_AM'),
        R1_PM: avg('R1_PM'),
        R2_AM: avg('R2_AM'),
        R2_PM: avg('R2_PM'),
        counts: {
          R1_AM: stats.R1_AM.count,
          R1_PM: stats.R1_PM.count,
          R2_AM: stats.R2_AM.count,
          R2_PM: stats.R2_PM.count
        }
      };
    };
    const waveAverages = computeWaveAverages(preEventRankingPath);
    const r1AmAvg = Number.isFinite(waveAverages?.R1_AM) ? waveAverages.R1_AM : r1Am;
    const r1PmAvg = Number.isFinite(waveAverages?.R1_PM) ? waveAverages.R1_PM : r1Pm;
    const r2AmAvg = Number.isFinite(waveAverages?.R2_AM) ? waveAverages.R2_AM : r2Am;
    const r2PmAvg = Number.isFinite(waveAverages?.R2_PM) ? waveAverages.R2_PM : r2Pm;
    summaryLines.push(`- Forecast used: yes (source=${weatherWaveSummary.source || 'unknown'})`);
    summaryLines.push(`- Location: ${weatherWaveSummary.locationQuery || 'n/a'} (lat=${Number.isFinite(weatherWaveSummary.lat) ? weatherWaveSummary.lat : 'n/a'}, lon=${Number.isFinite(weatherWaveSummary.lon) ? weatherWaveSummary.lon : 'n/a'})`);
    if (weatherWaveSummary.cachePath && fs.existsSync(weatherWaveSummary.cachePath)) {
      summaryLines.push(`- Penalty cache: ${weatherWaveSummary.cachePath}`);
    }
    summaryLines.push(`- Wave adjustments (negative=boost, positive=penalty): R1_AM=${r1AmAvg}, R1_PM=${r1PmAvg}, R2_AM=${r2AmAvg}, R2_PM=${r2PmAvg}`);
    const baseAdv = basePenalties
      ? (basePenalties.R1_PM || 0) + (basePenalties.R2_AM || 0)
        - ((basePenalties.R1_AM || 0) + (basePenalties.R2_PM || 0))
      : null;
    if (baseAdv !== null) {
      summaryLines.push(`- Baseline advantage (Late/Early vs Early/Late): ${baseAdv.toFixed(2)}`);
    }
    const totalAdv = (r1PmAvg + r2AmAvg) - (r1AmAvg + r2PmAvg);
    if (baseAdv !== null) {
      const weatherAdv = totalAdv - baseAdv;
      summaryLines.push(`- Weather-only advantage (Late/Early vs Early/Late): ${weatherAdv.toFixed(2)}`);
    } else if (weatherAdjustments) {
      const weatherAdv = (weatherAdjustments.R1_PM || 0) + (weatherAdjustments.R2_AM || 0)
        - ((weatherAdjustments.R1_AM || 0) + (weatherAdjustments.R2_PM || 0));
      summaryLines.push(`- Weather-only advantage (Late/Early vs Early/Late): ${weatherAdv.toFixed(2)}`);
    }
    summaryLines.push(`- Total implied advantage (Late/Early vs Early/Late): ${totalAdv.toFixed(2)}`);
  } else if (weatherEnabled) {
    summaryLines.push(`- Forecast used: no (${weatherWaveSummary?.reason || 'unavailable'})`);
  } else {
    summaryLines.push('- Forecast used: no (weather disabled)');
  }
  summaryLines.push('');
  summaryLines.push('Historical Rounds');
  summaryLines.push(`- Years used: ${historyYearRangeLabel} (eventId=${currentEventId}, courseNum=${sharedConfig?.courseNum || 'n/a'})`);
  if (historyCachePaths.length > 0) {
    summaryLines.push('- Cache files:');
    historyCachePaths.forEach(filePath => summaryLines.push(`\t- ${filePath}`));
  }
  summaryLines.push('');
  summaryLines.push('--- STEP 1a: HISTORICAL METRIC CORRELATIONS ---');
  summaryLines.push(`- Event: ${currentEventId} | CourseNum: ${sharedConfig?.courseNum || 'n/a'}`);
  summaryLines.push(`- Years evaluated: ${historyYearRangeLabel}`);
  summaryLines.push(`- Rounds used (all players): ${allEventRounds.length}`);
  if (historyCachePaths.length > 0) {
    summaryLines.push('- Source files (rounds by year):');
    historyYearsForLog.forEach(year => {
      const filePath = historyCachePaths.find(candidate => candidate.includes(`_${year}_`)) || 'n/a';
      const roundsAll = allEventRounds.filter(row => resolveYearFromRow(row) === year).length;
      summaryLines.push(`\t- ${year}: ${filePath} (all players=${roundsAll})`);
    });
  }
  summaryLines.push('');
  summaryLines.push('--- STEP 1b: CURRENT-SEASON EVENT-ONLY CORRELATIONS ---');
  summaryLines.push(`- Event: ${currentEventId} | CourseNum: ${sharedConfig?.courseNum || 'n/a'}`);
  const step1bRounds = (!hasCurrentResults)
    ? 0
    : (roundsByYear?.[effectiveSeason]?.length || 0);
  const step1bNote = (!hasCurrentResults)
    ? ' (pre-event; current-season results ignored)'
    : '';
  summaryLines.push(`- Rounds used: ${step1bRounds}${step1bNote}`);
  if (approachEventOnlyMeta?.pre?.path || approachEventOnlyMeta?.post?.path) {
    const preLabel = approachEventOnlyMeta?.pre?.path ? approachEventOnlyMeta.pre.path : 'n/a';
    const postLabel = approachEventOnlyMeta?.post?.path ? approachEventOnlyMeta.post.path : 'n/a';
    const overlapPct = typeof approachEventOnlyMeta?.fieldOverlapPct === 'number'
      ? `${(approachEventOnlyMeta.fieldOverlapPct * 100).toFixed(1)}%`
      : 'n/a';
    summaryLines.push(`- Event-only approach snapshots: pre=${preLabel}, post=${postLabel}`);
    if (typeof approachEventOnlyMeta?.rows === 'number') {
      summaryLines.push(`- Event-only approach rows: ${approachEventOnlyMeta.rows} (field overlap ${overlapPct})`);
    }
  } else if (approachSnapshotYtd?.path) {
    summaryLines.push(`- Approach snapshot (fallback): ${approachSnapshotYtd.path}`);
  }
  if (!hasCurrentResults && !isPostRun) {
    summaryLines.push('- Status: skipped (no current-season results)');
  }
  summaryLines.push('');
  summaryLines.push('--- STEP 1c: EVENT + SIMILAR + PUTTING CORRELATIONS ---');
  summaryLines.push(`- Event: ${currentEventId} | CourseNum: ${sharedConfig?.courseNum || 'n/a'}`);
  const step1cYearList = Array.from(new Set(
    (step1cRoundsSource || []).map(row => resolveYearFromRow(row)).filter(year => year !== null)
  )).sort((a, b) => a - b);
  const step1cYearsForLog = step1cYearList.length > 0 ? step1cYearList : historyYearsForLog;
  summaryLines.push(`- Years used: ${step1cYearsForLog.join(', ') || historyYearRangeLabel}`);
  summaryLines.push('- Events included (event + similar + putting) with rounds by year (actual rows used):');
  if (eventCourseYearSummary.length === 0) {
    summaryLines.push('\t- none');
  } else {
    eventCourseYearSummary.forEach(entry => {
      const yearParts = step1cYearsForLog.map(year => `${year}: ${entry.yearCounts?.[year] ?? 0}`).join(', ');
      summaryLines.push(`\t- Event ${entry.eventId} / Course ${entry.courseNum} | ${yearParts} | Total: ${entry.total} | Source: ${historySourceRangeLabel}`);
    });
  }
  if (historyCachePaths.length > 0) {
    summaryLines.push('- History source files:');
    historyCachePaths.forEach(filePath => summaryLines.push(`\t- ${filePath}`));
  }
  if (approachDataCurrentSource) {
    const rowsLabel = typeof approachDataCurrentCount === 'number' ? ` (${approachDataCurrentCount} rows)` : '';
    summaryLines.push(`- Approach source: ${approachDataCurrentSource}${rowsLabel}`);
  }
  summaryLines.push('- Rounds used: multi-season event+similar+putting (see events/courseNums above)');
  if (trainingMetricNotes?.included?.length) {
    summaryLines.push(`- Metrics included: ${trainingMetricNotes.included.length} (${trainingMetricNotes.included.join(', ')})`);
  }
  if (trainingMetricNotes?.excluded?.length) {
    summaryLines.push(`- Metrics excluded: ${trainingMetricNotes.excluded.join(', ')}`);
  }
  summaryLines.push('');
  summaryLines.push('--- STEP 1d: CURRENT-SEASON TEMPLATE BASELINE ---');
  summaryLines.push(`- Years evaluated: ${validationYears.join(', ') || 'none'}`);
  summaryLines.push('- Rounds by year (actual rows used):');
  (validationYears || []).forEach(year => {
    const rounds = roundsByYear?.[year] || [];
    summaryLines.push(`\t- ${year}: ${rounds.length} rounds`);
  });
  if (!hasCurrentResults && !isPostRun) {
    summaryLines.push('- Status: skipped (no current-season results to evaluate templates)');
  }
  summaryLines.push(`- Approach usage: current season (${effectiveSeason}) only`);
  if (approachDataCurrentSource) {
    const rowsLabel = typeof approachDataCurrentCount === 'number' ? ` (${approachDataCurrentCount} rows)` : '';
    summaryLines.push(`- Approach source: ${approachDataCurrentSource}${rowsLabel}`);
  }
  summaryLines.push('');
  summaryLines.push('--- STEP 2/3: OPTIMIZATION SETTINGS ---');
  if (optimizationObjectiveWeights) {
    summaryLines.push(`- Objective weights: corr=${optimizationObjectiveWeights.correlation?.toFixed(2) ?? 'n/a'}, top20=${optimizationObjectiveWeights.top20?.toFixed(2) ?? 'n/a'}, align=${optimizationObjectiveWeights.alignment?.toFixed(2) ?? 'n/a'}`);
  }
  if (typeof optimizationApproachCap === 'number') {
    summaryLines.push(`- Approach group cap: ${optimizationApproachCap.toFixed(2)}`);
  }
  if (typeof optimizationLoeoPenalty === 'number' && optimizationLoeoPenalty > 0) {
    summaryLines.push(`- LOEO penalty: ${optimizationLoeoPenalty.toFixed(2)} (topN=${optimizationLoeoTopN || 0})`);
  }
  if (approachDeltaPriorMode || (approachDeltaPriorFiles && approachDeltaPriorFiles.length > 0)) {
    summaryLines.push('');
    summaryLines.push('--- APPROACH DELTA PRIOR ---');
    if (approachDeltaPriorLabel) {
      summaryLines.push(`- Label: ${approachDeltaPriorLabel}`);
    }
    if (typeof approachDeltaPriorWeight === 'number') {
      summaryLines.push(`- Weight: ${approachDeltaPriorWeight.toFixed(2)}`);
    }
    summaryLines.push(`- Mode: ${approachDeltaPriorMode || 'n/a'}`);
    if (typeof approachDeltaRowsUsed === 'number' || typeof approachDeltaRowsTotal === 'number') {
      summaryLines.push(`- Rows used: ${approachDeltaRowsUsed || 0}/${approachDeltaRowsTotal || 0}`);
    }
    if (approachDeltaPriorFiles && approachDeltaPriorFiles.length > 0) {
      summaryLines.push('- Files:');
      approachDeltaPriorFiles.forEach(filePath => summaryLines.push(`	- ${filePath}`));
    }
    if (approachDeltaPriorMeta?.previousPath || approachDeltaPriorMeta?.currentPath) {
      summaryLines.push(`- Previous snapshot: ${approachDeltaPriorMeta.previousPath || 'n/a'}`);
      summaryLines.push(`- Current snapshot: ${approachDeltaPriorMeta.currentPath || 'n/a'}`);
    }
  }
  if (validationRunSummary) {
    summaryLines.push('');
    summaryLines.push('--- VALIDATION PIPELINE INPUTS ---');
    if (validationRunSummary.outputDir) summaryLines.push(`- Output dir: ${validationRunSummary.outputDir}`);
    if (validationRunSummary.inputsDir) summaryLines.push(`- Inputs dir: ${validationRunSummary.inputsDir}`);
    if (validationRunSummary.rankingsJsonPath) summaryLines.push(`- Rankings JSON: ${validationRunSummary.rankingsJsonPath}`);
    if (validationRunSummary.rankingsCsvPath) summaryLines.push(`- Rankings CSV: ${validationRunSummary.rankingsCsvPath}`);
    if (validationRunSummary.resultsJsonPath) summaryLines.push(`- Results JSON: ${validationRunSummary.resultsJsonPath}`);
    if (validationRunSummary.resultsCsvPath) summaryLines.push(`- Results CSV: ${validationRunSummary.resultsCsvPath}`);
    if (validationRunSummary.historyCsvPath) summaryLines.push(`- Historical CSV: ${validationRunSummary.historyCsvPath}`);
    if (validationRunSummary.configCsvPath) summaryLines.push(`- Config CSV: ${validationRunSummary.configCsvPath}`);
    if (validationRunSummary.courseContextPath) summaryLines.push(`- Course context: ${validationRunSummary.courseContextPath}`);
    if (validationRunSummary.top20BlendPath) summaryLines.push(`- Top-20 blend: ${validationRunSummary.top20BlendPath}`);
    if (validationRunSummary.approachEventOnly) {
      const eventOnly = validationRunSummary.approachEventOnly;
      summaryLines.push(`- Event-only approach: ${eventOnly.source || 'n/a'}`);
      if (eventOnly.prePath || eventOnly.postPath) {
        summaryLines.push(`  pre=${eventOnly.prePath || 'n/a'}, post=${eventOnly.postPath || 'n/a'}`);
      }
      if (typeof eventOnly.rows === 'number') {
        summaryLines.push(`  rows=${eventOnly.rows}${typeof eventOnly.playersWithShots === 'number' ? `, players=${eventOnly.playersWithShots}` : ''}`);
      }
    }
  }
  summaryLines.push('');
  summaryLines.push('✅ Outputs');
  if (resultsJsonPath) summaryLines.push(`- Results JSON: ${resultsJsonPath}`);
  if (resultsTextPath) summaryLines.push(`- Results TXT: ${resultsTextPath}`);
  if (preEventRankingPath) summaryLines.push(`- Pre-event rankings JSON: ${preEventRankingPath}`);
  if (preEventRankingCsvPath) summaryLines.push(`- Pre-event rankings CSV: ${preEventRankingCsvPath}`);
  if (signalReportPath) summaryLines.push(`- Signal contribution report: ${signalReportPath}`);
  if (dryRunTemplatePath) summaryLines.push(`- Dryrun templates: ${dryRunTemplatePath}`);
  if (dryRunDeltaScoresPath) summaryLines.push(`- Dryrun delta scores: ${dryRunDeltaScoresPath}`);
  summaryLines.push(`- Completed: ${summaryTimestamp}`);

  if (Array.isArray(humanSummaryLines) && humanSummaryLines.length > 0) {
    summaryLines.push('');
    humanSummaryLines.forEach(line => summaryLines.push(line));
  }

  try {
    fs.writeFileSync(summaryLogPath, summaryLines.join('\n'));
  } catch (error) {
    const summaryLabel = isPostRun ? 'post-event' : 'pre-event';
    console.warn(`⚠️  Unable to write ${summaryLabel} summary log: ${error.message}`);
  }
}

module.exports = { writeCleanRunSummaryLog };
