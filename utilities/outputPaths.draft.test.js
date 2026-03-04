const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  OUTPUT_ARTIFACTS,
  resolveTournamentRoot,
  resolveModeRoot,
  resolveSeedRunRoot,
  resolveDryRunRoot,
  resolveAnalysisRoot,
  resolveRegressionRoot,
  resolveValidationRoot,
  resolveValidationSubdir,
  buildOutputBaseName,
  buildArtifactPath,
  getLegacyReadCandidates,
  slugifyTournament
} = require('./outputPaths');

test('slugify and base-name behavior stays deterministic', () => {
  assert.equal(slugifyTournament('American Express'), 'american-express');
  assert.equal(
    buildOutputBaseName({ tournamentName: 'American Express', seed: 'B', outputTag: 'KFOLD5' }),
    'american_express_seed-b_kfold5'
  );
  assert.equal(
    buildOutputBaseName({ tournamentSlug: 'genesis-invitational', eventId: 7 }),
    'genesis-invitational'
  );
});

test('pre/post/seed/dryrun roots resolve correctly', () => {
  const workspaceRoot = '/workspaces/modelOptimizer';
  const tournamentRoot = resolveTournamentRoot({
    workspaceRoot,
    season: 2026,
    tournamentName: 'American Express'
  });

  assert.equal(
    tournamentRoot,
    '/workspaces/modelOptimizer/data/2026/american-express'
  );

  const postRoot = resolveModeRoot({ tournamentRoot, mode: 'post' });
  const seedRoot = resolveSeedRunRoot({ modeRoot: postRoot, mode: 'post_event', isSeeded: true });
  const dryRunRoot = resolveDryRunRoot({ modeRoot: postRoot });

  assert.equal(postRoot, '/workspaces/modelOptimizer/data/2026/american-express/post_event');
  assert.equal(seedRoot, '/workspaces/modelOptimizer/data/2026/american-express/post_event/seed_runs');
  assert.equal(dryRunRoot, '/workspaces/modelOptimizer/data/2026/american-express/post_event/dryrun');
});

test('validation, analysis, and regression roots follow agreed scope', () => {
  const workspaceRoot = '/workspaces/modelOptimizer';
  const tournamentRoot = '/workspaces/modelOptimizer/data/2026/american-express';

  const validationRoot = resolveValidationRoot({ workspaceRoot, season: 2026 });
  const metricAnalysisDir = resolveValidationSubdir({ validationRoot, kind: 'METRIC_ANALYSIS' });
  const templateCorrelationDir = resolveValidationSubdir({ validationRoot, kind: 'TEMPLATE_CORRELATION_SUMMARIES' });
  const analysisRoot = resolveAnalysisRoot({ tournamentRoot, mode: 'pre_event' });
  const regressionRoot = resolveRegressionRoot({ workspaceRoot });

  assert.equal(validationRoot, '/workspaces/modelOptimizer/data/2026/validation_outputs');
  assert.equal(metricAnalysisDir, '/workspaces/modelOptimizer/data/2026/validation_outputs/metric_analysis');
  assert.equal(templateCorrelationDir, '/workspaces/modelOptimizer/data/2026/validation_outputs/template_correlation_summaries');
  assert.equal(analysisRoot, '/workspaces/modelOptimizer/data/2026/american-express/pre_event/analysis');
  assert.equal(regressionRoot, '/workspaces/modelOptimizer/data/course_history_regression');
});

test('artifact paths distinguish optimizer post-event vs normalized tournament snapshots', () => {
  const modeRoot = '/workspaces/modelOptimizer/data/2026/american-express/post_event';
  const validationRoot = '/workspaces/modelOptimizer/data/2026/validation_outputs';
  const outputBaseName = 'american_express_seed-b';

  const optimizerPostJson = buildArtifactPath({
    artifactType: OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_JSON,
    outputBaseName,
    tournamentName: 'American Express',
    modeRoot,
    validationRoot
  });

  const tournamentResultsJson = buildArtifactPath({
    artifactType: OUTPUT_ARTIFACTS.TOURNAMENT_RESULTS_JSON,
    outputBaseName,
    tournamentName: 'American Express',
    modeRoot,
    validationRoot
  });

  const metricAnalysisJson = buildArtifactPath({
    artifactType: OUTPUT_ARTIFACTS.VALIDATION_METRIC_ANALYSIS_JSON,
    outputBaseName,
    tournamentName: 'American Express',
    modeRoot,
    validationRoot,
    validationSubdirs: {
      metricAnalysis: path.resolve(validationRoot, 'metric_analysis')
    }
  });

  assert.equal(
    optimizerPostJson,
    '/workspaces/modelOptimizer/data/2026/american-express/post_event/american_express_seed-b_post_event_results.json'
  );
  assert.equal(
    tournamentResultsJson,
    '/workspaces/modelOptimizer/data/2026/american-express/post_event/american-express_results.json'
  );
  assert.equal(
    metricAnalysisJson,
    '/workspaces/modelOptimizer/data/2026/validation_outputs/metric_analysis/american-express_metric_analysis.json'
  );
});

test('legacy read candidates include post_tournament + output fallback only for reads', () => {
  const candidates = getLegacyReadCandidates({
    artifactType: OUTPUT_ARTIFACTS.POST_EVENT_RESULTS_JSON,
    workspaceRoot: '/workspaces/modelOptimizer',
    modeRoot: '/workspaces/modelOptimizer/data/2026/american-express/post_event',
    outputBaseName: 'american_express_seed-b',
    tournamentName: 'American Express'
  });

  assert.ok(
    candidates.includes('/workspaces/modelOptimizer/data/2026/american-express/post_event/american_express_seed-b_post_tournament_results.json')
  );
  assert.ok(
    candidates.includes('/workspaces/modelOptimizer/data/2026/american-express/post_event/american-express_results.json')
  );

  const summaryCandidates = getLegacyReadCandidates({
    artifactType: OUTPUT_ARTIFACTS.SEED_SUMMARY_TXT,
    workspaceRoot: '/workspaces/modelOptimizer',
    outputBaseName: 'american_express'
  });

  assert.deepEqual(summaryCandidates, ['/workspaces/modelOptimizer/output/american_express_seed_summary.txt']);
});
