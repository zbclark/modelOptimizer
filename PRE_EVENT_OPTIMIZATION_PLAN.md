# Pre-Event Historical Optimization Plan

## Purpose
Implement a **pre-event-optimized weighting path** that uses only information available **before** a tournament starts (historical results + pre-event snapshots) to generate weight candidates, validate them out-of-sample, and optionally upsert templates. This avoids the “post-event hindsight” bias in Step 3 while still leveraging the existing correlation and Top-20 signal framework.

This plan is intended for **post-refactor** implementation and should be tracked in the refactor roadmap.

---

## High-Level Goals
1. **Pre-event realistic optimization**: Run a weight search using only historical results and pre-event data as of each historical event.
2. **Out-of-sample scoring**: Validate candidate weights via LOEO / K-fold across historical events or years.
3. **Deterministic + reproducible**: Seeded optimization, fixed input snapshot resolution, stable outputs.
4. **Safe template gating**: Only write templates when the historical optimization materially improves over baseline and passes validation gates.

---

## Key Constraints
- **No current-event results** should be used in the optimization objective.
- **No post-event snapshots** for historical events (only snapshots at or before event start date).
- Use the same **metric config** and **group definitions** as the current pipeline.
- Must preserve existing `--pre` behavior unless explicitly enabled (new flag or mode).

---

## Proposed CLI / Env Interface
Add a **new mode** or **flag** to drive the pre-event optimization path without altering existing `--pre` defaults.

### Suggested options
- CLI: `--optimize-pre` (explicit)
- Env: `PRE_EVENT_OPTIMIZATION=1`
- Optional: `PRE_EVENT_OPT_SEED=<seed>` (deterministic)
- Optional: `PRE_EVENT_OPT_TESTS=<n>`
- Optional: `PRE_EVENT_OPT_OBJECTIVE="corr,top20,align"`

### Default behavior
- `--pre` **continues to run the current blending path**.
- `--pre --optimize-pre` triggers the new historical optimization branch.

---

## Data Sources (Pre-Event Realistic)
### Historical results
- Derived from `historyData` filtered by event ID and season.
- Used only from **past seasons** (exclude current season when running pre-event).

### Approach snapshots (pre-event)
- **For each historical event**, select the most recent snapshot **at or before** that event’s start date.
- Use `approach_snapshot` archives where available; fall back to L12/L24 if no aligned snapshot exists.

### Approach deltas
- Use **prior-event deltas** only (i.e., delta computed from events preceding the target event).
- Avoid post-event deltas for the same event under evaluation.

### Event data
- Field lists, course context, and manifest event dates should match the time of the event.
- Use `manifest.json` for event date alignment.

---

## Pipeline Differences (Current vs Pre-Event Optimized)
### Current `--pre`
- Computes Step 1c correlations
- Blends suggested weights with priors
- Generates rankings
- **No randomized optimization pass**

### Proposed `--pre --optimize-pre`
- Compute baseline template selection (Step 1d)
- Run **historical optimization** (new Step 3-pre)
- Validate candidates out-of-sample (LOEO / K-fold)
- Optional template update if passes gating

---

## Optimization Objective (Pre-Event)
Use a combined objective similar to Step 3 but evaluated on **historical folds**.

### Candidate scoring inputs
- Correlation (ranking vs actual results)
- Top-20 composite score
- Alignment score using Top-20 signal map

### Scoring aggregation
- For each candidate, compute scores **per fold**
- Aggregate weighted by sample count or field size
- Combine into objective (corr/top20/align weights)

---

## Fold Strategy Options

### Option A: Leave-One-Event-Out (LOEO)
- Train on all but one historical event (same event across years)
- Evaluate on the held-out event

### Option B: K-Fold (by event-year)
- Build event-year buckets
- Shuffle with deterministic seed
- Evaluate each fold

### Option C: Hybrid
- Use LOEO for event-specific optimization
- Use K-fold for course-type generalization

---

## Detailed Implementation Steps

### 1) Add a new optimization path in `core/optimizer.js`
**Location:** near the existing Step 3 logic.

- Add a new conditional block for pre-event optimization.
- Reuse the optimizer’s randomized candidate generator, but replace current-season evaluation with historical fold evaluation.

**Key changes:**
- Introduce `runHistoricalOptimization()` helper with:
  - Candidate generator (same as Step 3)
  - Fold evaluation
  - Combined objective
- Ensure candidate scoring uses **pre-event snapshot data** for each fold.

### 2) Build pre-event snapshot alignment utilities
**Create or extend** snapshot selection utilities:

- `utilities/approachSnapshots.js`
  - Add `selectPreEventSnapshotForDate(eventDate)`
  - Add `resolveApproachSnapshotForEvent(eventId, season, date)`

- `utilities/manifestUtils.js`
  - Ensure event dates are reliable for all seasons

### 3) Create “historical pre-event data resolver”
New helper to build per-event training context:

- `utilities/dataPrep.js`
  - Add `buildApproachRowsForEventPre(eventId, season, date)`
  - Add `buildFieldDataForEvent(eventId, season)`

- `utilities/approachDelta.js`
  - Add `resolvePriorEventDelta(eventId, season)`

### 4) Add historical fold evaluation helpers
New evaluation helpers to score candidates:

- `utilities/evaluationMetrics.js`
  - Add fold aggregation helpers (if not already present)

