# Refactor Phase Checklist

Use this as a sprint‑by‑sprint checklist to ensure each phase is scoped, validated, and safe for the wagering pipeline.

---

## Phase 1 — Baseline & Safety Nets (All pipelines)

### Scope (Phase 1)

- Capture smoke commands + expected outputs for:
  - Optimizer pre‑event
  - Optimizer results‑only/post‑event
  - Validation rollup
  - Wagering pipeline

### Checklist (Phase 1)

- [x] Document smoke commands (pre, results‑only, validation, wagering)
- [x] Record expected output locations + filenames
- [x] Record key log lines used to confirm success

### Smoke commands (Phase 1-5 examples)

### OUTPUT_TAG guidance

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

### Phase 6 validation orchestration (updated calls)

> These replace the old validation-runner call; validation is now orchestrated by `optimizer.js`.

```bash
# Post-event run (auto-runs tournament + season validation)
OPT_TESTS=200 OUTPUT_TAG=phase6-2026-03-27-post-players node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --post

# Validation-only (tournament scoped)
OUTPUT_TAG=phase6-2026-03-27-validation-single node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --validation

# Validation-only (season rollup)
OUTPUT_TAG=phase6-2026-03-27-validation-all node core/optimizer.js --season 2026 --name "all" --validation

# Seeded post runs (run at least 2 seeds; validation should be skipped if outputs already exist)
OPT_SEED=seed-a OUTPUT_TAG=phase6-2026-03-27-post-seed-a node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --post --validation
OPT_SEED=seed-b OUTPUT_TAG=phase6-2026-03-27-post-seed-b node core/optimizer.js --event 11 --season 2026 --tournament "The PLAYERS" --post
```

### Expected outputs (Phase 1)

- [x] Optimizer pre‑event: `data/<season>/<tournament>/pre_event/`
  - `<output-base>_pre_event_rankings.csv`
  - `<output-base>_pre_event_rankings.json`
  - `<output-base>_signal_contributions.json`
  - `<output-base>_pre_event_log.txt`
- [x] Optimizer results‑only: `data/<season>/<tournament>/post_event/`
  - `<output-base>_post_event_results.json`
  - `<tournament-slug>_results.csv`
  - `<tournament-slug>_results.json`
- [x] Validation outputs: `data/<season>/validation_outputs/`
  - `Calibration_Report.{json,csv}` *(report-style CSV with section headers, not a flat table)*
  - `Weight_Templates.{json,csv}`
  - `season_summaries/Season_Post_Event_Summary.{json,csv,md}` *(current schema: Tournament, Slug, Event ID, Run Count, Seed Runs, Best Seed, Step3 Correlation, Step3 RMSE, Step3 MAE, Step3 Top10, Step3 Top20, Step3 Top20 Weighted, KFold Correlation, Top20 Logistic Acc, Top20 CV Acc)*
- [x] Wagering pipeline:
  - `data/wagering/<tournament_slug>/inputs.{json,csv}`
  - `data/wagering/<tournament_slug>/results.{json,csv}`
  - `data/wagering/betting-card.csv`

### Key log cues (Phase 1)

- Optimizer: "MODEL OPTIMIZER" banner and mode line (pre/post)
- Validation: "Running validation" and validation output path
- Wagering: "run_wagering_pipeline" start + summary file writes

### Pass criteria (Phase 1)

- All runs complete without errors
- Output file counts and schemas unchanged

---

## Phase 2 — Utility Extraction (Shared runtime)

### Scope (Phase 2)

- Centralize JSON I/O, env parsing, and CLI parsing helpers.

### Checklist (Phase 2)

- [x] `utilities/fileUtils.js` created and used by optimizer/validation module/dataGolfClient
- [x] `utilities/envParser.js` created and used by optimizer env parsing (no behavior change)
- [x] `utilities/argParser.js` created and used for a **small, non‑breaking** subset of flags

### Pass criteria (Phase 2)

- All baseline smoke runs pass
- No schema changes

---

## Phase 3 — Run‑Mode Orchestration (Optimizer flow)

### Scope (Phase 3)

- Introduce `RunMode` + `RunContext` to centralize pre/post/results/validation logic.

### Checklist (Phase 3)

- [x] Add `RunMode` enum + `RunContext` builder
- [x] Replace scattered `RUN_*` / `FORCE_*` checks with `runContext` flags
- [x] Confirm run‑mode decisions are logged once, clearly

### Verification notes (Phase 3)

- [x] Compare run‑mode decisions between Phase 1 and Phase 2 logs (pre/post)

### Pass criteria (Phase 3)

