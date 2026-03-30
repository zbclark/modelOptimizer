# OPTIMIZER_README

> **Project status (2026‑03‑25):** Pre-event pipeline produces a **tournament-specific ranked field** using blended historical performance, course context, approach-skill deltas, and optional ramp/weather adjustments. Post-event pipeline evaluates model predictions against results and writes season-level validation reports. Outputs are written to `data/<season>/<tournament>/pre_event/` and `post_event/`.
> **Note:** This document describes a *technical evaluation* workflow for ranking and post-event analysis. It is **not** betting advice.

---

## Future development (not implemented)

- **Automated field reconciliation** (auto-matching player IDs between DataGolf, configuration sheet, and approach-skill snapshot without manual overrides).
- **DraftKings DFS lineup integration** bridging optimizer scores to `run_dk_model_lineups.js` in a single pipeline call.
- **Live in-round adjustment** using live tournament stats mid-round (scaffolding exists in `dataGolfClient.js`; not yet connected to ranking output).

### Refactor safety checks (must stay green)

Use these smoke runs to confirm refactor changes do **not** alter outputs, especially in the wagering pipeline:

- Use a unique tag **per run** (not just per phase) to avoid overwrites.
- Recommended format: `phase<N>-YYYY-MM-DD-<run>` where `<run>` is `pre`, `post`, `results`, `validation`, `validation-all`, `wager-hist`, `wager-live`.
- Example tags: `phase1-2026-03-26-pre`, `phase1-2026-03-26-post`, `phase1-2026-03-26-results`.

### Optimizer pre-event (explicit)

```bash
OUTPUT_TAG=phase1-2026-03-26-pre-players node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --pre
```

### Optimizer post-event (explicit)

```bash
OPT_TESTS=200 OUTPUT_TAG=phase1-2026-03-27-post-players node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --post
```

### Optimizer results-only (aliases)

```bash
OUTPUT_TAG=phase1-2026-03-26-results node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --results
```

### Optimizer validation-only (aliases)

```bash
OUTPUT_TAG=phase1-2026-03-26-validation-only-alt node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --name "all" --validation
```

### Validation rollup (season)

```bash
OUTPUT_TAG=phase1-2026-03-26-validation-all node core/optimizer.js --season 2026 --name "all" --validation
```

### Validation rollup (explicit tournament)

```bash
OUTPUT_TAG=phase1-2026-03-26-validation-single node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --post --validation
```

### Wagering pipeline (historical + live)

```bash
OUTPUT_TAG=phase1-2026-03-26-wager-live node scripts/run_wagering_pipeline.js --season 2026 --event 20 --name "Texas Children's Open" --oddsSource live --oddsPoint current --market all
```

**Invariant checklist:**

- Optimizer artifacts appear under `data/<season>/<tournament>/{pre_event|post_event}/` with the same filenames and counts.
- Validation outputs remain under `data/<season>/validation_outputs/` with the same CSV/JSON schemas.
- Wagering pipeline outputs remain under `data/wagering/<tournament_slug>/` and `data/wagering/` with no missing files or schema drift.

---

## Goal

Build **tournament-specific, out-of-sample player rankings** by blending weighted historical performance, course context, and approach-skill signals, and evaluate those rankings post-event to measure predictive accuracy. The goal is to answer: *does the model's score ordering correspond to actual tournament outcomes AND does the top10 top20 overlap have significant correlation?*

---

## Evidentiary thresholds and evaluation questions

This section makes the intent explicit: **what questions are we trying to answer** at each entry point (pre-event vs post-event), and what evidence would be convincing.

### Pre-event questions (before outcomes are known)

- **Is the field well-covered?** Do we have sufficient historical rounds and approach-skill data for most players in the field?
- **Are weights course-appropriate?** Does the active template reflect the course type, setup weights, and shot-distribution demands?
- **Is approach delta signal stable?** Are the delta trend and predictive scores consistent with recent performance, not driven by small-sample noise?
- **Is ramp handling correct?** Are early-season players correctly dampened, and have mature-season players had dampening removed?

### Post-event questions (after outcomes are known)

- **Does the ranking order match results?** Is Spearman correlation with actual finish position meaningfully positive?
- **Are top-N predictions accurate?** How often do model top-5/top-10/top-20 players appear in actual top-N finishes?
- **Are metric weights pointing at the right signals?** Does the calibration report suggest any metric groups are over- or under-weighted?
- **Does performance persist by course type?** Do POWER, TECHNICAL, and BALANCED templates each show consistent Spearman across similar events?

### What would convince me?

- **Consistent positive Spearman** ($\rho_s \geq 0.15$) across at least 10–15 events in a season.
- **Top-20 hit rate above 60%** for model top-10 picks across multiple course types.
- **Stable calibration** (Spearman + RMSE both trending in the right direction) across 2+ seasons.
- **Metric weight convergence**: `Weight_Calibration_Guide` suggested weights remaining stable across consecutive events of the same course type.

---

## Pipeline overview (optimizer)

In practice, you run the **optimizer entry point**:

1. **`core/optimizer.js`** — end-to-end pre/post workflow (load inputs, fetch DataGolf data, score players, write rankings, evaluate post-event, optionally run validation rollups).

For **analysis workflows**, additional scripts are available:

- `scripts/analyze_course_history_impact.js` — builds course-history regression outputs for course-history prior weights.
- `scripts/analyze_early_season_ramp.js` — computes early-season ramp priors from DataGolf historical rounds.
- `scripts/summarizeSeedResults.js` — summarizes seeded post-event runs and cleans up non-best seed artifacts.

> **Refactor note:** Validation runs via `optimizer.js` (validation module is internal). **Future refactor goal:** keep `optimizer.js` as the single entry point for pre, post, and validation, with analysis scripts as optional extensions.

### Pre-event behavior

- Uses **DataGolf API/cache by default** for rankings, approach skill, field updates, decompositions, and skill ratings.
- Falls back to tournament CSV inputs in `data/<season>/<tournament>/inputs/` when present (configuration sheet, historical data, approach-skill CSV).
- Scores players using weighted group z-scores, BCC, approach deltas, ramp dampening, and optional course-fit and weather adjustments.
- Writes pre-event rankings (CSV + JSON), signal contributions, and a run log to `data/<season>/<tournament>/pre_event/`.

### Post-event behavior

- Uses **DataGolf API/cache by default** for historical rounds/results and live tournament stats when available.
- Falls back to local tournament inputs/results CSVs when present.
- Evaluates predictions vs outcomes, computes Spearman / RMSE / MAE / top-N hit rates.
- Writes post-event results (CSV + JSON), tournament results files, and can run seeded optimization passes to `data/<season>/<tournament>/post_event/`.
- Post-event artifacts are the inputs for season-level validation rollups (invoked via `optimizer.js`).

### Validation-only and utility modes

- **Validation-only** (`--validation` flag in `optimizer.js`): reads existing post-event artifacts; computes calibration, template correlation, and season summary reports.
- **Results-only** (`--results` flag): forces post-event mode; useful for re-running evaluations without re-fetching data.
- **Delta-only** (`--delta` flag): runs approach delta processing only; writes `approach_deltas/` files without scoring.
- **Dry-run** (`--dryRun` flag): runs the pipeline without writing output files; useful for configuration validation.

---

## Inputs and data sources

### Tournament inputs (CSV)

The optimizer consumes tournament CSVs from `data/<season>/<tournament>/inputs/`:

- `* - Configuration Sheet.csv` — metric group definitions, weights per group, template key, and shared config cells (approach blend, ramp weight, course setup weights).
- `* - Historical Data.csv` — player historical round data (SG metrics, scoring, proximity, etc.) pre-filtered to the relevant player pool.
- `* - Approach Skill.csv` — approach-skill bucket values per player, typically sourced from a DataGolf approach-skill snapshot.

