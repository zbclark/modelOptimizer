# Utilities & Scripts Audit — modelOptimizer

- **Reviewed:** 2026-02-25
- **Scope:** `apps-scripts/modelOptimizer/utilities/` and `apps-scripts/modelOptimizer/scripts/`

---

## Summary

| Severity | Count |
| -------- | ----- |
| 🔴 Critical (runtime crash) | 0 |
| 🟠 High (incorrect behavior / broken pass-through) | 0 |
| 🟡 Medium (maintenance / portability risk) | 0 |
| 🔵 Low (style / consistency) | 2 |

---

## Priority Order (tracking)

Use this checklist to track what to fix first as we work through the audit.

### P0 — Must-fix (hard crash / blocks runs)

- [x] **#1** `scripts/generate_delta_player_scores.js` — remove legacy target; generate Node-only delta scores file
- [x] **#2** `scripts/parity_modelcore.js` — fix import path for `metricConfigBuilder` (MODULE_NOT_FOUND)

### P1 — Correctness (quietly wrong behavior / destructive side effects)

- [x] **#5** `utilities/metricConfigBuilder.js` — rough-approach weights mapped to dedicated cells
- [x] **#7** `scripts/analyze_early_season_ramp.js` — unified on shared historical-row extractor
- [x] **#6** `scripts/summarizeSeedResults.js` — moved out of `utilities/` (self-exec + deletes files)
- [x] **#4** `utilities/collectRecords.js` — canonical same-folder import path

### P2 — Portability + parity drift risk

- [x] **#12** `utilities/deltaPlayerScores.js` — generator always emits and verifies `module.exports`
- [x] **#8 / #15** `utilities/course_context.json` + `scripts/build_course_context.js` — removed machine-absolute `sourcePath`; treat as metadata only
- [x] **#10** `utilities/logging.js` — added teardown/restore for overridden stdio streams
- [x] **#9** `utilities/courseHistoryRegression.js` — regression map no longer stale; loads JSON artifact when available

### P3 — Polish / developer experience

- [x] **#13** `scripts/analyze_course_history_impact.js` — remove/guard DEBUG logs
- [x] **#14** `scripts/compare_parity_outputs.js` — remove hardcoded tournament defaults (require explicit paths)
- [x] **#16** `utilities/configParser.js` — blank cell fallback to `0` hides missing config

### New files for review (not blocking)

- [x] `utilities/top20TemplateBlend.js` — wired into validation flow (preserves direction + renormalizes after clamping)
- [x] `data/<season>/validation_outputs/<tournament-slug>_top20_template_blend.json` — per‑tournament blend artifact consumed by validation runner

---

## Pending Review / Diagnostics

- [x] **Review optimizer pre_event results and rankings for some identified, but unconfirmed issues.**
  - "I want to ensure that the data is being processed correctly because I am seeing some 0s in the calculated metrics in the rankings sheet."
  - Add a review/diagnostics step to confirm whether those zeros are data gaps or a processing bug.

---

## Post‑Tournament Top‑20 Blend Notes (2026-03-02)

**Context:** Post‑event optimizer runs were executed for:

- Genesis Invitational (eventId `7`)
- AT&T Pebble Beach Pro‑Am (eventId `5`)

Blend outputs were written to:

- `data/2026/validation_outputs/the-genesis-invitational_top20_template_blend.json`
- `data/2026/validation_outputs/atandt-pebble-beach-pro-am_top20_template_blend.json`

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

## 🔴 Critical Issues (will crash at runtime)

### 1. `scripts/generate_delta_player_scores.js` — Undefined legacy target variable

**Status:** ✅ Resolved (Node-only output)

**Problem:** The script referenced an undefined legacy target in `targets`, causing a `ReferenceError` at runtime.

**Fix:** Remove the legacy target and write only the Node target (`apps-scripts/modelOptimizer/utilities/deltaPlayerScores.js`).

---

### 2. `scripts/parity_modelcore.js` — Broken import path for `metricConfigBuilder`

**Status:** ✅ Resolved

