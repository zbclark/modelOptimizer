# OPTIMIZER_README

> This document is derived from the current Node.js implementation in `core/optimizer.js`, `core/modelCore.js`, `core/validationRunner.js`, and supporting scripts/utilities. It describes a technical evaluation workflow for ranking optimization. It is **not** betting advice.

## What this repo does

The optimizer builds **tournament-specific rankings** and **post-event evaluations** by blending historical performance, course context, and approach-skill deltas. It can also generate season-level validation reports and supporting analysis artifacts (early-season ramp, course-history regression, seed summaries).

## Entry points

### Main pipeline

- `core/optimizer.js` — end-to-end pre/post workflow with ranking generation, evaluation, and optional validation hooks.
- `core/validationRunner.js` — season-level rollups and validation artifacts (metric analysis, template summaries, calibration reports).

### Analysis scripts

- `scripts/analyze_course_history_impact.js` — builds course-history regression outputs and (optionally) a Node helper for course-history priors.
- `scripts/analyze_early_season_ramp.js` — computes early-season performance ramps from DataGolf historical rounds.
- `scripts/summarizeSeedResults.js` — summarizes seeded post-event runs and optionally cleans up non-best seed artifacts.

## Inputs and data sources

### Tournament inputs (CSV)

The optimizer consumes tournament CSVs from `data/<season>/<tournament>/inputs/`:

- `* - Configuration Sheet.csv`
- `* - Historical Data.csv`
- `* - Approach Skill.csv`

These are loaded through utilities like `utilities/csvLoader.js`, `utilities/configParser.js`, and `utilities/dataPrep.js`.

### Course context

Course metadata comes from `utilities/course_context.json`, keyed by event ID. The optimizer reads fields such as:

- `templateKey`, `courseType`
- `courseNum`/`courseNums`
- `similarCourseIds`, `puttingCourseIds`
- `similarCourseCourseNums`, `puttingCourseCourseNums`
- `courseSetupWeights`, `shotDistribution`
- `location*` and `timezone` (weather integration)

### DataGolf API + cache

The optimizer and analysis scripts can pull DataGolf data (and cache it under `data/cache/`), including:

- rankings
- approach skill
- field updates
- player decompositions
- skill ratings
- historical rounds
- live tournament stats

TTL settings are controlled by `DATAGOLF_*_TTL_HOURS` environment variables.

### Approach snapshots and deltas

Approach snapshots live under `data/approach_snapshot/` (`approach_l24.json`, `approach_l12.json`, `approach_ytd_latest.json`, plus archives). Approach deltas are written to `data/approach_deltas/` and can be reloaded for subsequent runs.

## How the optimizer scores players

The core scoring logic is in `core/modelCore.js`:

- **Historical averages** are computed with recency decay and optional blending of similar-course and putting-course rounds.
- **Approach metrics** are derived from approach-skill snapshots (per-shot values normalized to per-round values).
- **Birdie Chances Created (BCC)** is computed from approach, proximity, and putting components, then inserted into the metric array.
- **Metric trends** are computed from historical rounds and applied to the scoring inputs.
- **Group scores** are computed via z-scores (optionally standardized at the group level), then aggregated into weighted scores.
- **Data coverage & shrinkage** optionally pull metric values toward field means when coverage is low.
- **Weather wave penalties** can adjust SG metrics based on forecast-driven wave penalties.
- **Tee-time bias** can adjust scores by early/late tee time percentiles.
- **Course-fit multipliers** can dampen/boost scores based on key metric fit (top-N or weighted method).

## Pre-event vs post-event behavior

### Pre-event

Pre-event runs focus on ranking generation when results are not available. Outputs include pre-event rankings, a results summary, and signal contribution artifacts.

### Post-event

Post-event runs evaluate predictions against results, generate tournament results files, and can run seeded optimization passes. Post-event outputs are also used by `core/validationRunner.js` to build season-level reports.

### Validation-only and utility modes

- **Validation-only** runs can be triggered via `--validation` flags (or by running `core/validationRunner.js` directly).
- **Results-only** runs are supported via `--results` flags (post-event mode forced).
- **Delta-only** runs are supported via `--delta` flags (approach delta processing only).

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