These are loaded through utilities like `utilities/csvLoader.js`, `utilities/configParser.js`, and `utilities/dataPrep.js`.

### Course context

Course metadata comes from `utilities/course_context.json`, keyed by event ID. The optimizer reads fields such as:

- `templateKey`, `courseType` — identifies the weight template and course classification (POWER / TECHNICAL / BALANCED).
- `courseNum` / `courseNums` — DataGolf course number(s) used to filter historical rounds.
- `similarCourseIds`, `puttingCourseIds` — supplemental course pools for blending similar-course and putting-course round history.
- `similarCourseCourseNums`, `puttingCourseCourseNums` — course number arrays for similar/putting pools.
- `courseSetupWeights` — shot-distribution weights by distance bucket (under100, from100to150, from150to200, over200).
- `shotDistribution` — complementary distribution metadata for approach-metric weighting.
- `locationLat`, `locationLon`, `locationCity`, `locationState`, `locationCountry`, `timezone` — weather and tee-time context.

### DataGolf API + cache

The optimizer and analysis scripts pull DataGolf data and cache results under `data/cache/`. TTL settings are controlled by `DATAGOLF_*_TTL_HOURS` environment variables.

| Data type | Cache file | TTL env var | Used for |
| --------- | --------- | ----------- | ------- |
| Rankings | `datagolf_rankings.json` | `DATAGOLF_RANKINGS_TTL_HOURS` | Baseline player rankings + skill estimates |
| Approach skill | `datagolf_approach_skill_<period>.json` | `DATAGOLF_APPROACH_TTL_HOURS` | Approach-skill snapshots |
| Field updates | `datagolf_field_updates_<tour>.json` | `DATAGOLF_FIELD_TTL_HOURS` | Event field, course name, start date |
| Player decompositions | `datagolf_player_decompositions_<tour>.json` | `DATAGOLF_DECOMP_TTL_HOURS` | Player component breakdowns |
| Skill ratings | `datagolf_skill_ratings.json` | `DATAGOLF_SKILL_TTL_HOURS` | Skill-rating inputs |
| Historical rounds | `datagolf_historical_rounds_<tour>_<event>.json` | `DATAGOLF_HISTORICAL_TTL_HOURS` | Historical round stats for scoring + validation |
| Live tournament stats | `datagolf_live_tournament_stats.json` | (no TTL; fetched on demand) | In-round stats when available |
| Weather forecast | `weather_forecast_<eventId>.json` | `WEATHER_TTL_HOURS` | Wave penalty computation |

### Approach snapshots and deltas

Approach snapshots live under `data/approach_snapshot/`:

- `approach_l24.json` — last 24 months of approach skill.
- `approach_l12.json` — last 12 months of approach skill.
- `approach_ytd_latest.json` — year-to-date approach skill (refreshed monthly or on demand).
- `archive/` — timestamped snapshots for historical comparison.

Approach deltas are written to `data/approach_deltas/approach_deltas_<slug>_YYYY_MM_DD.json` and contain per-player delta trend and predictive scores across approach distance buckets. Deltas can be reloaded for subsequent runs via `--approachDeltaCurrent` / `--approachDeltaPrevious`.

---

## How the optimizer scores players

The core scoring logic is in `core/modelCore.js`. The pipeline processes each player in the field through the following stages:

### 1. Historical averages

Historical averages are computed from the player's round history (from `* - Historical Data.csv` and/or DataGolf historical rounds API), weighted by:

- **Recency decay**: recent rounds receive higher weight (exponential decay with configurable lambda).
- **Course blending**: up to three round pools are blended — (a) primary course history, (b) similar-course rounds, and (c) putting-course rounds — using configurable blend weights from course context.

The 16 base historical metrics are: SG Total, Driving Distance, Driving Accuracy, SG T2G, SG Approach, SG Around Green, SG Off Tee, SG Putting, Greens in Regulation, Fairway Proximity, Rough Proximity, Scrambling, Great Shots, Poor Shots, Scoring Average, Birdies or Better.

### 2. Approach metrics

Approach metrics are loaded from the approach-skill snapshot via `utilities/approachDelta.js` and `getApproachMetrics()`. The 18 approach metrics cover 6 distance/lie buckets × 3 values (GIR %, SG, Proximity):

- Approach <100: GIR, SG, Proximity
- Approach <150 FW: GIR, SG, Proximity
- Approach <150 Rough: GIR, SG, Proximity
- Approach >150 Rough: GIR, SG, Proximity
- Approach <200 FW: GIR, SG, Proximity
- Approach >200 FW: GIR, SG, Proximity

### 3. Birdie Chances Created (BCC)

BCC is a composite metric inserted at array position 14 (before the historical array is finalized). It is computed as a z-score blend of:

- Weighted GIR (0.35)
- Weighted approach SG (0.35)
- Weighted proximity (inverted; 0.15)
- SG Putting (0.10)
- Anchor: Birdies or Better, or Scoring Average as fallback (0.05)

See Appendix D for the BCC equation.

### 4. Metric trends

Trends are computed from the most recent 24 rounds via `calculateMetricTrends()`, using exponential decay (λ = 0.20) and a smoothing window of 3 rounds. Trend values are applied additively to the 16 historical metrics before z-score computation.

### 5. Data coverage & shrinkage

Data coverage is the fraction of metrics with non-zero values, blended between base coverage (historical) and approach coverage (weighted by `MODEL_APPROACH_COVERAGE_WEIGHT`). The shrinkage alpha pulls metric z-scores toward the field mean for low-coverage players:

$$
\alpha = \mathrm{clamp}(\mathrm{dataCoverage},\; \alpha_{\min},\; \alpha_{\max})
$$

Where $\alpha_{\min}$ = `MODEL_SHRINKAGE_MIN` (default 0.4) and $\alpha_{\max}$ = `MODEL_SHRINKAGE_MAX` (default 1.0).

### 6. Group scores and weighted score

Metrics are organized into groups (from the configuration sheet). For each group, metrics are z-score normalized, weighted, and summed. Group scores are then aggregated into a weighted score:

$$
\mathrm{Weighted\ Score} = \sum_g w_g \left( \sum_{m \in g} w_{m|g} \cdot z_m \right)
$$

### 7. Approach delta bonus

If approach delta data is available, a delta bonus (capped at ±0.10, with a +0.05 gated boost when both trend and predictive scores are positive) is added to the weighted score.

### 8. Course-fit multiplier

If `MODEL_COURSE_FIT_METHOD` is active (`topn` or `weighted`), a multiplier is applied to the weighted score. Poor fit (based on z-scores of key metrics) can dampen the score (default multiplier 0.80); strong fit leaves it unchanged (1.0). See Appendix D.

### 9. Tee-time bias

If `MODEL_TEE_TIME_BIAS` is non-zero, scores are adjusted by a multiplier derived from the player's tee time percentile relative to the field (early or late wave advantage/disadvantage).

### 10. Coverage confidence & ramp dampening

The refined (final) score applies two additional multipliers:

- **Coverage confidence**: $f(\mathrm{dataCoverage})$ — a non-linear function that penalizes players with very low data coverage. Returns 1.0 for coverage ≥ 0.70. See Appendix D.
- **Ramp dampening**: for early-season players (events-in-season < avg return-to-form index), dampens the score by `rampWeight × (1 − rampReadiness)`.

$$
\mathrm{Refined\ Score} = \mathrm{Weighted\ Score} \times \mathrm{CoverageConfidence} \times \mathrm{RampDampening}
$$

### 11. Weather wave penalty

If weather integration is enabled (`WEATHER_ENABLED=1` **or** `WEATHER_API_KEY` is set), SG metrics and approach bucket metrics are adjusted by a tee-wave penalty derived from hourly forecast data (wind, rain probability, convective risk) and the player's R1/R2 tee wave assignment.

---

