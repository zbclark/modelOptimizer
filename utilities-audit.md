# Utilities & Scripts Audit — modelOptimizer

- **Reviewed:** 2026-03-09
- **Scope:** `utilities/` and `scripts/`

---

## Summary

| Severity | Count |
| -------- | ----- |
| 🔴 Critical (runtime crash) | 0 |
| 🟠 High (incorrect behavior / broken pass-through) | 0 |
| 🟡 Medium (maintenance / portability risk) | 0 |
| 🔵 Low (style / consistency) | 0 |

---

## Refactoring / Ordering Suggestions (non-blocking)

- Keep runtime CLI scripts in `scripts/` only and keep `utilities/` side‑effect‑free (import-safe).
- Align script naming with phase (`pre_event`, `post_event`, `formatting`, `maintenance`) to make run ordering clearer.
- Consolidate path conventions in docs and code around `data/` (no legacy `output/` references) for consistent onboarding.

## Open Review Items (2026-03-06)

- [x] Review and revise order of operations for pre/post runs; ensure scripts/utilities are categorized correctly.
- [x] Review the data lookup precedence (cache → API → CSV fallback or updated rule).
- [x] Review naming conventions for `approach_deltas` files to include year (future validation support).
- [ ] Review validation Step 4.1a to consider approach metrics for current year (and future years as data grows).
- [x] Review early season ramp to decide when it should be turned off.

**2026-03-09 review note (early season ramp):**

- Ramp no longer reduces the **past-performance regression weight**; it now **dampens the refined score** directly
  based on player ramp readiness, and it **turns off once the player reaches return-to-form** for the season.

**2026-03-09 review note (validation Step 4.1a approach metrics):**

- Validation runner now mirrors optimizer approach sourcing for event-only metrics:
  manifest-aligned **snapshot archives first**, **DataGolf API** fallback (cache-first), then **Approach CSVs**.
- Logs explicit **NOTE** lines when fallbacks are used or event-only approach metrics are unavailable so
  downstream metric analysis clearly reflects missing approach data.
- [ ] Investigate options to validate model metric calculations (not just weights).
- [x] Investigate tournament-slug sourcing/generation - look in manifest first to see if one exists for the eventId, if not fall back to creating a manifest entry with the --name provided in the correct formatt {tournament-slug}.
- [x] Review post-event folder auto-generation to review what folders need to present.
- [x] Review "optional" inputs to pre- and post- runs to determine what is actually optional v what is required.

**2026-03-09 review notes (items 1, 2, 6):**

- **Approach delta naming** already embeds the year in the date stamp:
  `approach_deltas_<tournament-slug>_YYYY_MM_DD.json`. Matching logic strips the date suffix and picks the newest timestamp.
  If explicit **season** is required (vs. calendar year), consider adding `season` to `meta` or extending the filename
  to include `season_<YYYY>`.
- **Optional vs. required inputs** (current behavior):
  - `--event` is required for all runs.
  - `--name` is required for **pre/post/results/validation** runs to resolve manifest placeholders.
  - `--name "all"` is reserved for **season validation** runs.
  - CSV inputs are **optional** (API/cache are primary). Missing CSVs log a warning and trigger API/cache fetches.
  - `course_context.json` is the **primary** configuration source; `Configuration Sheet` is a **fallback**.
  - If both are missing, the run fails with an explicit error.
  - `DATAGOLF_API_KEY` becomes **required** when cache is missing (e.g., pre runs validate prior-event history from API).
  - Validation outputs (weight templates + delta trends) are required **unless** `SKIP_VALIDATION_OUTPUTS=true` or `--results`.
  - Optional validation snapshots (decompositions/skill ratings) are gated by `DATAGOLF_FETCH_OPTIONAL` and post-only.
- **Order of operations** (high level):
  - Resolve manifest + tournament dirs → scaffold (unless results-only) → resolve inputs → infer mode (pre/post)
  - Pre: generate regression + ramp → load regression snapshot → config → load data → train & write pre outputs
  - Post: skip regression/ramp → load data → optimize & write post outputs → optional validation auto-run

---

## Post‑Tournament Top‑20 Blend Notes (2026-03-02)ok

**Context:** Post‑event optimizer runs were executed for:

- Genesis Invitational (eventId `7`)
- AT&T Pebble Beach Pro‑Am (eventId `5`)

Blend outputs were written to:

- `data/2026/validation_outputs/the-genesis-invitational_top20_template_blend.json`
- `data/2026/validation_outputs/atandt-pebble-beach-pro-am_top20_template_blend.json`

**2026-03-09 update:** Blend outputs now live under
`data/<season>/validation_outputs/top20_blend/` (see Output Path Refactor below).

