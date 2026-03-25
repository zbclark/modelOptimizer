# OPTIMIZER_README

> **Project status (2026‑03‑25):** Pre-event pipeline produces a **tournament-specific ranked field** using blended historical performance, course context, approach-skill deltas, and optional ramp/weather adjustments. Post-event pipeline evaluates model predictions against results and writes season-level validation reports. Outputs are written to `data/<season>/<tournament>/pre_event/` and `post_event/`.
> **Note:** This document describes a *technical evaluation* workflow for ranking and post-event analysis. It is **not** betting advice.

---

## Future development (not implemented)

- **Course-history regression priors** fully integrated into scoring weights (currently optional, output-only from analysis script).
- **Weather integration** fully active end-to-end (infrastructure exists; activation requires `WEATHER_ENABLED=1` and a valid Meteoblue API key).
- **Automated field reconciliation** (auto-matching player IDs between DataGolf, configuration sheet, and approach-skill snapshot without manual overrides).
- **DraftKings DFS lineup integration** bridging optimizer scores to `run_dk_model_lineups.js` in a single pipeline call.
- **Live in-round adjustment** using live tournament stats mid-round (scaffolding exists in `dataGolfClient.js`; not yet connected to ranking output).

---

## Goal

Build **tournament-specific, out-of-sample player rankings** by blending weighted historical performance, course context, and approach-skill signals, and evaluate those rankings post-event to measure predictive accuracy. The goal is to answer: *does the model's score ordering correspond to actual tournament outcomes?*

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

### What would convince me

- **Consistent positive Spearman** ($\rho_s \geq 0.15$) across at least 10–15 events in a season.
- **Top-20 hit rate above 60%** for model top-10 picks across multiple course types.
- **Stable calibration** (Spearman + RMSE both trending in the right direction) across 2+ seasons.
- **Metric weight convergence**: `Weight_Calibration_Guide` suggested weights remaining stable across consecutive events of the same course type.

---

## Pipeline overview (optimizer)

In practice, you usually run **one of two entry points**:

1. **`core/optimizer.js`** — end-to-end pre/post workflow (load inputs, fetch DataGolf data, score players, write rankings, evaluate post-event, optionally run validation).
2. **`core/validationRunner.js`** — season-level rollups only (reads existing post-event artifacts; does not re-run scoring).

For **analysis workflows**, additional scripts are available:

- `scripts/analyze_course_history_impact.js` — builds course-history regression outputs for course-history prior weights.
- `scripts/analyze_early_season_ramp.js` — computes early-season ramp priors from DataGolf historical rounds.
- `scripts/summarizeSeedResults.js` — summarizes seeded post-event runs and cleans up non-best seed artifacts.

> **Refactor note:** Validation currently runs as an optional hook inside `optimizer.js` or standalone via `validationRunner.js`. **Future refactor goal:** make `optimizer.js` the single entry point for pre, post, and validation, with analysis scripts as optional extensions.

### Pre-event behavior

- Loads configuration sheet, historical data, and approach-skill CSV from `data/<season>/<tournament>/inputs/`.
- Fetches live DataGolf data (rankings, approach skill, field updates, decompositions, skill ratings) via API or cache.
- Scores players using weighted group z-scores, BCC, approach deltas, ramp dampening, and optional course-fit and weather adjustments.
- Writes pre-event rankings (CSV + JSON), signal contributions, and a run log to `data/<season>/<tournament>/pre_event/`.

### Post-event behavior

- Loads the same inputs plus actual tournament results.
- Evaluates predictions vs outcomes, computes Spearman / RMSE / MAE / top-N hit rates.
- Writes post-event results (CSV + JSON), tournament results files, and can run seeded optimization passes to `data/<season>/<tournament>/post_event/`.
- Post-event artifacts are the inputs for `validationRunner.js` season-level rollups.

### Validation-only and utility modes

- **Validation-only** (`--validation` flag or `validationRunner.js` directly): reads existing post-event artifacts; computes calibration, template correlation, and season summary reports.
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
|-----------|-----------|-------------|---------|
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

If weather integration is enabled (`WEATHER_ENABLED=1`), SG metrics and approach bucket metrics are adjusted by a tee-wave penalty derived from hourly forecast data (wind, rain probability, convective risk) and the player's R1/R2 tee wave assignment.

---

## Pre-event vs post-event behavior

See the **Pipeline overview** section above for the primary breakdown. Key distinctions:

- **Pre-event** (`--pre`): generates rankings only; results are not available. Outputs include `_pre_event_rankings.csv/json`, `_signal_contributions.json`, and `_pre_event_log.txt`.
- **Post-event** (`--post`): evaluates predictions against results. Outputs include `_post_event_results.csv/json`, tournament results files, and optionally seed_runs.
- **Validation** (`--validation`): season-level rollups; reads all post-event artifacts and writes calibration, template, and season-summary reports.
- **Delta** (`--delta`): approach delta processing only; writes `approach_deltas/` files.

---

## Outputs and storage layout

### Base folder layout

`data/` is the default root (legacy `output/` is only used for read compatibility).

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
  <season>/
    manifest.json
    <tournament-slug>/
      inputs/
      pre_event/
      post_event/
      pre_event/dryrun/
      post_event/seed_runs/
    validation_outputs/
      metric_analysis/
      template_correlation_summaries/
      top20_blend/
      season_summaries/
```

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
- `<tournament-slug>_results_zscores.csv`
- `<tournament-slug>_results_formatting.csv`
- `seed_runs/*` (seeded runs)
- `<output-base>_seed_summary.txt` (from `scripts/summarizeSeedResults.js`)

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
- Output root under `data/<season>/<tournament>/pre_event/`

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

### Validation rollup

```bash
node core/validationRunner.js
```

**Required flags:**

- none (uses available artifacts on disk)

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

- `--event <id>` / `--eventId <id>`
- `--season <year>` / `--year <year>`
- `--tournament "<name>"` / `--name "<name>"`
- `--template <key>`
- `--pre` / `--post`
- `--validation` / `--validationOnly` / `--runValidation`
- `--results` / `--resultsOnly`
- `--delta` / `--deltaOnly`
- `--tests <N>`
- `--seed <value>` (via `OPT_SEED` or explicit value)
- `--rollingDeltas <N>`
- `--approachDeltaCurrent <path>`
- `--approachDeltaPrevious <path>`
- `--approachDeltaIgnoreLag`
- `--includeCurrentEventRounds` / `--excludeCurrentEventRounds`
- `--forceFieldUpdates`
- `--dryRun`
- `--writeTemplates`
- `--writeValidationTemplates`
- `--log` / `--verbose`
- `--dir <subfolder>`
- `--dataDir <path>`
- `--outputDir <path>`
- `--apiYears <YYYY[,YYYY]>`

### `scripts/analyze_early_season_ramp.js`

- `--dir <subfolder>`
- `--dataDir <path>`
- `--outputDir <path>`
- `--metric finish|sg_total`
- `--maxEvents <N>`
- `--minEvents <N>`
- `--tours <tour1,tour2>`
- `--baselineSeasons <N>`
- `--apiYears <YYYY[-YYYY]>`
- `--apiTour <tour>`
- `--debugApi`

### `scripts/summarizeSeedResults.js`

- `--tournament "<name>"` / `--name "<name>"`
- `--event <id>` / `--eventId <id>`
- `--season <year>`
- `--dir <path>` / `--outputDir <path>`

## Environment variables

### Core optimizer controls

- `OPT_SEED`, `OPT_TESTS`, `LOGGING_ENABLED`
- `WRITE_TEMPLATES`, `WRITE_VALIDATION_TEMPLATES`
- `VALIDATION_APPROACH_MODE`
- `APPROACH_BLEND_WEIGHTS`, `APPROACH_GROUP_CAP`
- `APPROACH_DELTA_ROLLING_EVENTS`, `APPROACH_DELTA_MIN_DAYS`, `APPROACH_DELTA_SNAPSHOT_ONLY_EVENTS`
- `OPT_OBJECTIVE_CORR`, `OPT_OBJECTIVE_TOP20`, `OPT_OBJECTIVE_ALIGN`, `OPT_LOEO_PENALTY`, `OPT_LOEO_TOP_N`
- `PAST_PERF_RAMP_WEIGHT`

### DataGolf + cache controls

- `DATAGOLF_API_KEY`
- `DATAGOLF_RANKINGS_TTL_HOURS`, `DATAGOLF_APPROACH_TTL_HOURS`
- `DATAGOLF_FIELD_TTL_HOURS`, `DATAGOLF_SKILL_TTL_HOURS`, `DATAGOLF_DECOMP_TTL_HOURS`, `DATAGOLF_HISTORICAL_TTL_HOURS`
- `DATAGOLF_FIELD_TOUR`, `DATAGOLF_DECOMP_TOUR`, `DATAGOLF_HISTORICAL_TOUR`, `DATAGOLF_HISTORICAL_EVENT_ID`, `DATAGOLF_HISTORICAL_YEAR`

### Approach snapshot refresh

- `APPROACH_L12_REFRESH_MONTH`, `APPROACH_L12_FORCE_REFRESH`, `APPROACH_L12_REFRESH_SEASON`, `APPROACH_L12_REFRESH_EVENT_ID`
- `APPROACH_SNAPSHOT_RETENTION_YTD`

### Model scoring toggles

- `MODEL_GROUP_SCORE_Z`, `MODEL_BCC_PRESTANDARDIZED`
- `MODEL_SHRINKAGE`, `MODEL_SHRINKAGE_MIN`, `MODEL_SHRINKAGE_MAX`
- `MODEL_APPROACH_COVERAGE_WEIGHT`
- `MODEL_COURSE_FIT_METHOD`, `MODEL_COURSE_FIT_*`
- `MODEL_TEE_TIME_BIAS`, `MODEL_TEE_TIME_MAX_SHIFT`, `MODEL_TEE_TIME_MIN_PLAYERS`, `MODEL_TEE_TIME_EARLY_ADVANTAGE`

### Weather integration

- `WEATHER_ENABLED`, `WEATHER_API_KEY`, `WEATHER_TTL_HOURS`, `WEATHER_PACKAGE`, `WEATHER_FORECAST_DAYS`
- `WEATHER_WAVE_AM_START`, `WEATHER_WAVE_AM_END`, `WEATHER_WAVE_PM_START`, `WEATHER_WAVE_PM_END`
- `WEATHER_RAIN_PROB_*`, `WEATHER_RAIN_AMT_*`, `WEATHER_CONVECTIVE_*`, `WEATHER_WIND_*`, `WEATHER_PENALTY_CAP`
- `WEATHER_UPDATE_CONTEXT`

### Analysis script controls

- `PRE_TOURNAMENT_EVENT_ID`, `PRE_TOURNAMENT_SEASON`, `PRE_TOURNAMENT_OUTPUT_DIR`
- `COURSE_HISTORY_DECAY_LAMBDA`, `COURSE_HISTORY_DEBUG`
- `DATAGOLF_DEBUG`
- `SKIP_SEED_CLEANUP`

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
        dryrun/
      post_event/
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

### Post-event results CSV (`<output-base>_post_event_results.csv`)

```text
Performance Analysis, DG ID, Player Name, Model Rank, Finish Position, Score,
SG Total, SG Total - Model, Driving Distance, Driving Distance - Model,
Driving Accuracy, Driving Accuracy - Model, SG T2G, SG T2G - Model,
SG Approach, SG Approach - Model, SG Around Green, SG Around Green - Model,
SG OTT, SG OTT - Model, SG Putting, SG Putting - Model,
Greens in Regulation, Greens in Regulation - Model, Fairway Proximity, Fairway Proximity - Model,
Rough Proximity, Rough Proximity - Model, SG BS, Scoring Average, Scrambling, Great Shots, Poor Shot Avoidance
```

### Signal contributions JSON (`<output-base>_signal_contributions.json`)

- Top-level keys: `runTimestamp`, `eventId`, `season`, `tournament`, `players` (array).
- Per-player fields: `dgId`, `playerName`, `rank`, `refinedWeightedScore`, `weightedScore`, `confidenceFactor`, `rampDampening`, `dataCoverage`, `shrinkageAlpha`, `deltaBonus`, `courseFitMultiplier`, `teeTimeMultiplier`, `groupScores` (object by group name), `approachDeltaRow`.

### Tournament results CSV (`<tournament-slug>_results.csv`)

```text
event_id, season, tournament, dg_id, player_name, model_rank, finish_position,
sg_total, sg_putt, sg_arg, sg_app, sg_ott, sg_t2g, driving_dist, driving_acc,
gir, prox_fw, prox_rgh, scrambling, great_shots, poor_shots, scoring_avg,
birdies_or_better, fin_text
```

### Tournament results z-scores CSV (`<tournament-slug>_results_zscores.csv`)

Same columns as `_results.csv` but metric columns contain field-normalized z-scores rather than raw values.

### Validation summary CSV (per-event rollup, `Season_Post_Event_Summary.csv`)

```text
Season, Event ID, Tournament, Course Type, Template Used, Spearman, RMSE, MAE, Top 5, Top 10, Top 20, Top 50
```

### Calibration report CSV (`Calibration_Report.csv`)

```text
season, event_id, tournament, course_type, template_key, metric_group,
suggested_weight, current_weight, spearman_contribution, avg_z, coverage_pct
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
- `utilities/timeUtils.js` — Timestamp formatting and date parsing helpers. Insertion points: `core/optimizer.js` run timestamps + snapshot freshness; `core/validationRunner.js` outputs and archives.
- `utilities/csvLoader.js` — CSV parsing helpers. Insertion points: `core/optimizer.js` inputs; `core/validationRunner.js` validation sources; analysis scripts that read CSVs.
- `utilities/dataPrep.js` — Builds player data, parses historical rows, and normalizes positions/dates. Insertion points: `core/optimizer.js` player data assembly; `scripts/analyze_early_season_ramp.js` parsing helpers.
- `utilities/configParser.js` — Reads configuration sheet and shared config cells. Insertion points: `core/optimizer.js` config load; `core/validationRunner.js` calibration + template alignment.
- `utilities/metricConfigBuilder.js` — Expands metric groups/weights from config. Insertion points: `core/optimizer.js` group/metric construction.
- `utilities/weightTemplates.js` — Template weights by course type/event. Insertion points: `core/optimizer.js` baseline weights; `core/validationRunner.js` template reporting.
- `utilities/deltaPlayerScores.js` — Computes delta-based player scores for approach priors. Insertion points: `core/optimizer.js` approach delta enrichment.
- `utilities/approachDelta.js` — Loads approach snapshot data and computes deltas. Insertion points: `core/optimizer.js` approach delta generation; `core/validationRunner.js` approach snapshot usage.
- `utilities/approachEventDelta.js` — Builds event-only approach rows and metric values. Insertion points: `core/optimizer.js` event-only approach modeling; `core/validationRunner.js` event snapshot evaluation.
- `utilities/shotDistribution.js` — Applies shot-distribution adjustments to metric weights. Insertion points: `core/optimizer.js` pre-event weight tuning.
- `utilities/top20TemplateBlend.js` — Blends template weights with Top‑20 signals. Insertion points: `core/optimizer.js` pre-event weight blending; `core/validationRunner.js` template alignment summaries.
- `utilities/kfoldTag.js` — Generates LOEO/KFOLD tag labels. Insertion points: `core/optimizer.js` seeded run labeling + output naming.
- `utilities/runSummaryLog.js` — Writes consolidated run summaries. Insertion points: `core/optimizer.js` pre/post run summary artifact.
- `utilities/tournamentResultsCsv.js` — Result formatting helpers for CSV outputs. Insertion points: `core/optimizer.js` post-event results; `core/validationRunner.js` output formatting.
- `utilities/manifestUtils.js` — Manifest lookup, tournament resolution, snapshot pairing. Insertion points: `core/optimizer.js` event/tournament resolution + approach snapshot selection; `core/validationRunner.js` season rollups.
- `utilities/dataGolfClient.js` — DataGolf API wrappers with caching. Insertion points: `core/optimizer.js` (rankings/approach/field/skills/history/live stats), `core/validationRunner.js` (approach/historical).
- `utilities/weatherClient.js` — Meteoblue weather lookups + cache. Insertion points: `core/optimizer.js` weather wave penalty computation.
- `utilities/buildRecentYears.js` — Helper for year window generation. Insertion points: `core/optimizer.js` historical year scope; `scripts/analyze_course_history_impact.js`.
- `utilities/collectRecords.js` — Aggregates historical rounds from API/cache/CSV. Insertion points: `core/optimizer.js` history assembly; `scripts/analyze_course_history_impact.js`.
- `utilities/extractHistoricalRows.js` — Normalizes DataGolf historical payload rows. Insertion points: `core/optimizer.js` and analysis scripts.
- `utilities/outputPaths.js` / `utilities/outputArtifacts.js` — Centralized artifact naming and output path resolution. Insertion points: `core/optimizer.js` + `core/validationRunner.js` output paths; seed summary output naming.
- `utilities/courseHistoryRegression.js` — Optional regression lookup helper (generated by analysis script). Insertion points: `core/modelCore.js` course-history prior weights during scoring.