## Pre-event vs post-event behavior

See the **Pipeline overview** section above for the primary breakdown. Key distinctions:

- **Pre-event** (`--pre`): generates rankings only; results are not available. Outputs include `_pre_event_rankings.csv/json`, `_signal_contributions.json`, and `_pre_event_log.txt`.
- **Post-event** (`--post`): evaluates predictions against results. Outputs include `<output-base>_post_event_results.json`, the results sheet at `<tournament-slug>_results.csv`, tournament results files, and optionally seed_runs.
- **Validation** (`--validation`): season-level rollups; reads all post-event artifacts and writes calibration, template, and season-summary reports.
- **Delta** (`--delta`): approach delta processing only; writes `approach_deltas/` files.

---

See **Appendix B — Storage layout & naming conventions** for the full directory tree.

### Pre-event artifacts (`data/<season>/<tournament>/pre_event/`)

- `<output-base>_pre_event_results.json`
- `<output-base>_pre_event_results.txt`
- `<output-base>_pre_event_rankings.json`
- `<output-base>_pre_event_rankings.csv`
- `<output-base>_signal_contributions.json`
- `<output-base>_pre_event_log.txt`
- `dryrun/*` (when `--dryRun` is enabled)

### Post-event artifacts (`data/<season>/<tournament>/post_event/`)

- `<output-base>_post_event_results.json`
- `<output-base>_post_event_results.txt`
- `<output-base>_post_event_log.txt`
- `<tournament-slug>_results.json`
- `<tournament-slug>_results.csv`
- `seed_runs/*` (seeded runs)
- `<output-base>_seed_summary.txt` (from `scripts/summarizeSeedResults.js`)

**Key distinction (naming + content):**

- **Post-event results** (`<output-base>_post_event_results.json` plus the **results sheet** at `<tournament-slug>_results.csv`) are **model‑vs‑actual comparison outputs**. They include model values alongside actual results metrics, plus performance notes and model rank/finish position.
- **Tournament results (raw)** (`<tournament-slug>_results.json`) are **actual‑only event result tables**. The base name is the **slugified tournament name** (not the output base name).

### Validation artifacts (`data/<season>/validation_outputs/`)

- `Calibration_Report.json` / `.csv`
- `Course_Type_Classification.json` / `.csv`
- `Weight_Calibration_Guide.json` / `.csv`
- `Weight_Templates.json` / `.csv`
- `Model_Delta_Trends.json` / `.csv`
- `Processing_Log.json`
- `metric_analysis/<tournament>_metric_analysis.json` / `.csv`
- `template_correlation_summaries/<TEMPLATE>_Correlation_Summary.json` / `.csv`
- `season_summaries/Season_Post_Event_Summary.json` / `.csv` / `.md`
- `top20_blend/<tournament>_top20_template_blend.json`

### Analysis artifacts

- `early_season_ramp_<metric>.json` / `.csv` (from `scripts/analyze_early_season_ramp.js`)
- `course_history_regression.json` + CSVs (from `scripts/analyze_course_history_impact.js`)

---

## Example workflows

### Pre-event ranking run

```bash
node core/optimizer.js --event 7 --season 2026 --tournament "Genesis Invitational" --pre
```

**Required flags:**

- `--event` (or `--eventId`)
- `--season`

**Implied defaults:**

- `DATAGOLF_APPROACH_PERIOD=l24` (unless overridden)
- `VALIDATION_APPROACH_MODE=current_only`
- `APPROACH_DELTA_ROLLING_EVENTS=4`
- `--apiYears <YYYY[-YYYY]>` is optional; use to override the historical DataGolf year window
- Output root under `data/<season>/<tournament>/pre_event/`

**Optional flags (common):**

- `--dryRun` (validate + skip writes)
- `--dataDir <path>` / `--outputDir <path>` / `--dir <subfolder>` (override data/output roots)
- `--approachDeltaCurrent <path>` / `--approachDeltaPrevious <path>` / `--approachDeltaIgnoreLag`
- `--rollingDeltas <N>`
- `--includeCurrentEventRounds` / `--excludeCurrentEventRounds`
- `--forceFieldUpdates`
- `--log` / `--verbose`

### Post-event evaluation run

```bash
node core/optimizer.js --event 7 --season 2026 --tournament "Genesis Invitational" --post
```

**Required flags:**

- `--event` (or `--eventId`)
- `--season`

**Implied defaults:**

- Post-event outputs under `data/<season>/<tournament>/post_event/`
- Validation artifacts under `data/<season>/validation_outputs/` (when validation is enabled)

**Optional flags (common):**

- `--results` (force post-event evaluation)
- `--validation` (include validation rollups after post-event)
- `--dryRun` (validate + skip writes)
- `--dataDir <path>` / `--outputDir <path>` / `--dir <subfolder>` (override data/output roots)
- `--approachDeltaCurrent <path>` / `--approachDeltaPrevious <path>` / `--approachDeltaIgnoreLag`
- `--rollingDeltas <N>`
- `--includeCurrentEventRounds` / `--excludeCurrentEventRounds`
- `--forceFieldUpdates`
- `--log` / `--verbose`

### Post-event seed runs (primary: `run_background.sh`)

For seeded post-event runs, use `scripts/run_background.sh` as the **primary** entry point. It launches the optimizer in the background (nohup) and can optionally launch a dedicated `tmux` session for long seed sweeps.

```bash
bash scripts/run_background.sh \
  --event 7 \
  --season 2026 \
  --name "Genesis Invitational" \
  --post \
  --seeds a, b, c, d, e
```

**tmux variant:**

```bash
bash scripts/run_background.sh \
  --event 7 \
  --season 2026 \
  --name "Genesis Invitational" \
  --post \
  --seeds a, b, c, d, e \
  --tmux \
  --tmuxSession optimizer_genesis_post_seeds
```

Notes:

- Logs are written to the optimizer log path computed by `utilities/outputPaths.js` (per seed when `--seeds` is used).
- Seeds are executed sequentially within the background process.
- `--tmux` starts a new tmux session and runs the background command inside it (fails if the session already exists).

### Validation rollup

```bash
node core/optimizer.js --season 2026 --name "all" --validation
```

**Required flags:**

- none (uses available artifacts on disk)

**Optional flags (common):**

- `--dataDir <path>` / `--outputDir <path>` / `--dir <subfolder>` (override data/output roots)
- `--log` / `--verbose`

### Early-season ramp analysis

```bash
node scripts/analyze_early_season_ramp.js --apiYears 2022-2026 --metric finish
```

**Required flags:**

- `--apiYears <YYYY[-YYYY]>`

**Implied defaults:**

- `--metric finish`
- `--maxEvents 6`, `--minEvents 3`
- `--baselineSeasons 5`
- Output under `data/analysis/` (or `--outputDir` override)

### Course-history regression

```bash
node scripts/analyze_course_history_impact.js
```

**Required flags:**

- `PRE_TOURNAMENT_EVENT_ID` and `PRE_TOURNAMENT_SEASON` env vars (if not set, script cannot scope event/season).

**Implied defaults:**

- `PRE_TOURNAMENT_OUTPUT_DIR` falls back to `data/course_history_regression/`
- `COURSE_HISTORY_DECAY_LAMBDA=0.25`

### Seed summary

```bash
node scripts/summarizeSeedResults.js --tournament "Genesis Invitational" --season 2026
```

**Required flags:**

- `--tournament "<name>"` **or** `--event <id>`

**Implied defaults:**

- Searches `data/<season>/<tournament>/post_event/seed_runs/` then `post_event/`
- Falls back to legacy `output/` if nothing found in `data/`

---

## CLI flags

### `core/optimizer.js`