The post‑event optimizer logs confirm both runs completed and produced the blend artifacts. Runs used API/cache fallbacks and **skipped approach snapshots** because `DATAGOLF_API_KEY` was not set.

**Problem observed:**

- In the blend JSONs, `suggestedMetrics` contained **all approach bucket metrics** (e.g., `Approach <100 SG`, `Approach <150 FW Prox`, etc.) with **weights of `0.0`**.
- These zeros are not meaningful signals; they occur because approach bucket data was **missing** in the post‑event run, so those metrics had no coverage.

**Why it matters:**

- The top‑20 blend output is consumed by the validation runner and also reviewed directly. A long list of zeros is misleading and makes it look like the model “ranked” those metrics when it actually lacked the data.

**Decision (conditional):**

- **Keep approach bucket metrics when weekly approach data is available** (post‑event API snapshot present). This is valuable because weekly approach performance vs pre‑event baselines *should* inform post‑tournament analysis.
- **Hide/omit approach bucket metrics when approach data is missing** to avoid misleading zero‑weight rows.

**Implementation (current state):**

- `utilities/top20TemplateBlend.js` was updated so `suggestedMetrics` is filtered to the metric label list used for Top‑20 analysis. This prevents excluded labels from showing up with zero weights.
- This change is **data‑driven**: if Top‑20 labels include approach buckets (because approach data is available), they will appear and contribute; if labels exclude them, they won’t appear.

**Open follow‑ups / next steps:**

- **Decide the final gating rule** for Top‑20 labels.
  Option A (current): approach buckets excluded unless explicitly included in the Top‑20 label list.
  Option B (preferred): dynamically include approach buckets **only if** approach data is present in the current run.
- **Re‑run post‑event optimizer for event 7 and event 5** after deciding the gating rule to regenerate the blend JSONs.
- **Verify regenerated blend JSONs** confirm:
  approach buckets are **present with non‑zero weights** *when* approach data exists,
  and **absent** when data is missing.

---

## New Files For Review (2026-02-25)

- `utilities/top20TemplateBlend.js` — wired into validation flow (post‑event blend output + template integration).
- `data/<season>/validation_outputs/<tournament-slug>_top20_template_blend.json` — per‑tournament blend output used by validation runner.
- `data/<season>/validation_outputs/Processing_Log.json` — validation runner inputs/outputs audit log.
- `data/<season>/validation_outputs/Model_Delta_Trends.json` / `.csv` — delta‑trend guardrails.
- `data/<season>/validation_outputs/Weight_Templates.json` / `.csv` — template recommendations.
- `data/<season>/validation_outputs/Weight_Calibration_Guide.json` — calibration notes for template selection.
- `data/<season>/validation_outputs/Course_Type_Classification.json` — course type mapping used by validation.
- `data/<season>/validation_outputs/metric_analysis/<tournament-slug>_metric_analysis.json` — per‑tournament metric deltas.
- `data/<season>/validation_outputs/template_correlation_summaries/<TEMPLATE>_Correlation_Summary.json` / `.csv` — template correlation summaries.

---

## Runtime Behavior Notes (current)

### Expected behavior under normal runs (API/cache order)

#### Pre‑tournament runs

- **Field updates:** API‑first (forced fresh pull)
- **Historical rounds:** cache‑first (stale cache acceptable; API fallback only if cache missing)
- **Approach snapshots:** YTD refresh only; L12/L24 not fetched
- **Verification feeds (rankings, skill ratings, decompositions):** API‑only (no cache/stale)

#### Post‑tournament runs

- **Field updates:** cache‑first (default TTL behavior)
- **Historical rounds:** API‑first (forced fresh pull)
- **Approach snapshots:** L12 only on end‑of‑season runs (via refresh event/season or forced); L24 never fetched; YTD not refreshed
- **Verification feeds (rankings, skill ratings, decompositions):** API‑only (no cache/stale)

### Open questions / follow-ups

- **Approach snapshot leakage flag:** `approachDelta.js` does not emit leakage flags yet; consider adding row-level annotations.
- **Course context portability:** treat `utilities/course_context.json` as a build artifact; document a generation step if needed.

---

## New TODOs (2026-03-02)

### P0 — Must-fix (protect baseline templates)

### P1 — Correctness (dry-run + validation integrity)

- [ ] **Dry-run output creation:** confirm dry-run template output is generated only when explicitly enabled (no baseline writes otherwise).
- [ ] **Template duplication guard:** ensure template upserts handle quoted keys and do not create duplicate course templates (e.g., `WAIALAE_COUNTRY_CLUB`).
- [ ] **Validation outputs integrity:** confirm POWER/TECHNICAL/BALANCED recommendations are populated (non-zero) when metric summaries exist; skip updates when summaries are empty.
- [x] **Shared output path utility:** adopt `outputPaths` resolver across optimizer + validation runner to centralize filenames/subdirs.