- **Line:** 7
- **Code:** `const { buildMetricGroupsFromConfig } = require('../core/metricConfigBuilder');`
- **Problem:** `metricConfigBuilder.js` lives in `utilities/`, not `core/`. There is no `metricConfigBuilder.js` in `core/`. This causes a `MODULE_NOT_FOUND` error at startup. The correct path is used in `core/optimizer.js` (line 23): `require('../utilities/metricConfigBuilder')`.
- **Expected fix:**

```js
const { buildMetricGroupsFromConfig } = require('../utilities/metricConfigBuilder');
```

> **Note:** The same incorrect `'../core/metricConfigBuilder'` path appears in several ARCHIVE files (`hybridWeightOptimizer.js`, `weightIterator.js`, `exportPowerRankingSheetLike.js`, `configurationTester.js`, `hybridGridSearchOptimizer.js`, `tournamentAnalyzer.js`), but those are in the ARCHIVE folder and not active.

---

## ✅ Resolved Since Last Review

### 3. `scripts/compute_approach_deltas.js` — Removed

This script was removed from the repo (approach delta generation now lives in the optimizer flow). The runtime error for `resolvedPrevPath` no longer applies.

---

## 🟠 High Issues (incorrect behavior or broken pass-throughs)

### 4. `utilities/collectRecords.js` — Incorrect relative import path

**Status:** ✅ Resolved

- **Line:** 4
- **Code:** `const { loadCsv } = require('../utilities/csvLoader');`
- **Problem:** `collectRecords.js` is itself in `utilities/`. The `'../utilities/csvLoader'` path resolves to `modelOptimizer/utilities/csvLoader` only if Node resolves the parent correctly — in practice it walks up one level then back into `utilities/`, which happens to be correct on most Node.js setups. However, the canonical and correct relative path should be `'./csvLoader'` since both files are in the same directory. The current path is fragile if the file is ever relocated and creates confusion about module structure.
- **Expected fix:**

```js
const { loadCsv } = require('./csvLoader');
```

---

### 5. `utilities/metricConfigBuilder.js` — Duplicate cell references for rough approach metrics

**Status:** ✅ Resolved

- **Lines:** 28–38
- **Problem:** Six rough-approach metric weights incorrectly read from the same spreadsheet cells as their fairway counterparts:

| Metric key | Cell read | Should read |
| --- | --- | --- |
| `app150roughGIR` | G18 (same as `app150fwGIR`) | J18 |
| `app150roughSG` | H18 (same as `app150fwSG`) | K18 |
| `app150roughProx` | I18 (same as `app150fwProx`) | L18 |
| `app200roughGIR` | G19 (same as `app200GIR`) | J19 |
| `app200roughSG` | H19 (same as `app200SG`) | K19 |
| `app200roughProx` | I19 (same as `app200Prox`) | L19 |

Additionally, `scoring_app150roughSG` now reads L23 and `scoring_app150roughSG_alt` reads M23 (independent from fairway scoring weights).

**Impact:** Rough and fairway weights for 150–200 yard approach shots are always identical, preventing independent tuning of these two groups. Any optimizer run that discovers optimal weights for rough vs. fairway at this distance range cannot be encoded back into the config.
**Resolution needed:** Confirm correct cell assignments with the configuration sheet layout and update cell references for rough metrics to their dedicated rows/columns.

---

### 6. `utilities/summarizeSeedResults.js` — Script behavior in `utilities/` folder

**Status:** ✅ Resolved

**Problem:** This file is a fully self-executing CLI script (parses `process.argv`, calls `process.exit`, reads and **deletes** files). It belongs in `scripts/` alongside other runnable scripts, but lives in `utilities/`. Any tool or loader that auto-imports all files from `utilities/` as modules (e.g., a future module bundler or test runner) would execute destructive file deletions upon import.

**Impact:** Misclassified file location; side-effect risk on import.
**Resolution:** Moved to `scripts/summarizeSeedResults.js` and updated docs.

---

### 7. `scripts/analyze_early_season_ramp.js` — Local reimplementation of shared utility diverges from `utilities/extractHistoricalRows.js`

**Status:** ✅ Resolved

- **Lines:** 132–182
- **Problem:** The script contains its own local copy of `extractHistoricalRowsFromSnapshotPayload` that handles the `scores` array structure of a single-event payload differently from the shared version in `utilities/extractHistoricalRows.js`. Key differences:

- The local version checks `payload.scores` first (single-event path) and expands round sub-objects inline.
- The shared version's top-level branch is a flat pass-through (`if (Array.isArray(payload)) return payload`); it handles the multi-event nested object structure differently.

When `getDataGolfHistoricalRounds` returns a single-event-shaped JSON (with a top-level `scores` array), the two implementations return different row shapes, which could produce divergent metric or ranking results.

**Resolution:** `analyze_early_season_ramp.js` now imports the shared extractor. The shared extractor was extended to correctly expand single-event payloads with top-level `payload.scores`.

---

## 🟡 Medium Issues (portability / maintenance risk)

### 8. `utilities/course_context.json` — Hardcoded machine-specific absolute paths in `sourcePath`

**Status:** ✅ Resolved (paths stripped; Node runs are API-first)

**Problem:** Every event entry contains a `sourcePath` field with an absolute path anchored to `/workspaces/GoogleAppScripts/...` — the original development codespace. Example (note: `modelOptemizer` is the misspelled legacy directory name as it appears in the actual JSON):

```json
"sourcePath": "/workspaces/GoogleAppScripts/apps-scripts/modelOptemizer/data/..."
```

These paths will be wrong on any other machine, container, or CI runner. Code that uses `sourcePath` to re-read configuration data will silently fail or error.

**Resolution:** Stripped all machine-absolute paths from `utilities/course_context.json` (set `sourcePath: null` where present) and made `sourceDir` repo-relative. The optimizer treats `sourcePath` as metadata unless explicitly enabled.

---

### 9. `utilities/courseHistoryRegression.js` — Mostly zeroed regression data

**Status:** ✅ Resolved (staleness fixed; data still often near-zero)

**Problem:** The committed `utilities/courseHistoryRegression.js` map was effectively stale and could drift from the per-run regression artifacts written by `scripts/analyze_course_history_impact.js` (for example, the Genesis regression JSON includes a strong negative slope for course `"500"`, but the embedded utility map did not).

**Impact:** When the embedded map is stale, model runs can use incorrect past-performance weighting even if up-to-date regression artifacts exist on disk.

**Resolution:** The regression utility now supports loading an on-disk `course_history_regression.json` via `COURSE_HISTORY_REGRESSION_JSON` or `PRE_TOURNAMENT_OUTPUT_DIR`, with the embedded map as a fallback. This removes staleness and ensures the optimizer/model can use the most recent regression artifacts when present.

---

### 10. `utilities/logging.js` — No cleanup / restore for overridden stdio streams

**Status:** ✅ Resolved

- **Lines:** 17–26
- **Problem:** `setupLogging` replaced `process.stdout.write` and `process.stderr.write` with no restore path. This can leak overridden stdio into later phases of a long-running process (or subsequent runs in the same Node process), and makes failure-handling more brittle.

**Resolution:** `setupLogging()` now returns a handle with `teardown()` that restores the original stdio writers, and `utilities/logging.js` also exposes `teardownLogging()` for global cleanup. The optimizer wires an exit hook so teardown happens even on early exits.

---

### 12. `utilities/deltaPlayerScores.js` — Exports only `DELTA_PLAYER_SCORES` data; no loader function

**Status:** ✅ Resolved
**Problem:** The `utilities/deltaPlayerScores.js` Node file includes `module.exports` with `DELTA_PLAYER_SCORES`, `getDeltaPlayerScoresForEvent`, and `getDeltaPlayerScores`. However, `parity_modelcore.js` imports only `getDeltaPlayerScoresForEvent` (line 9), which works. But `generate_delta_player_scores.js` generates this file with the full function set only when `includeModuleExports = true`, which is gated on whether `filePath === nodeTarget`. If the target logic or `DRY_RUN` mode produces the wrong suffix, the generated file may lack `module.exports`, breaking all downstream consumers.

**Resolution:** The generator now always emits `module.exports` for the Node-only workflow and (by default) verifies the generated file can be `require()`’d and exposes the expected exports. `--no-verify` can disable the verification step if needed.

---

## 🔵 Low Issues (style / consistency)

### 13. `scripts/analyze_course_history_impact.js` — Debug `console.log` left in production path

- **Line:** 629
- **Code:** `console.log(`DEBUG: courseNum ${courseNum} has ${entries.length} entries`);`
- **Problem:** A prefixed `DEBUG:` log statement was left in the main `run()` function and will appear in all output logs. A similar pattern appears at line 637: `console.log(`DEBUG: No regression computed...`)`.