- `--event <id>` / `--eventId <id>` — event ID to run. **Default:** none (required unless season-level validation).
- `--season <year>` / `--year <year>` — season year. **Default:** none (required unless season-level validation).
- `--tournament "<name>"` / `--name "<name>"` — label used for output naming + manifest resolution. **Default:** derived from DataGolf field/manifest.
- `--template <key>` — override template key. **Default:** from course context/config sheet; fallback to course/event key.
- `--pre` / `--post` — force pre- or post-event mode. **Default:** none (explicit mode required).
- `--validation` / `--validationOnly` / `--runValidation` — validation-only season rollups. **Default:** false.
- `--results` / `--resultsOnly` — results-only export using existing pre-event rankings. **Default:** false.
- `--delta` / `--deltaOnly` — approach-delta-only run (writes `approach_deltas/`). **Default:** false.
- `--tests <N>` — optimizer test count. **Default:** `OPT_TESTS` or `1500`.
- `--seed <value>` — RNG seed (overrides `OPT_SEED`). **Default:** unset.
- `--rollingDeltas <N>` — rolling window for delta trends. **Default:** `APPROACH_DELTA_ROLLING_EVENTS` (4).
- `--approachDeltaCurrent <path>` — explicit delta snapshot path. **Default:** unset.
- `--approachDeltaPrevious <path>` — explicit prior delta snapshot path. **Default:** unset.
- `--approachDeltaIgnoreLag` — ignore lag check between delta snapshots. **Default:** false.
- `--includeCurrentEventRounds` / `--excludeCurrentEventRounds` — override current-event round inclusion. **Default:** auto.
- `--forceFieldUpdates` — refresh DataGolf field cache. **Default:** false.
- `--dryRun` — validate + skip writes. **Default:** false.
- `--writeTemplates` — write template artifacts (forces `dryRun=false`). **Default:** false.
- `--writeValidationTemplates` — write validation templates. **Default:** false.
- `--log` / `--verbose` — force logging on. **Default:** logging enabled unless `LOGGING_ENABLED=0`.
- `--dir <subfolder>` — set data/output root under `data/<subfolder>`. **Default:** `data/`.
- `--dataDir <path>` — override data root. **Default:** `data/`.
- `--outputDir <path>` — override output root. **Default:** `data/`.
- `--apiYears <YYYY[,YYYY]>` — override historical DataGolf year window. **Default:** unset.

### `scripts/analyze_early_season_ramp.js`

- `--dir <subfolder>` — set data root under `data/<subfolder>`. **Default:** unset.
- `--dataDir <path>` — override data root. **Default:** `data/`.
- `--outputDir <path>` — override output root. **Default:** `data/analysis/`.
- `--metric finish|sg_total` — metric to model. **Default:** `finish`.
- `--maxEvents <N>` — max events per season. **Default:** 6.
- `--minEvents <N>` — minimum events required. **Default:** 3.
- `--tours <tour1,tour2>` — filter tours (comma-separated). **Default:** all tours in data.
- `--baselineSeasons <N>` — seasons used for baseline. **Default:** 5.
- `--apiYears <YYYY[-YYYY]>` — years to fetch from DataGolf API. **Default:** required.
- `--apiTour <tour>` — DataGolf tour for API pulls. **Default:** `pga` (or the single tour from `--tours`).
- `--debugApi` — log API payload details. **Default:** false.

### `scripts/summarizeSeedResults.js`

- `--tournament "<name>"` / `--name "<name>"` — tournament label. **Default:** none (required if `--event` not supplied).
- `--event <id>` / `--eventId <id>` — event ID. **Default:** none (required if `--tournament` not supplied).
- `--season <year>` — scope to a season. **Default:** most recent season found in `data/`.
- `--dir <path>` / `--outputDir <path>` — override seed-results directory. **Default:** `data/<season>/<tournament>/post_event/seed_runs` → `post_event` → `data/` (fallback to legacy `output/`).

## Environment variables

### Core optimizer controls

- `OPT_SEED` — RNG seed for optimization runs. **Default:** unset (random).
- `OPT_TESTS` — optimization test count. **Default:** unset (falls back to `1500`).
- `LOGGING_ENABLED` — enable/disable logging. **Default:** `true` (set `0/false` to disable).
- `WRITE_TEMPLATES` — write template artifacts. **Default:** `false`.
- `WRITE_VALIDATION_TEMPLATES` — write validation template artifacts. **Default:** `false`.
- `VALIDATION_APPROACH_MODE` — approach snapshot policy for validation. **Default:** `current_only`. **Options:** `current_only`, `none`.
- `APPROACH_BLEND_WEIGHTS` — blend YTD/L12/L24 approach snapshots (e.g., `0.6,0.3,0.1`). **Default:** unset (no blend).
- `APPROACH_GROUP_CAP` — cap total approach group weight. **Default:** unset (disabled). **Range:** `0–1`.
- `APPROACH_DELTA_ROLLING_EVENTS` — rolling window for delta trends. **Default:** `4`.
- `APPROACH_DELTA_MIN_DAYS` — minimum days between delta snapshots. **Default:** `5`.
- `APPROACH_DELTA_SNAPSHOT_ONLY_EVENTS` — comma list of event IDs/slugs to force snapshot-only deltas. **Default:** unset.
- `OPT_OBJECTIVE_CORR` — override objective weight for correlation. **Default:** unset (uses `0.3`).
- `OPT_OBJECTIVE_TOP20` — override objective weight for Top‑20 hit rate. **Default:** unset (uses `0.5`).
- `OPT_OBJECTIVE_ALIGN` — override objective weight for template alignment. **Default:** unset (uses `0.2`).
- `OPT_LOEO_PENALTY` — LOEO penalty factor. **Default:** `0`.
- `OPT_LOEO_TOP_N` — LOEO top‑N threshold. **Default:** `0`.
- `PAST_PERF_RAMP_WEIGHT` — ramp dampening weight. **Default:** `0.4`.

### DataGolf + cache controls

- `DATAGOLF_API_KEY` — DataGolf API key. **Default:** unset.
- `DATAGOLF_RANKINGS_TTL_HOURS` — rankings cache TTL. **Default:** `24`.
- `DATAGOLF_APPROACH_TTL_HOURS` — approach cache TTL. **Default:** `24`.
- `DATAGOLF_FIELD_TTL_HOURS` — field updates TTL. **Default:** `6`.
- `DATAGOLF_SKILL_TTL_HOURS` — skill ratings TTL. **Default:** `24`.
- `DATAGOLF_DECOMP_TTL_HOURS` — decompositions TTL. **Default:** `24`.
- `DATAGOLF_HISTORICAL_TTL_HOURS` — historical rounds TTL. **Default:** `72`.
- `DATAGOLF_FIELD_TOUR` — field updates tour. **Default:** `pga`.
- `DATAGOLF_DECOMP_TOUR` — decompositions tour. **Default:** `pga`.
- `DATAGOLF_HISTORICAL_TOUR` — historical rounds tour. **Default:** `pga`.
- `DATAGOLF_HISTORICAL_EVENT_ID` — historical rounds event ID. **Default:** `all`.
- `DATAGOLF_HISTORICAL_YEAR` — historical rounds year override. **Default:** unset.

### Approach snapshot refresh

- `APPROACH_L12_REFRESH_MONTH` — month to refresh L12 snapshot. **Default:** `12`.
- `APPROACH_L12_FORCE_REFRESH` — force L12 refresh. **Default:** `false`.
- `APPROACH_L12_REFRESH_SEASON` — season used for refresh. **Default:** unset.
- `APPROACH_L12_REFRESH_EVENT_ID` — event ID used for refresh. **Default:** `60`.
- `APPROACH_SNAPSHOT_RETENTION_YTD` — number of YTD snapshots to retain. **Default:** `4` (min `2`).

### Model scoring toggles