### P2 — Verification / audit

- [ ] **Re-run a dry-run validation** and confirm:
  - `utilities/weightTemplates.js` remains unchanged.
  - `dryrun_weightTemplates.js` contains only expected templates (no duplicates).
  - `Weight_Templates.json` contains non-zero template/recommended weights for POWER/TECHNICAL/BALANCED.

---

## Output Path Refactor (2026-03-09) — Implemented

### Scope

- Implemented shared output path resolution across optimizer + validation runner.
- Enforced file naming and routing for pre/post/validation outputs.

### Behavioral updates now enforced

- **Results-only runs** skip folder scaffolding.
- **Dryrun folders** are always created (`pre_event/dryrun` + `post_event/dryrun`).
- **Seed runs** folder is created only when a seeded post-event run is active.
- **Tournament results** always live under `post_event/` and use enforced filenames.
- **Pre-event analysis + regression** stay under `pre_event/analysis/` and
  `pre_event/course_history_regression/`.
- **Validation dryrun outputs** route to `post_event/dryrun` (not `validation_outputs`).
- **Top-20 blend outputs** move to `validation_outputs/top20_blend/`.
- **Pre-event summary log** now uses standardized `outputPaths` naming.
- **Seed summary output** now uses standardized `outputPaths` naming.

### Files touched (high level)

- `utilities/outputArtifacts.js` — added pre-event log artifact type
- `utilities/outputPaths.js` — added top20 blend subdir + regression root selection + pre-event log naming
- `core/optimizer.js` — wired path resolver + enforced filenames/scaffolding rules + pre-event log output path
- `core/validationRunner.js` — wired validation subdirs + top20 blend routing + legacy-aware blend reads
- `scripts/summarizeSeedResults.js` — seed summary output now uses outputPaths helpers

---

## Cleanup before next run (recommended deletes)

If you want a clean run with fresh artifacts, remove these paths before re-running:

- `data/2026/*/post_event/dryrun/`
- `data/2026/*/post_event/seed_runs/`
- `data/2026/*/post_event/archive/` (backup artifacts)
- `data/2026/*/post_event/*_results*.{json,txt,csv}` (prior outputs)
- `data/2026/*/pre_event/analysis/`
- `data/2026/*/pre_event/course_history_regression/`
- `data/2026/validation_outputs/*`
  - including `metric_analysis/` and `template_correlation_summaries/`

Optional (only if you want fresh API/cache pulls):

- `data/cache/*`
- `data/approach_snapshot/approach_ytd_latest.json`

---

## New Audit Entry (Farmers pre-event) -  Data Aggregation Behavior

This does not seem to be the right behavior for a tournament in the past.  the optimizer should look at the manifest to determine the evnt date and then count backwards for months to include for recentMonths

ℹ️  Tours used: pga
ℹ️  Event scope: 4 + similar (6) + putting (3)
ℹ️  Year scope: last6=[2026, 2025, 2024, 2023, 2022, 2021], recentMonths=[2026-3, 2026-2, 2026-1, 2025-12]
ℹ️  Skipped regression utility output (WRITE_TEMPLATES not enabled).

## New Audit Entry (2026-03-03) — Validation/Template Drift + Aggregation Consistency

### Reported issue (Farmers pre-event)

During post-event runs, values shown as **Recommended Weight** in validation artifacts (notably `Weight_Templates.csv/.json`) did not match corresponding weights in `utilities/weightTemplates.js` for some metrics.

Additionally, `Calibration_Report` was observed to be non-aggregated in single-tournament validation runs.

### Reproduction context (Farmers run)

- Command used:
  - `LOGGING_ENABLED=1 OPT_SEED=b EVENT_KFOLD_K=5 node core/optimizer.js --event 2 --season 2026 --tournament "American Express" --post --writeTemplates`
- Artifacts compared:
  - `data/2026/validation_outputs/Weight_Templates.csv`
  - `data/2026/validation_outputs/Weight_Templates.json`
  - `utilities/weightTemplates.js`
  - `data/2026/validation_outputs/Calibration_Report.json/.csv`

### Why drift can occur (current architecture)

1. **Different producer stages / timing**
   - `Weight_Templates.*` is emitted by `core/validationRunner.js` (`writeWeightTemplatesOutput`).
   - `utilities/weightTemplates.js` can be updated by optimizer template upserts in `core/optimizer.js` (event-specific and optional standard template updates) and also by validation-runner baseline updates depending on flags.