- Baseline smoke runs pass
- Run mode decisions are identical to baseline

---

## Phase 4 — Phase Extraction (Optimizer structure)

### Scope (Phase 4)

- Split `runAdaptiveOptimizer()` into pure, named phases.
- Keep logic order identical to current flow; no behavior changes.
- Each phase should be a small, named function that accepts an explicit input object and returns explicit outputs (no hidden globals).
- Avoid moving side‑effects until `writeOutputs()`.

### Planned phases (Phase 4)

- `resolveInputsAndDirs()` — parse args/env, resolve season/event/tournament, build paths + output base
- `loadConfigAndTemplates()` — load model config, metric templates, and any cached inputs
- `prepareSnapshots()` — build/resolve snapshots, historical data, and context needed for rankings
- `buildRankings()` — compute pre/post rankings, deltas, and any core scoring outputs
- `evaluateResults()` — generate results summaries/metrics without writing files
- `writeOutputs()` — all file writes (csv/json/logs) in one place

### Checklist mapping (Phase 4)

- Each checklist item maps 1:1 to the phase function above
- Checklist completion means: phase function exists, is called in order, and passes inputs/outputs explicitly
- No new side‑effects outside `writeOutputs()`

### Refactor plan (Phase 4)

### Draft function signatures (Phase 4)

```js
function resolveInputsAndDirs({ argv, env, runContext }) {}

function loadConfigAndTemplates({ inputs, runContext }) {}

function prepareSnapshots({ inputs, config, runContext }) {}

function buildRankings({ inputs, config, snapshots, runContext }) {}

function evaluateResults({ inputs, config, snapshots, rankings, runContext }) {}

function writeOutputs({ inputs, config, snapshots, rankings, results, runContext }) {}
```

- **1) Inventory current flow** — Annotate the current `runAdaptiveOptimizer()` flow with inline comments marking the six planned phases (no code movement yet).
- **2) Define phase data shapes** — Create a light `phaseContext` object in `runAdaptiveOptimizer()` containing inputs (args/env/runContext) and a `paths` object; define explicit return objects for each phase (e.g., `inputs`, `config`, `snapshots`, `rankings`, `results`).
- **3) Extract `resolveInputsAndDirs()`** — Move CLI/env parsing and output path resolution into this function; return `{ args, runContext, outputPaths, outputBase, tournamentMeta }`.
- **4) Extract `loadConfigAndTemplates()`** — Move config/template loading into a pure function; return `{ config, metricTemplates, weights, overrides }` as applicable.
- **5) Extract `prepareSnapshots()`** — Consolidate snapshot resolution, historical data loading, and context shaping; return `{ snapshots, historicalRows, courseContext, weatherContext }` (or current equivalents).
- **6) Extract `buildRankings()`** — Move pre/post ranking computations and deltas into a pure function; return `{ rankings, contributions, deltas, intermediateArtifacts }`.
- **7) Extract `evaluateResults()`** — Build results summaries, metrics, and validation payloads without writing files; return `{ resultsSummary, metricStats, zScores, resultsCsv }`.
- **8) Extract `writeOutputs()`** — Centralize all file writes (csv/json/logs) and keep output names/paths identical; ensure any logging side‑effects remain here.
- **9) Wire functions in order** — Call phase functions in the exact current order, passing explicit inputs/outputs.
- **10) Verify with smoke runs** — Run baseline smoke commands and compare outputs/schemas (no diffs expected).

### Checklist (Phase 4)

- [x] `resolveInputsAndDirs()`
- [x] `loadConfigAndTemplates()`
- [x] `prepareSnapshots()`
- [x] `buildRankings()`
- [x] `evaluateResults()`
- [x] `writeOutputs()`

### Verification notes (Phase 4)

- Smoke runs completed (2026-03-27):
  - Pre-event: `OUTPUT_TAG=phase4-2026-03-27-pre-players`
  - Post-event: `OUTPUT_TAG=phase4-2026-03-27-post-players` (OPT_TESTS=200)
  - Results-only: `OUTPUT_TAG=phase4-2026-03-27-results` (OPT_TESTS=200)
  - Validation rollup: `OUTPUT_TAG=phase4-2026-03-27-validation-all node core/optimizer.js --season 2026 --name "all" --validation`
  - Validation-only: `OUTPUT_TAG=phase4-2026-03-27-validation-single` (OPT_TESTS=200)
  - Wagering: `OUTPUT_TAG=phase4-2026-03-27-wager-live`
- Output parity verified with `scripts/verify_phase_outputs.py --season 2026 --tournament-slug the-players --check-run-modes --compare-phase1` (strict tags + case-by-case post-event CSV validation).