- `MODEL_GROUP_SCORE_Z` — use group‑level z‑scores. **Default:** `false`.
- `MODEL_BCC_PRESTANDARDIZED` — treat BCC as pre‑standardized. **Default:** `false`.
- `MODEL_SHRINKAGE` — enable shrinkage toward field mean. **Default:** `false`.
- `MODEL_SHRINKAGE_MIN` — shrinkage floor. **Default:** `0.4`.
- `MODEL_SHRINKAGE_MAX` — shrinkage ceiling. **Default:** `1.0`.
- `MODEL_APPROACH_COVERAGE_WEIGHT` — weight of approach coverage in data coverage. **Default:** `0.8`.
- `MODEL_COURSE_FIT_METHOD` — course‑fit method. **Default:** `topn`. **Options:** `topn`, `weighted`.
- `MODEL_COURSE_FIT_POOR_MULT` — poor‑fit multiplier. **Default:** `0.8`.
- `MODEL_COURSE_FIT_GOOD_MULT` — good‑fit multiplier. **Default:** `0.95`.
- `MODEL_COURSE_FIT_STRONG_MULT` — strong‑fit multiplier. **Default:** `1.0`.
- `MODEL_COURSE_FIT_STRONG_Z` — weighted fit strong threshold. **Default:** `0.35`.
- `MODEL_COURSE_FIT_GOOD_Z` — weighted fit good threshold. **Default:** `0.15`.
- `MODEL_COURSE_FIT_POOR_Z` — weighted fit poor threshold. **Default:** `-0.35`.
- `MODEL_TEE_TIME_BIAS` — tee‑time bias strength. **Default:** `0.0` (disabled).
- `MODEL_TEE_TIME_MAX_SHIFT` — max tee‑time multiplier shift. **Default:** `0.03` (clamped `0–0.2`).
- `MODEL_TEE_TIME_MIN_PLAYERS` — minimum players to enable bias. **Default:** `20` (min `5`).
- `MODEL_TEE_TIME_EARLY_ADVANTAGE` — sign for early vs late advantage. **Default:** `1` (early‑wave advantage).

### Weather integration

- `WEATHER_ENABLED` — force weather on/off. **Default:** enabled when `WEATHER_API_KEY` is set.
- `WEATHER_API_KEY` — Meteoblue API key. **Default:** unset.
- `WEATHER_TTL_HOURS` — weather cache TTL. **Default:** `6`.
- `WEATHER_PACKAGE` — Meteoblue package name. **Default:** `basic-1h_basic-day`.
- `WEATHER_FORECAST_DAYS` — forecast horizon (days). **Default:** `4` (clamped `2–7`).
- `WEATHER_WAVE_AM_START` / `WEATHER_WAVE_AM_END` — AM window hours. **Default:** `6–12`.
- `WEATHER_WAVE_PM_START` / `WEATHER_WAVE_PM_END` — PM window hours. **Default:** `12–18`.
- `WEATHER_RAIN_PROB_MAX_PENALTY` — max rain‑prob penalty. **Default:** `0.10`.
- `WEATHER_RAIN_PROB_GAMMA` — rain‑prob curve. **Default:** `1.7`.
- `WEATHER_RAIN_AMT_LOW` / `MED` / `HIGH` — rain amount thresholds. **Default:** `0.5 / 2.0 / 5.0`.
- `WEATHER_RAIN_AMT_PENALTY_LOW` / `MED` / `HIGH` — rain amount penalties. **Default:** `0.02 / 0.04 / 0.06`.
- `WEATHER_CONVECTIVE_PROB_THRESHOLD` — convective risk threshold. **Default:** `40`.
- `WEATHER_CONVECTIVE_PENALTY` — convective penalty. **Default:** `0.08`.
- `WEATHER_WIND_SUSTAINED_THRESHOLD` — sustained wind threshold (mph). **Default:** `15`.
- `WEATHER_WIND_GUST_THRESHOLD` — gust threshold (mph). **Default:** `20`.
- `WEATHER_WIND_PENALTY_ONE` — penalty when sustained **or** gust exceeds threshold. **Default:** `0.03`.
- `WEATHER_WIND_PENALTY_BOTH` — penalty when sustained **and** gust exceed threshold. **Default:** `0.05`.
- `WEATHER_PENALTY_CAP` — max total weather penalty. **Default:** `0.14`.
- `WEATHER_UPDATE_CONTEXT` — write back course location updates. **Default:** `false`.
- `MODEL_WEATHER_WAVE_ENABLED` — apply weather penalties in scoring. **Default:** `0` (disabled).
- `MODEL_WEATHER_WAVE_R1_EARLY_PENALTY` / `MODEL_WEATHER_WAVE_R1_LATE_PENALTY` — base R1 penalties. **Default:** `0`.
- `MODEL_WEATHER_WAVE_R2_EARLY_PENALTY` / `MODEL_WEATHER_WAVE_R2_LATE_PENALTY` — base R2 penalties. **Default:** `0`.

### Analysis script controls

- `PRE_TOURNAMENT_EVENT_ID` — event ID for course‑history regression. **Default:** unset (required).
- `PRE_TOURNAMENT_SEASON` — season for course‑history regression. **Default:** unset (required).
- `PRE_TOURNAMENT_OUTPUT_DIR` — output dir for regression artifacts. **Default:** `data/course_history_regression/`.
- `COURSE_HISTORY_DECAY_LAMBDA` — decay lambda for course‑history weights. **Default:** `0.25`.
- `COURSE_HISTORY_DEBUG` — enable course‑history debug logging. **Default:** `false`.
- `DATAGOLF_DEBUG` — enable DataGolf debug logging. **Default:** `false`.
- `SKIP_SEED_CLEANUP` — skip seed‑run cleanup in `summarizeSeedResults.js`. **Default:** `false`.

---

## Notes on naming

- `outputBaseName` is derived from the tournament slug/name and optional seed tag (see `utilities/outputPaths.js`).
- Tournament results files use the slugified tournament name (e.g., `<tournament-slug>_results.csv`).
- Legacy `output/` paths are read for backwards compatibility but new outputs default to `data/`.

---

## Appendix Index

- **Appendix A** — DataGolf API references (params + endpoints)
- **Appendix B** — Storage layout & naming conventions
- **Appendix C** — File schemas (reference)
- **Appendix D** — Equations & scoring
- **Appendix E** — Helper scripts & utilities

## Appendix A — DataGolf API references (params + endpoints)

### Rankings

- **Player rankings + DataGolf skill estimates**
  - `https://feeds.datagolf.com/preds/get-dg-rankings?file_format=[json|csv]&key=...`
  - Params: `file_format` (json/csv)
  - Fields: `player_name`, `dg_id`, `datagolf_rank`, `dg_skill_estimate`, `owgr_rank`, `primary_tour`, `country`, `am` (amateur flag)

### Approach skill

- **Approach-skill bucket values by period**
  - `https://feeds.datagolf.com/preds/approach-skill?period=[l24|l12|ytd]&file_format=[json|csv]&key=...`
  - Params: `period` (l24/l12/ytd), `file_format` (json/csv)
  - Fields: `player_name`, `dg_id`, `period`, and approach bucket columns — `sg_app_100`, `gir_100`, `prox_100`, `sg_app_150fw`, `gir_150fw`, `prox_150fw`, `sg_app_150rgh`, `gir_150rgh`, `prox_150rgh`, `sg_app_200fw`, `gir_200fw`, `prox_200fw`, `sg_app_200rgh`, `gir_200rgh`, `prox_200rgh`, `sg_app_200p`, `gir_200p`, `prox_200p`

### Field updates

- **Active event field + course and timing context**
  - `https://feeds.datagolf.com/field-updates?tour=[tour]&file_format=[json|csv]&key=...`
  - Params: `tour` (pga/euro/kft/opp/alt), `file_format` (json/csv)
  - Fields: `event_id`, `event_name`, `course_name`, `start_date`, `tour`, `calendar_year`, `field` (array of `{ dg_id, player_name, country, am, early_late }`), `current_round`, `timezone`