2. **Recommended weight transformation path differs by artifact**
   - Baseline recommended values originate from correlation-derived normalization (`buildRecommendedWeights`).
   - Validation output may then apply Top-20 blend overlays and re-normalization (`aggregateTop20BlendByType` + `blendTemplateMaps` + group/metric normalization).
   - Stored baseline templates represent the final upserted payload, not necessarily the same intermediate recommended vector displayed elsewhere.

3. **Write-gating / flags can produce mixed-state outputs**
   - Optimizer `--writeTemplates` can update event template and/or selected standard template based on gate checks.
   - Validation-runner baseline writeback requires its own write path/flags; if disabled, reports can reflect newly computed recommendations while file writes remain from prior state.

### Calibration aggregation status

- **Identified gap:** single-tournament `runValidation` previously wrote tournament-only calibration unless season scope was explicitly enabled.
- **Patch applied (2026-03-03):** calibration now attempts season aggregation in single-tournament runs and falls back to tournament-only if no season data is available.
- **Verification pending:** confirm `Calibration_Report.meta/tournament counts` reflect season aggregate in post-event single-tournament workflows.

### Impact

- Analysts may compare two artifacts that are valid for different stages and interpret this as a computation bug.
- Baseline template governance becomes harder when writeback and reporting are not clearly synchronized.

### Follow-up evaluation tasks (regression freshness)

- [ ] Add explicit `sourceStage` / `transformChain` metadata to `Weight_Templates.json` and `weightTemplates.js` write logs.
- [ ] Add a deterministic “final write payload” export in validation outputs (exact object written to baseline templates).
- [ ] Add an integrity check step after run completion:
  - compare validation-recommended (post-blend, post-normalization) vs baseline template weights for updated template type(s),
  - fail/warn when mismatch exceeds tolerance.
- [ ] Confirm `Calibration_Report` in single-tournament runs contains season-aggregated tournament counts when season data exists.
- [ ] Document required flag combinations for synchronized writeback (event template + baseline template + validation reports).

---

## New Audit Entry (2026-03-03) — Pre-Event Regression Freshness Not Applied in Same Run (Farmers)

### Reported issue

In a Farmers pre-event run, course-history regression inputs were generated successfully, but `pastPerformanceWeighting` still showed:

- `computedWeight: null`
- `regression: null`
- `source: "utility"`

This indicates the run did **not** consume the freshly generated regression map for weighting in that same execution.

### Reproduction context (observed)

- Command:
  - `LOGGING_ENABLED=1 node core/optimizer.js --event 4 --season 2026 --tournament "Farmers" --pre --apiYears 2021-2025`
- Log signals:
  - `🔄 Generating course history regression inputs...`
  - `✓ Course history regression inputs generated.`
  - later: `ℹ️  Course history regression loaded; no course_context updates needed.`
- Output signals:
  - `data/2026/farmers/pre_event/course_history_regression/course_history_regression.json` exists and includes course `"104"` with valid `slope/pValue`.
  - `data/2026/farmers/pre_event/farmers_pre_event_results.json` still reports `pastPerformanceWeighting.source = "utility"` and null computed regression fields.

### Likely root cause

The regression-generation step and regression-snapshot load are in the same run path, but snapshot resolution can still fall back to utility map (`utilities/courseHistoryRegression.js`) when the just-generated JSON is not selected/visible at load time.

In effect: **fresh regression artifact produced, but stale/utility source used for weighting in that pass**.

### Why this matters

- Past-performance weighting can silently use fallback config weight (e.g., `0.3`) even when event-specific regression was computed.
- This is difficult to spot unless one compares log lines, generated regression JSON, and final `pastPerformanceWeighting` block together.

### Clarification

The log line:

- `ℹ️  Skipped regression utility output (WRITE_TEMPLATES not enabled).`

refers to writing utility-style regression outputs, **not** to generation of `pre_event/course_history_regression/course_history_regression.json`.

### Follow-up evaluation tasks (recommended)

- [ ] After regression generation, force a deterministic reload from `PRE_TOURNAMENT_OUTPUT_DIR/course_history_regression.json` before computing `pastPerformanceComputedWeight`.
- [ ] Add an explicit run-time assertion/warning:
  - if generated regression file exists for current `courseNum` but `pastPerformanceWeighting.source !== "json"`, emit warning.
- [ ] Add `pastPerformanceWeighting.sourcePathUsed` and `courseNumResolved` to output for easier auditability.
- [ ] Add a small integration check for pre-event mode:
  - generate regression,
  - verify same run applies non-null computed weight when course regression entry exists.
