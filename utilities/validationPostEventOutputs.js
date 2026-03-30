/**
 * Module: validationPostEventOutputs
 * Purpose: Formatting + write helpers for post-event validation summaries.
 */

const fs = require('fs');
const { ensureDirectory } = require('./fileUtils');
const { OutputArtifactManager } = require('./outputArtifactManager');
const { OUTPUT_ARTIFACTS } = require('./outputPaths');

const writeSeasonPostEventSummary = ({ outputDir, summary, validationSubdirs }) => {
  if (!outputDir || !summary) return null;
  const outputArtifacts = new OutputArtifactManager({
    outputBaseName: 'season',
    validationRoot: outputDir,
    validationSubdirs
  });
  const jsonPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_SEASON_POST_EVENT_SUMMARY_JSON
  });
  const csvPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_SEASON_POST_EVENT_SUMMARY_CSV
  });
  const mdPath = outputArtifacts.buildPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_SEASON_POST_EVENT_SUMMARY_MD
  });

  const targetDir = validationSubdirs?.seasonSummaries || outputDir;
  ensureDirectory(targetDir);

  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  }

  if (csvPath) {
    const headers = [
      'Tournament',
      'Slug',
      'Event ID',
      'Run Count',
      'Seed Runs',
      'Best Seed',
      'Step3 Correlation',
      'Step3 RMSE',
      'Step3 MAE',
      'Step3 Top10',
      'Step3 Top20',
      'Step3 Top20 Weighted',
      'KFold Correlation',
      'Top20 Logistic Acc',
      'Top20 CV Acc'
    ];
    const lines = [headers.join(',')];
    summary.tournaments.forEach(entry => {
      const best = entry.bestRun || {};
      const line = [
        best.tournament || entry.tournament || '',
        entry.tournamentSlug || '',
        entry.eventId || '',
        entry.runCount || 0,
        entry.seedRunCount || 0,
        best.optSeed || '',
        best.step3?.correlation,
        best.step3?.rmse,
        best.step3?.mae,
        best.step3?.top10,
        best.step3?.top20,
        best.step3?.top20WeightedScore,
        best.kFold?.correlation,
        best.top20Logistic?.accuracy,
        best.top20Cv?.avgAccuracy
      ]
        .map(value => (value === null || value === undefined ? '' : JSON.stringify(value)))
        .join(',');
      lines.push(line);
    });
    fs.writeFileSync(csvPath, lines.join('\n'));
  }

  if (mdPath) {
    const topByScore = summary.tournaments
      .slice()
      .sort((a, b) => (b.bestRun?.step3?.top20WeightedScore || 0) - (a.bestRun?.step3?.top20WeightedScore || 0))
      .slice(0, 10);
    const redFlags = summary.tournaments.filter(entry => {
      const best = entry.bestRun || {};
      return (best.step3?.correlation !== null && best.step3?.correlation < 0.2)
        || (best.step3?.top20WeightedScore !== null && best.step3?.top20WeightedScore < 40)
        || (best.kFold?.correlation !== null && best.kFold?.correlation < 0.2)
        || (best.top20Cv?.avgAccuracy !== null && best.top20Cv?.avgAccuracy < 0.85);
    });

    const lines = [];
    lines.push(`# Season Post-Event Summary (${summary.season})`);
    lines.push('');
    lines.push(`- Tournaments: ${summary.tournamentCount}`);
    lines.push(`- Runs: ${summary.runCount} (${summary.seedRunCount} seed runs)`);
    lines.push('');

    lines.push('## Top 10 by Top20 Weighted Score');
    lines.push('');
    lines.push('| Tournament | Seed | Top20 Weighted | Correlation | Top20 |');
    lines.push('|---|---|---:|---:|---:|');
    topByScore.forEach(entry => {
      const best = entry.bestRun || {};
      lines.push(`| ${best.tournament || entry.tournament || ''} | ${best.optSeed || ''} | ${best.step3?.top20WeightedScore?.toFixed(2) || ''} | ${best.step3?.correlation?.toFixed(3) || ''} | ${best.step3?.top20 ?? ''} |`);
    });

    lines.push('');
    lines.push('## Red Flags');
    lines.push('');
    if (redFlags.length === 0) {
      lines.push('No red flags detected based on current thresholds.');
    } else {
      redFlags.forEach(entry => {
        const best = entry.bestRun || {};
        lines.push(`- ${best.tournament || entry.tournament || ''} (corr=${best.step3?.correlation ?? 'n/a'}, top20Weighted=${best.step3?.top20WeightedScore ?? 'n/a'}, kfold=${best.kFold?.correlation ?? 'n/a'}, cvAcc=${best.top20Cv?.avgAccuracy ?? 'n/a'})`);
      });
    }

    fs.writeFileSync(mdPath, lines.join('\n'));
  }

  return { jsonPath, csvPath, mdPath };
};

module.exports = {
  writeSeasonPostEventSummary
};