### Player decompositions

- **Player skill component breakdowns**
  - `https://feeds.datagolf.com/preds/player-decompositions?tour=[tour]&file_format=[json|csv]&key=...`
  - Params: `tour` (pga/euro/kft/opp/alt), `file_format` (json/csv)
  - Fields: `player_name`, `dg_id`, `sg_putt`, `sg_arg`, `sg_app`, `sg_ott`, `sg_t2g`, `driving_dist`, `driving_acc`, `dg_skill_estimate`

### Skill ratings

- **Player strokes-gained skill ratings**
  - `https://feeds.datagolf.com/preds/skill-ratings?display=[value|rank]&file_format=[json|csv]&key=...`
  - Params: `display` (value/rank), `file_format` (json/csv)
  - Fields: `player_name`, `dg_id`, `sg_putt`, `sg_arg`, `sg_app`, `sg_ott`, `sg_t2g`, `sg_total`, `driving_dist`, `driving_acc`

### Historical rounds

- **Historical round-by-round statistics**
  - `https://feeds.datagolf.com/historical-raw-data/rounds?tour=[tour]&event_id=[event_id|all]&year=[year]&file_format=[json|csv]&key=...`
  - Params: `tour` (pga/euro/kft), `event_id` (specific event ID or `all`), `year` (YYYY), `file_format` (json/csv)
  - Top-level fields: `event_id`, `event_name`, `tour`, `event_completed`, `year`, `calendar_year`
  - Per-player fields (in `scores` array): `dg_id`, `player_name`, `fin_text`
  - Per-round fields (nested under `round_1` … `round_4`): `sg_total`, `sg_putt`, `sg_arg`, `sg_app`, `sg_ott`, `sg_t2g`, `sg_bs`, `driving_dist`, `driving_acc`, `gir`, `prox_fw`, `prox_rgh`, `scrambling`, `great_shots`, `poor_shots`, `score`, `date`, `course_num`

### Live tournament stats

- **In-round strokes-gained statistics**
  - `https://feeds.datagolf.com/preds/live-tournament-stats?stats=[stat_csv]&round=[event_avg|r1|r2|r3|r4]&display=[value|rank]&file_format=[json|csv]&key=...`
  - Params: `stats` (comma-separated list, e.g. `sg_ott,sg_app,sg_arg,sg_putt,sg_t2g,sg_total,distance,accuracy,gir,prox_fw,prox_rgh,scrambling,great_shots,poor_shots`), `round` (event_avg/r1/r2/r3/r4), `display` (value/rank), `file_format` (json/csv)
  - Fields: `player_name`, `dg_id`, `round`, per-stat value or rank columns matching the `stats` param, `fin_text`, `total`

### Weather (Meteoblue)

- **Location search**
  - `https://www.meteoblue.com/en/server/search/query3?query=[location_string]&apikey=...`
  - Params: `query` (city/course name string), `apikey`
  - Fields: `results` array with `name`, `lat`, `lon`, `country`, `timezone`

- **Hourly forecast**
  - `https://my.meteoblue.com/packages/[package]?lat=[lat]&lon=[lon]&format=json&timeformat=timestamp_utc&tz=[timezone]&windspeed=mph&precipitationamount=inch&temperature=F&forecast_days=[N]&apikey=...`
  - Params: `package` (e.g. `basic-1h`), `lat`, `lon`, `format`, `timeformat`, `tz`, `windspeed`, `precipitationamount`, `temperature`, `forecast_days`, `apikey`
  - Fields: `data_1h` object containing arrays: `time`, `temperature`, `precipitation`, `precipitation_probability`, `windspeed`, `winddirection`, `convective_precipitation`, `sunshinetime`

---

## Appendix B — Storage layout & naming conventions

```text
data/
  cache/
    field/
    historical_rounds/
    other/
    weather/
  approach_snapshot/
    approach_l24.json
    approach_l12.json
    approach_ytd_latest.json
    archive/
  approach_deltas/
    approach_deltas_<slug>_YYYY_MM_DD.json
  <season>/
    manifest.json
    <tournament-slug>/
      inputs/
      pre_event/
        analysis/
        course_history_regression/
        dryrun/
      post_event/
        dryrun/
        seed_runs/
    validation_outputs/
      metric_analysis/
      template_correlation_summaries/
      top20_blend/
      season_summaries/
```

---

## Appendix C — File schemas (reference)

### Pre-event rankings CSV (`<output-base>_pre_event_rankings.csv`)

```text
Expected Performance Notes, Rank, DG ID, Player Name, Top 5, Top 10, Weighted Score, Past Perf. Mult.,
SG Total, SG Total Trend, Driving Distance, Driving Distance Trend, Driving Accuracy, Driving Accuracy Trend,
SG T2G, SG T2G Trend, SG Approach, SG Approach Trend, SG Around Green, SG Around Green Trend,
SG OTT, SG OTT Trend, SG Putting, SG Putting Trend, Greens in Regulation, Greens in Regulation Trend,
Scrambling, Scrambling Trend, Great Shots, Great Shots Trend, Poor Shots, Poor Shots Trend,
Scoring Average, Scoring Average Trend, Birdies or Better, Birdies or Better Trend,
Birdie Chances Created, Birdie Chances Created Trend, Fairway Proximity, Fairway Proximity Trend,
Rough Proximity, Rough Proximity Trend,
Approach <100 GIR, Approach <100 SG, Approach <100 Prox,
Approach <150 FW GIR, Approach <150 FW SG, Approach <150 FW Prox,
Approach <150 Rough GIR, Approach <150 Rough SG, Approach <150 Rough Prox,
Approach >150 Rough GIR, Approach >150 Rough SG, Approach >150 Rough Prox,
Approach <200 FW GIR, Approach <200 FW SG, Approach <200 FW Prox,
Approach >200 FW GIR, Approach >200 FW SG, Approach >200 FW Prox,
Refined Weighted Score, WAR, Delta Trend Score, Delta Predictive Score
```

**Note:** The last two columns are currently emitted with median annotations in the header (e.g., `Delta Trend Score (median=0.181)`), but the underlying data remains unchanged.

### Post-event results CSV (results sheet)

**Naming (per code):** the results sheet is written as `<tournament-slug>_results.csv`.
**Legacy names (older runs only):** `<tournament-slug>_post_event_results.csv` or `tournament_results.csv`.

```text
Performance Notes, DG ID, Player Name, Finish Position, Model Rank,
SG Total (Actual), SG Total (Model),
Driving Distance (Actual), Driving Distance (Model),
Driving Accuracy (Actual), Driving Accuracy (Model),
SG T2G (Actual), SG T2G (Model),
SG Approach (Actual), SG Approach (Model),
SG Around Green (Actual), SG Around Green (Model),
SG OTT (Actual), SG OTT (Model),
SG Putting (Actual), SG Putting (Model),
Greens in Regulation (Actual), Greens in Regulation (Model),
Scrambling (Actual), Scrambling (Model),
Great Shots (Actual), Great Shots (Model),
Poor Shots (Actual), Poor Shots (Model),
Scoring Average (Actual), Scoring Average (Model),
Fairway Proximity (Actual), Fairway Proximity (Model),
Rough Proximity (Actual), Rough Proximity (Model),
Approach <100 GIR (Actual), Approach <100 GIR (Model),
Approach <100 SG (Actual), Approach <100 SG (Model),
Approach <100 Prox (Actual), Approach <100 Prox (Model),
Approach <150 FW GIR (Actual), Approach <150 FW GIR (Model),
Approach <150 FW SG (Actual), Approach <150 FW SG (Model),
Approach <150 FW Prox (Actual), Approach <150 FW Prox (Model),
Approach <150 Rough GIR (Actual), Approach <150 Rough GIR (Model),
Approach <150 Rough SG (Actual), Approach <150 Rough SG (Model),
Approach <150 Rough Prox (Actual), Approach <150 Rough Prox (Model),
Approach >150 Rough GIR (Actual), Approach >150 Rough GIR (Model),
Approach >150 Rough SG (Actual), Approach >150 Rough SG (Model),
Approach >150 Rough Prox (Actual), Approach >150 Rough Prox (Model),
Approach <200 FW GIR (Actual), Approach <200 FW GIR (Model),
Approach <200 FW SG (Actual), Approach <200 FW SG (Model),
Approach <200 FW Prox (Actual), Approach <200 FW Prox (Model),
Approach >200 FW GIR (Actual), Approach >200 FW GIR (Model),
Approach >200 FW SG (Actual), Approach >200 FW SG (Model),
Approach >200 FW Prox (Actual), Approach >200 FW Prox (Model)
```