**Status:** ✅ Resolved

**Resolution:** Debug logs are now guarded behind an explicit debug flag and no longer appear in normal runs.
Enable by setting `COURSE_HISTORY_DEBUG=true` (or `DATAGOLF_DEBUG=true`).

---

### 14. `scripts/compare_parity_outputs.js` — Hardcoded tournament-specific default paths

**Status:** ✅ Resolved (defaults removed; explicit paths required)

**Problem (previous behavior):** Defaults were hardcoded to a specific 2026 Genesis Invitational output under the legacy `output/` folder.

**Resolution (current behavior):** The script now requires explicit `--node` and legacy-output paths (no tournament-specific defaults). This prevents accidental comparisons against stale or irrelevant artifacts.

---

### 15. `scripts/build_course_context.js` — Output `sourcePath` captures machine-absolute paths

**Status:** ✅ Resolved (defaults to `sourcePath: null`; opt-in flag available)

- **Lines:** 62–74
- **Problem:** When building `course_context.json`, the `sourcePath` field is written as the absolute filesystem path of the config CSV at build time. This creates a portability problem (see Issue #8 above). The `build_course_context.js` script itself is correct in logic, but should normalize the path to be repo-relative or strip it entirely.

**Resolution:** Default `sourcePath` to `null` for portability; optionally include a repo-relative `sourcePath` via `--includeSourcePath` or `INCLUDE_COURSE_CONTEXT_SOURCEPATH=1`.

```js
const repoRoot = path.resolve(__dirname, '..', '..', '..');
entry.sourcePath = path.relative(repoRoot, filePath);
```

---

### 16. `utilities/configParser.js` — `cleanNumber` fallback silently returns `0` for unset cells

- **Lines:** 4–9
- **Code:** `const cleanNumber = (value, fallback = 0) => { ... return Number.isFinite(parsed) ? parsed : fallback; }`
- **Problem:** Unpopulated or blank cells in the configuration sheet return `0` silently. For weight fields (e.g., `pastPerformanceWeight`), a weight of `0` is valid and indistinguishable from an unset/missing cell. This makes debugging weight configuration errors harder.

**Status:** ✅ Resolved (warnings added; default behavior unchanged)

**Resolution:** `cleanNumber` now supports env-gated warnings when a numeric cell is blank/invalid and the parser falls back to a default value.
Enable with `CONFIG_PARSER_WARN_BLANKS=true`.

**Note:** We intentionally did *not* change the default fallback behavior (still returns `0` by default) to avoid changing model outputs unexpectedly.

---

## File-by-File Reference

### `core/modelOptimizer.js`

### `core/modelCore.js`

### `utilities/`

| File | Status | Notes |
| --- | --- | --- |
| `approachDelta.js` | ✅ OK | Well-structured; exports `loadApproachCsv`, `computeApproachDeltas`, `METRIC_DEFS` |
| `buildRecentYears.js` | ✅ OK | Simple utility; no issues |
| `collectRecords.js` | ✅ OK | Canonical same-folder import path (`./csvLoader`) |
| `configParser.js` | ✅ OK | Optional warnings for blank/invalid numeric cells (see `CONFIG_PARSER_WARN_BLANKS`) |
| `courseHistoryRegression.js` | ✅ OK | Loads regression JSON artifact when configured; embedded map remains fallback |
| `course_context.json` | ✅ OK | `sourcePath` stripped (metadata-only); API-first runs |
| `csvLoader.js` | ✅ OK | Robust CSV loader with header auto-detection |
| `dataGolfClient.js` | ✅ OK | Retry + cache logic is clean; exports all needed API functions |
| `dataPrep.js` | ✅ OK | Imports `cleanMetricValue` from `core/modelCore` correctly |
| `deltaPlayerScores.js` | ✅ OK | Generated file; generator always emits + verifies expected exports |
| `extractHistoricalRows.js` | ✅ OK | Handles most payload shapes; used as shared utility |
| `logging.js` | ✅ OK | Restores overridden stdio via `teardown()` / `teardownLogging()`; best-effort exit hook |
| `metricConfigBuilder.js` | ✅ OK | Rough approach weights mapped to dedicated cells; imports from `core/modelCore` correctly |
| `tournamentConfig.js` | ✅ OK | Stub/utility; clean pass-through helpers |
| `weightTemplates.js` | ✅ OK | Template definitions used by Node optimizer (legacy parity no longer tracked) |
| `rankingFormattingSchema.js` | ✅ OK | Formatting schema for Player Ranking Model sheet |
| `top20TemplateBlend.js` | ✅ OK | Wired into validation flow; preserves direction + renormalizes after clamping |

### `scripts/`

| File | Status | Notes |
| --- | --- | --- |
| `analyze_course_history_impact.js` | 🔵 See #13 | Debug `console.log` left in production path; API‑only fresh pulls |
| `analyze_early_season_ramp.js` | ✅ OK | Uses shared `extractHistoricalRowsFromSnapshotPayload` (Issue #7 resolved); API‑only (requires `--apiYears`) |
| `build_course_context.js` | ✅ OK | Defaults `sourcePath` to null; optional repo-relative output |
| `compare_parity_outputs.js` | ✅ OK | Requires explicit `--node` and legacy-output paths; defaults removed |
| `summarizeSeedResults.js` | ✅ OK | CLI seed summary tool; moved out of `utilities/` (Issue #6 resolved) |
| `compute_approach_deltas.js` | ✅ Removed | Script removed; approach deltas now generated in optimizer flow |
| `generate_delta_player_scores.js` | ✅ OK | Node-only output; removed legacy target (Issue #1 resolved) |
| `parity_modelcore.js` | ✅ OK | Fixed import path for `metricConfigBuilder` (Issue #2 resolved) |
| `update_readme_last_updated.js` | ✅ OK | Simple date-stamp utility; no issues |
| `generate_ranking_formatting_output.js` | ✅ OK | Generates JSON/CSV formatting schema outputs |

---

## Migration Readiness Notes

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

1. **API → CSV fallback ordering**: ✅ Unified. Both `analyze_course_history_impact.js` and `analyze_early_season_ramp.js` now use API‑only fresh pulls (no CSV/cache fallback).
2. **Top‑20 blend integration**: ✅ Validation runner now consumes `<slug>_top20_template_blend.json` from `validation_outputs`, uses it for course‑type alignment, and emits derived templates. Tournament templates blend 50/50 with legacy recommendations; baseline POWER/TECHNICAL/BALANCED recommendations are blended using the 20/30/50/70 schedule (by count), weighted by alignment strength.
3. **Multi‑year approach usage**: ✅ Validation now uses YTD only for current season, L12 only for prior year, L24 only for older years (no cross‑fallbacks).

---

## Unanswered Questions / Follow-ups

1. **Approach snapshot leakage flag** (open task in `MODEL_VALIDATION_STATUS.md`): `approachDelta.js` does not currently emit any leakage flag on its rows. There is still no row-level leakage annotation in the delta outputs.
2. **Course context portability**: `course_context.json` cannot be committed and reused across machines without regeneration. Consider adding `build_course_context.js` to pre-run scripts or a Makefile target, and documenting that `course_context.json` is a build artifact.

---

## New TODOs (2026-03-02)

### P0 — Must-fix (protect baseline templates)

- [x] **Revert `utilities/weightTemplates.js` to last committed version.**
  - This file must never change without explicit template-write flags.

### P1 — Correctness (dry-run + validation integrity)

- [ ] **Dry-run output creation:** confirm dry-run template output is generated only when explicitly enabled (no baseline writes otherwise).
- [ ] **Template duplication guard:** ensure template upserts handle quoted keys and do not create duplicate course templates (e.g., `WAIALAE_COUNTRY_CLUB`).
- [ ] **Validation outputs integrity:** confirm POWER/TECHNICAL/BALANCED recommendations are populated (non-zero) when metric summaries exist; skip updates when summaries are empty.

### P2 — Verification / audit

- [ ] **Re-run a dry-run validation** and confirm:
  - `utilities/weightTemplates.js` remains unchanged.
  - `dryrun_weightTemplates.js` contains only expected templates (no duplicates).
  - `Weight_Templates.json` contains non-zero template/recommended weights for POWER/TECHNICAL/BALANCED.

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