- `core/optimizer.js`
  - Add `runHistoricalFoldEvaluation()`

### 5) Add output artifacts for pre-event optimization
Add new output artifacts for reproducibility:

- `*_pre_event_opt_results.json`
- `*_pre_event_opt_results.txt`
- `*_pre_event_opt_rankings.json`

### 6) Template write gating
Use explicit gating rules to prevent drift:

- Candidate must exceed baseline by X% across folds
- Candidate must pass minimum Top-20 composite score
- Optional: require stability metrics (std dev across folds)

---

## Files to Update / Add

### Core
- `core/optimizer.js`
  - Add `--optimize-pre` branch
  - Add historical optimization loop
  - Add fold evaluation + output

### Utilities
- `utilities/approachSnapshots.js`
  - Add pre-event snapshot resolution
- `utilities/approachDelta.js`
  - Add prior-event delta resolver for historical folds
- `utilities/dataPrep.js`
  - Add pre-event approach rows builder for historical events
- `utilities/manifestUtils.js`
  - Ensure event date alignment for historical lookup
- `utilities/evaluationMetrics.js`
  - Add fold aggregation + stability metrics (if missing)
- `utilities/outputArtifacts.js` (or equivalent)
  - Add new artifact types

### Scripts
- `scripts/verify_phase_outputs.py`
  - Add comparisons for pre-event optimization artifacts
- `scripts/summarizeSeedResults.js`
  - Extend to include pre-event optimization outputs

### New optional helper modules
- `utilities/preEventOptimization.js` (new)
  - Encapsulate pre-event optimization flow

### Documentation
- `OPTIMIZER_README.md`
  - Add `--optimize-pre` description and examples
- `REFACTOR_PHASE_CHECKLIST.md`
  - Add Phase item for pre-event optimization

---

## Output / Logging Requirements
- Log resolved snapshot per fold (eventId, date, snapshot file)
- Log approach delta source per fold
- Log fold scores, aggregate scores, and objective components
- Write a “candidate leaderboard” (top N) to JSON for debugging

---

## Pre/Post Ranking Comparison Artifact (New Requirement)

### Goal

Create a **pair of pre/post ranking outputs** where the **only difference is the starting weights**, so we can quantify how much the optimization changes rankings when all other inputs are held constant. This produces a realistic, year-over-year improvement estimate without hindsight leakage.

### Key Principles

- **Same data inputs** (rounds, approach snapshots, deltas, weather adjustments, field) for both runs.
- **Only weights differ**:
  - Baseline run: template / blended weights
  - Optimized run: optimized weights (from pre-event optimization or from post-event results, depending on mode)
- Use a **consistent snapshot alignment policy** (pre-event snapshots only for realism).

### Proposed Outputs

- `${slug}_pre_event_rankings_baseline.json`
- `${slug}_pre_event_rankings_optimized.json`
- `${slug}_pre_event_rankings_comparison.json`
- `${slug}_pre_event_rankings_comparison.txt`

### Comparison Metrics to Include

- Rank deltas (absolute + signed)
- Top-10 / Top-20 overlap
- Kendall tau / Spearman rank correlation
- Avg rank shift and max shift
- Highlighted movers (top + bottom 10 by delta)

### Implementation Notes

- Add a comparison runner that:
  1. Builds **one shared player dataset**
  2. Runs rankings twice with different weights
  3. Outputs both rankings + a diff summary

### Files Likely Affected

- `core/optimizer.js`
  - Add a comparison path (or hook into `--optimize-pre` run)
- `utilities/outputArtifacts.js`
  - Add new artifact types for baseline/optimized comparison
- `utilities/evaluationMetrics.js`
  - Add rank-diff metrics (Kendall/Spearman if not already present)
- `scripts/verify_phase_outputs.py`
  - Add verification hooks for comparison outputs
- `OPTIMIZER_README.md`
  - Document comparison mode + example usage

---

## Test / Validation Plan

### Minimal validation

- Run pre-event optimization for a known event with 3–5 historical years
- Confirm output artifacts are created
- Confirm snapshot selection is pre-event only

### Regression guard

- Compare baseline vs optimized across LOEO/K-fold
- Ensure no use of current event results in pre-event mode

### Consistency checks

- Rerun with same seed → identical outputs
- Rerun with different seed → candidate differences but similar aggregate scores

---

## Risks & Mitigations

### Risk: Snapshot alignment gaps

- **Mitigation**: fallback to L12/L24 snapshots when no pre-event archive is available

### Risk: Overfitting to historical years

- **Mitigation**: enforce minimum fold count and stability thresholds

### Risk: Longer run times

- **Mitigation**: cap candidates; allow `PRE_EVENT_OPT_TESTS` override

---

## Suggested Next Steps After Merge

1. Add `--optimize-pre` scaffolding with no behavior change.
2. Implement snapshot alignment helpers.
3. Implement historical fold evaluation loop.
4. Add output artifacts + verification script support.
5. Validate on one historical event (e.g., The PLAYERS).

---

## Summary

This plan creates a clean **pre‑event‑realistic optimization path** that avoids hindsight bias while still leveraging the existing weighting pipeline. It requires new snapshot alignment and historical fold evaluation, plus careful output gating. Once implemented, it will provide a more trustworthy path for improving templates going into the next season.