### Signal contributions JSON (`<output-base>_signal_contributions.json`)

- Top-level keys: `runTimestamp`, `eventId`, `season`, `tournament`, `players` (array).
- Per-player fields: `dgId`, `playerName`, `rank`, `refinedWeightedScore`, `weightedScore`, `confidenceFactor`, `rampDampening`, `dataCoverage`, `shrinkageAlpha`, `deltaBonus`, `courseFitMultiplier`, `teeTimeMultiplier`, `groupScores` (object by group name), `approachDeltaRow`.

### Tournament results JSON (`<tournament-slug>_results.json`)

- Top-level keys: `generatedAt`, `tournament`, `eventId`, `season`, `source`, `eventName`, `courseName`, `lastUpdated`, `metricStats`, `zScores`, `results`, `resultsSheetCsv`, `apiSnapshots`.
- `results` rows match the results sheet columns (model vs actual), with a `Performance Analysis` field alongside the metric columns.

### Validation summary CSV (per-event rollup, `Season_Post_Event_Summary.csv`)

```text
Tournament, Slug, Event ID, Run Count, Seed Runs, Best Seed, Step3 Correlation, Step3 RMSE, Step3 MAE,
Step3 Top10, Step3 Top20, Step3 Top20 Weighted, KFold Correlation, Top20 Logistic Acc, Top20 CV Acc
```

### Calibration report CSV (`Calibration_Report.csv`)

**Current format:** report-style CSV with section headers. Example sections include:

```text
🎯 POST-TOURNAMENT CALIBRATION ANALYSIS

WINNER PREDICTION ACCURACY
Metric, Accuracy, Count
...
```

### Metric analysis CSV (`<tournament>_metric_analysis.csv`)

```text
event_id, tournament, season, metric_index, metric_name, group_name,
mean, stdDev, min, max, coverage_pct, spearman_with_finish, contribution_weight
```

### Template correlation summary CSV (`<TEMPLATE>_Correlation_Summary.csv`)

```text
template_key, course_type, event_id, tournament, season, spearman, rmse, mae,
top5_hit_rate, top10_hit_rate, top20_hit_rate, field_size, events_included
```

### Top-20 blend JSON (`<tournament>_top20_template_blend.json`)

- Top-level keys: `eventId`, `tournament`, `season`, `templateKey`, `blendedWeights` (object by group name), `top20HitRate`, `spearman`.

### Approach deltas JSON (`approach_deltas_<slug>_YYYY_MM_DD.json`)

- Top-level keys: `generatedAt`, `slug`, `eventId`, `season`, `period`, `players` (array).
- Per-player fields: `dg_id`, `player_name`, `deltaTrendScore`, `deltaPredictiveScore`, `deltaTrendBuckets` (object by distance bucket), `deltaPredictiveBuckets` (object by distance bucket), `snapshotDate`, `priorDate`.

### Early-season ramp JSON (`early_season_ramp_<metric>.json`)

- Top-level keys: `metric`, `apiYears`, `maxEvents`, `minEvents`, `baselineSeasons`, `generatedAt`, `rampByPlayerId`.
- Per-player fields (in `rampByPlayerId`): `dg_id`, `player_name`, `avgReturnToFormIndex`, `rampReadiness` (array by event index), `eventCount`, `seasons`.

### Course-history regression JSON (`course_history_regression.json`)

- Top-level keys: `eventId`, `season`, `courseNum`, `generatedAt`, `players` (array).
- Per-player fields: `dg_id`, `player_name`, `courseHistoryCount`, `decayedAvgScore`, `decayedSpearman`, `priorWeight`.

---

## Appendix D — Equations & scoring

### Weighted score

$$
\mathrm{Weighted\ Score} = \sum_{g} w_g \left( \sum_{m \in g} w_{m|g} \cdot z_m \right)
$$

### Z-score normalization (per metric)

$$
z_m = \frac{v_m - \mu_m}{\sigma_m}
$$

Where $v_m$ is the metric value (after transforms), $\mu_m$ and $\sigma_m$ are the field mean and standard deviation.

### Shrinkage adjustment (pulls toward field mean)

$$
v_m^{\mathrm{adj}} = \alpha \cdot v_m + (1 - \alpha) \cdot \mu_m
$$

$$
\alpha = \mathrm{clamp}(\mathrm{dataCoverage},\; \alpha_{\min},\; \alpha_{\max})
$$

Where $\alpha_{\min}$ = `MODEL_SHRINKAGE_MIN` (default 0.4), $\alpha_{\max}$ = `MODEL_SHRINKAGE_MAX` (default 1.0).

### Data coverage

$$
\mathrm{dataCoverage} = (1 - w_a) \cdot \mathrm{baseCoverage} + w_a \cdot \mathrm{approachCoverage}
$$

Where $w_a$ = `MODEL_APPROACH_COVERAGE_WEIGHT` (default 0.8), $\mathrm{baseCoverage}$ = fraction of historical metrics with non-zero values, $\mathrm{approachCoverage}$ = fraction of approach metrics with non-zero values.

### Coverage confidence factor

$$
f(c) = \begin{cases}
1.0 & c \geq 0.70 \\
\mathrm{floor} + (1 - \mathrm{floor}) \cdot c^{\exp} & c < 0.70
\end{cases}
$$

Where $\mathrm{floor}$ = `MODEL_CONFIDENCE_FLOOR` (default 0.2), $\exp$ = `MODEL_COVERAGE_EXP` (default 3.0). Hard upper clamps apply: $f(c) \leq 0.35$ when $c < 0.10$; $f(c) \leq 0.50$ when $c < 0.20$.

### Metric trend (exponential decay)

$$
\mathrm{trend}_m = \sum_{r=1}^{R} e^{-\lambda \cdot r} \cdot (v_{m,r} - \bar{v}_m)
$$

Where $\lambda = 0.20$, $r$ is the round index (most recent = 1), $R = 24$ rounds, and values are smoothed over a window of 3.

### Birdie Chances Created (BCC)

$$
\mathrm{BCC} = 0.35 \cdot z_{\mathrm{GIR}} + 0.35 \cdot z_{\mathrm{App}} + 0.15 \cdot z_{\mathrm{Prox}} + 0.10 \cdot z_{\mathrm{Putt}} + 0.05 \cdot z_{\mathrm{Anchor}}
$$

Where proximity is inverted ($z_{\mathrm{Prox}} = -z_{\mathrm{raw\_prox}}$) because lower proximity is better; $z_{\mathrm{Anchor}}$ uses Birdies or Better if available, otherwise Scoring Average (also inverted).

### Approach delta bonus

$$
\mathrm{deltaBonus} = \mathrm{clamp}(\mathrm{bucketBonus},\; -0.10,\; +0.10) + \mathrm{gatedBoost}
$$

Where $\mathrm{gatedBoost} = +0.05$ if both $\mathrm{deltaTrendScore} > 0$ and $\mathrm{deltaPredictiveScore} > 0$, otherwise $0$.