### Pass criteria (Phase 4)

- Baseline smoke runs pass
- No output changes

---

## Phase 5 — Output & Artifact Manager (Optimizer + validation)

### Scope (Phase 5)

- Centralize artifact path construction + writes.

### Checklist (Phase 5)

- [x] `OutputArtifactManager` introduced
- [x] Replace inline path logic in optimizer
- [x] Replace inline path logic in validation module

### Verification notes (Phase 5)

- Smoke runs completed (2026-03-27):
  - Pre-event: `OUTPUT_TAG=phase5-2026-03-27-pre-players`
  - Post-event: `OUTPUT_TAG=phase5-2026-03-27-post-players` (OPT_TESTS=200)
  - Results-only: `OUTPUT_TAG=phase5-2026-03-27-results`
  - Validation rollup: `OUTPUT_TAG=phase5-2026-03-27-validation-all node core/optimizer.js --season 2026 --name "all" --validation`
  - Validation-only: `OUTPUT_TAG=phase5-2026-03-27-validation-single`
  - Wagering: `OUTPUT_TAG=phase5-2026-03-27-wager-live`
- Output parity verified with `scripts/verify_phase_outputs.py --season 2026 --tournament-slug the-players --check-run-modes --compare-phase5`.

### Pass criteria (Phase 5)

- Baseline smoke runs pass
- Output paths unchanged

---

## Phase 6 — Validation Orchestration (optimizer)

### Scope (Phase 6)

- Make validation a utility invoked by `optimizer.js` post runs.
- Default gate: skip validation if outputs already exist for the tournament.
- `--validation` overrides the gate (forces regeneration).
- Keep validation-only mode available without running optimizer.

### Checklist (Phase 6)

- [x] Auto-run validation on `--post`
- [x] Run tournament + season rollup when a tournament name is provided
- [x] Seed gating: skip validation if outputs already exist for the tournament
- [x] Preserve validation-only mode (`--validation`)

### Verification notes (Phase 6)

- Smoke runs completed (2026-03-27):
  - Pre-event: `OUTPUT_TAG=phase6-2026-03-27-pre-players`
  - Post-event: `OUTPUT_TAG=phase6-2026-03-27-post-players` (OPT_TESTS=200)
  - Validation-only (tournament): `OUTPUT_TAG=phase6-2026-03-27-validation-single`
  - Validation-only (season rollup): `OUTPUT_TAG=phase6-2026-03-27-validation-all`
  - Seeded post: `OUTPUT_TAG=phase6-2026-03-27-post-seed-a` (OPT_SEED=seed-a, OPT_TESTS=200)
  - Seeded post + validation: `OUTPUT_TAG=phase6-2026-03-27-post-seed-b` (OPT_SEED=seed-b, OPT_TESTS=200, --validation)
- Output parity verified with `scripts/verify_phase_outputs.py --season 2026 --tournament-slug the-players --check-run-modes --compare-phase6`.

### Pass criteria (Phase 6)

- Post runs produce validation artifacts once per tournament, unless --validation (gate override) is given
- Seed runs do not re-run validation when artifacts already exist unless override flag is given

---

## Phase 7 — Validation Separation (validation module)

### Scope (Phase 7)

- Split compute vs formatting without changing schemas.

### Checklist (Phase 7)

- [x] Create `validationCore` (compute)
- [x] Create `validationOutputs` (format/write)
- [x] Keep existing CSV/JSON schemas intact

### Remaining work (Phase 7)

- [x] Finalize output refactor: consolidate any remaining file writes inside `validationOutputs`.
- [ ] Verify all output schemas remain identical after the final write separation.

### Pass criteria (Phase 7)

- Validation‑only run matches baseline outputs

---

## Phase 8 — Follow‑ups (Optional)

### Scope (Phase 8)

- Address larger coupling areas after core refactor is stable.
- Review logs to clean up any duplicative logging
- Review `DEFAULT_BALANCED_GROUP_WEIGHTS` in `validationCourseType.js`
- Review `METRIC_ANALYSIS_DIR_NAME` - its greyed out
- Review shared utilities to determine what else may be able to be generalized for use in both `optimizer.js` and the validation pipeline

### Checklist (Phase 8)

- [ ] `SnapshotResolver` for approach snapshots
- [ ] `WeatherContext` service
- [ ] `MetricRegistry` for shared metric metadata
- [ ] Naming convention alignment across flags and overrides
- [ ] Normalize optimizer CLI args (required vs optional; pre/post/validation-only)

### Pass criteria (Phase 8)

- All baseline smoke runs pass
- Wagering pipeline outputs unchanged