## Notes on naming

- `outputBaseName` is derived from the tournament slug/name and optional seed tag (see `utilities/outputPaths.js`).
- Tournament results files use the slugified tournament name (e.g., `<tournament-slug>_results.csv`).
- Legacy `output/` paths are read for backwards compatibility but new outputs default to `data/`.

---

## Appendix Index

- **Appendix A** — Data sources & API references
- **Appendix B** — Storage layout & naming conventions
- **Appendix C** — File schemas (reference)
- **Appendix D** — Equations & scoring
- **Appendix E** — Helper scripts & utilities

## Appendix A — Data sources & API references

### DataGolf endpoints (used by optimizer)

- **Rankings**
  - `https://feeds.datagolf.com/preds/get-dg-rankings?file_format=json&key=...`
  - Used for baseline rankings and model priors.

- **Approach skill**
  - `https://feeds.datagolf.com/preds/approach-skill?period=[l24|l12|ytd]&file_format=[json|csv]&key=...`
  - Used for approach snapshot generation and deltas.

- **Field updates**
  - `https://feeds.datagolf.com/field-updates?tour=[tour]&file_format=[json|csv]&key=...`
  - Used to resolve event field, course name, and timing context.

- **Player decompositions**
  - `https://feeds.datagolf.com/preds/player-decompositions?tour=[tour]&file_format=[json|csv]&key=...`
  - Used for player component breakdowns.

- **Skill ratings**
  - `https://feeds.datagolf.com/preds/skill-ratings?display=[value|rank]&file_format=[json|csv]&key=...`
  - Used for skill-rating inputs when available.

- **Historical rounds**
  - `https://feeds.datagolf.com/historical-raw-data/rounds?tour=[tour]&event_id=[event_id|all]&year=[year]&file_format=[json|csv]&key=...`
  - Used for historical round statistics and validation.

- **Live tournament stats**
  - `https://feeds.datagolf.com/preds/live-tournament-stats?stats=[csv]&round=[event_avg|r1|r2|r3|r4]&display=[value|rank]&file_format=[json|csv]&key=...`
  - Used for live stats when available.

### Weather (Meteoblue)

- **Location lookup**
  - `https://www.meteoblue.com/en/server/search/query3?query=...&apikey=...`
- **Forecast**
  - `https://my.meteoblue.com/packages/[package]?lat=...&lon=...&format=json&timeformat=...&tz=...&windspeed=...&precipitationamount=...&temperature=...&forecast_days=...&apikey=...`

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

### Pre-event rankings CSV

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

### Post-event results CSV

```text
Performance Analysis, DG ID, Player Name, Model Rank, Finish Position, Score,
SG Total, SG Total - Model, Driving Distance, Driving Distance - Model,
Driving Accuracy, Driving Accuracy - Model, SG T2G, SG T2G - Model,
SG Approach, SG Approach - Model, SG Around Green, SG Around Green - Model,
SG OTT, SG OTT - Model, SG Putting, SG Putting - Model,
Greens in Regulation, Greens in Regulation - Model, Fairway Proximity, Fairway Proximity - Model,
Rough Proximity, Rough Proximity - Model, SG BS, Scoring Average, Scrambling, Great Shots, Poor Shot Avoidance
```

### Validation summary CSV (per-event rollup)

```text
Season, Event ID, Tournament, Course Type, Template Used, Spearman, RMSE, MAE, Top 5, Top 10, Top 20, Top 50
```

---

## Appendix D — Equations & scoring

### Weighted score

$$
\mathrm{Weighted\ Score} = \sum_{g} w_g \left( \sum_{m \in g} w_{m|g} \cdot z_m \right)
$$

### Refined score (coverage + ramp)

$$
\mathrm{Refined\ Score} = \mathrm{Weighted\ Score} \times \mathrm{Coverage\ Confidence} \times \mathrm{Ramp\ Dampening}
$$

### Weight blending

$$
w_{\text{final}} = 0.6 \cdot w_{\text{prior}} + 0.4 \cdot w_{\text{suggested}}
$$

### Spearman correlation

$$
\rho_s = 1 - \frac{6 \sum_i (r_i - a_i)^2}{n(n^2 - 1)}
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