### Refined score (coverage + ramp)

$$
\mathrm{Refined\ Score} = \mathrm{Weighted\ Score} \times f(\mathrm{dataCoverage}) \times \mathrm{RampDampening}
$$

### Ramp dampening

$$
\mathrm{RampDampening} = \mathrm{clamp}\!\left(1 - w_r \cdot (1 - \mathrm{rampReadiness}),\; 0,\; 1\right)
$$

Where $w_r$ = `PAST_PERF_RAMP_WEIGHT`, $\mathrm{rampReadiness} \in [0, 1]$ is derived from the player's events-played-this-season relative to their historical return-to-form index. Dampening is removed ($\mathrm{RampDampening} = 1.0$) once the player has reached their return-to-form index.

### Course-fit multiplier (top-N method)

The top-5 highest-weighted metrics are evaluated. If 3+ of those metrics are below the field mean (z < 0) for the player, a poor-fit multiplier is applied:

$$
\mathrm{courseFitMultiplier} = \begin{cases}
\mathrm{poorMult} & \text{if strengths} < 2 \\
\mathrm{goodMult} & \text{if strengths} = 2 \text{ or } 3 \\
1.0 & \text{if strengths} \geq 4
\end{cases}
$$

Where $\mathrm{poorMult}$ = `MODEL_COURSE_FIT_POOR_MULT` (default 0.80), $\mathrm{goodMult}$ = `MODEL_COURSE_FIT_GOOD_MULT` (default 0.95).

### Tee-time bias adjustment

$$
\mathrm{teeTimeMultiplier} = 1 + \mathrm{bias} \cdot \mathrm{centered}
$$

Where $\mathrm{bias}$ = `MODEL_TEE_TIME_BIAS`, $\mathrm{centered} \in [-1, 1]$ is the player's tee-time percentile (early waves = negative, late waves = positive), and the shift is capped by `MODEL_TEE_TIME_MAX_SHIFT`.

### Weather wave penalty

$$
\mathrm{adjustedMetric}_i = \mathrm{metric}_i + \frac{\mathrm{totalPenalty}}{5}
$$

Applied to 5 slices: SG OTT, SG App, SG ARG, SG Putt, and approach bucket SG values. The total penalty is the sum of base wave penalties (R1/R2 AM/PM) plus hourly forecast penalty terms (wind, rain probability, convective risk, each with configurable thresholds and caps from `WEATHER_*` env vars).

### Weight blending (calibration)

$$
w_{\text{final}} = 0.6 \cdot w_{\text{prior}} + 0.4 \cdot w_{\text{suggested}}
$$

### Spearman correlation

$$
\rho_s = 1 - \frac{6 \sum_i (r_i - a_i)^2}{n(n^2 - 1)}
$$

Where $r_i$ = model rank of player $i$, $a_i$ = actual finish rank of player $i$, $n$ = field size.

### RMSE (model vs actual finish rank)

$$
\mathrm{RMSE} = \sqrt{\frac{1}{n} \sum_i (r_i - a_i)^2}
$$

### MAE (model vs actual finish rank)

$$
\mathrm{MAE} = \frac{1}{n} \sum_i |r_i - a_i|
$$

### Top-N hit rate

$$
\mathrm{TopN\_HitRate} = \frac{|\{i : r_i \leq N\} \cap \{i : a_i \leq N\}|}{N}
$$

---

## Appendix E — Helper scripts & utilities (optimizer)

### Helper scripts

- `scripts/analyze_course_history_impact.js` — Builds course-history regression outputs (CSV + JSON) and optional `utilities/courseHistoryRegression.js` helper. Insertion points: optional **pre-event analysis**; results are consumed by `core/modelCore.js` via `getCourseHistoryRegression()`.
- `scripts/analyze_early_season_ramp.js` — Computes early-season ramp trends from DataGolf historical rounds. Insertion points: optional **pre-event analysis** for ramp priors; outputs are referenced by ramp-aware scoring or analyst review.
- `scripts/summarizeSeedResults.js` — Summarizes seeded post-event runs and cleans up non-best seed artifacts. Insertion points: **post-event seed_runs** cleanup and reporting after `core/optimizer.js` writes seeded outputs.

### Utilities

- `utilities/logging.js` — Structured logging + run log setup. Insertion points: `core/optimizer.js` logging initialization and run context.
- `utilities/timeUtils.js` — Timestamp formatting and date parsing helpers. Insertion points: `core/optimizer.js` run timestamps + snapshot freshness; validation pipeline outputs and archives.
- `utilities/csvLoader.js` — CSV parsing helpers. Insertion points: `core/optimizer.js` inputs; validation sources; analysis scripts that read CSVs.
- `utilities/dataPrep.js` — Builds player data, parses historical rows, and normalizes positions/dates. Insertion points: `core/optimizer.js` player data assembly; `scripts/analyze_early_season_ramp.js` parsing helpers.
- `utilities/configParser.js` — Reads configuration sheet and shared config cells. Insertion points: `core/optimizer.js` config load; validation calibration + template alignment.
- `utilities/metricConfigBuilder.js` — Expands metric groups/weights from config. Insertion points: `core/optimizer.js` group/metric construction.
- `utilities/weightTemplates.js` — Template weights by course type/event. Insertion points: `core/optimizer.js` baseline weights; validation template reporting.
- `utilities/deltaPlayerScores.js` — Computes delta-based player scores for approach priors. Insertion points: `core/optimizer.js` approach delta enrichment.
- `utilities/approachDelta.js` — Loads approach snapshot data and computes deltas. Insertion points: `core/optimizer.js` approach delta generation; validation approach snapshot usage.
- `utilities/approachEventDelta.js` — Builds event-only approach rows and metric values. Insertion points: `core/optimizer.js` event-only approach modeling; validation event snapshot evaluation.
- `utilities/top20TemplateBlend.js` — Blends template weights with Top‑20 signals. Insertion points: `core/optimizer.js` pre-event weight blending; validation template alignment summaries.
- `utilities/kfoldTag.js` — Generates LOEO/KFOLD tag labels. Insertion points: `core/optimizer.js` seeded run labeling + output naming.
- `utilities/runSummaryLog.js` — Writes consolidated run summaries. Insertion points: `core/optimizer.js` pre/post run summary artifact.
- `utilities/tournamentResultsCsv.js` — Result formatting helpers for CSV outputs. Insertion points: `core/optimizer.js` post-event results; validation output formatting.
- `utilities/manifestUtils.js` — Manifest lookup, tournament resolution, snapshot pairing. Insertion points: `core/optimizer.js` event/tournament resolution + approach snapshot selection; validation season rollups.
- `utilities/dataGolfClient.js` — DataGolf API wrappers with caching. Insertion points: `core/optimizer.js` (rankings/approach/field/skills/history/live stats), validation approach/historical usage.
- `utilities/weatherClient.js` — Meteoblue weather lookups + cache. Insertion points: `core/optimizer.js` weather wave penalty computation.
- `utilities/buildRecentYears.js` — Helper for year window generation. Insertion points: `core/optimizer.js` historical year scope; `scripts/analyze_course_history_impact.js`.
- `utilities/collectRecords.js` — Aggregates historical rounds from API/cache/CSV. Insertion points: `core/optimizer.js` history assembly; `scripts/analyze_course_history_impact.js`.
- `utilities/extractHistoricalRows.js` — Normalizes DataGolf historical payload rows. Insertion points: `core/optimizer.js` and analysis scripts.
- `utilities/outputPaths.js` / `utilities/outputArtifacts.js` — Centralized artifact naming and output path resolution. Insertion points: `core/optimizer.js` + validation output paths; seed summary output naming.
- `utilities/courseHistoryRegression.js` — Optional regression lookup helper (generated by analysis script). Insertion points: `core/modelCore.js` course-history prior weights during scoring.
