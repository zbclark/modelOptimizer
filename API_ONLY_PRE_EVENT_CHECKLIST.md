# API-Only Pre-Event Run Checklist

Use this checklist when **no CSV inputs are available** (no config sheet, historical data, approach skills, or field sheets) and the run must rely on **DataGolf API** + cache.

> Target: Node-based optimizer pre-event run using API-only inputs.

---

## 1) Event Context (course_context.json)

- [ ] Confirm `eventId` exists in `utilities/course_context.json`.
- [ ] Confirm `courseNameKey`, `courseNum`, and `templateKey` are set.
- [ ] Confirm `courseType` is set (POWER / BALANCED / TECHNICAL).
- [ ] Confirm `pastPerformance` is true/false (set explicitly).
- [ ] Validate or set `similarCourseIds`.
- [ ] Validate or set `puttingCourseIds`.
- [ ] Set `similarCoursesWeight` and `puttingCoursesWeight` (if unset).
- [ ] Fill `shotDistribution` (under100 / 100-150 / 150-200 / over200) if unknown.
- [ ] If `sourcePath` is null (API-only), keep it null.

## 2) Environment (.env)

- [ ] `DATAGOLF_API_KEY` present and valid (required for API-only run).
- [ ] `DATAGOLF_*_TTL_HOURS` values acceptable (default 8760 is fine).
- [ ] Optional: set `DATAGOLF_*_TOUR` overrides if needed (default `pga`).
- [ ] Optional: set `DATAGOLF_HISTORICAL_YEAR` or `DATAGOLF_HISTORICAL_EVENT_ID` if scoping is required.
- [ ] Optional: set `APPROACH_DELTA_ROLLING_EVENTS` (default 4; set to 0 to disable rolling prior).
- [ ] Optional: set `APPROACH_DELTA_PRIOR_WEIGHT` if you want a stronger/weaker delta prior.
- [ ] Optional: set `OUTPUT_TAG` for disambiguating output filenames.

## 3) Cache Readiness

- [ ] `data/cache/` exists and is writable.
- [ ] `data/approach_snapshot/` exists (for L24/L12/YTD snapshot caching).
- [ ] `data/approach_deltas/` exists (for generated approach delta priors).
- [ ] If running for the first time, allow API to populate cache.
- [ ] If running offline, ensure cache is already primed.

## 4) Output Folders

- [ ] Create event folder under `apps-scripts/modelOptimizer/data/<season>/<tournament>/`.
- [ ] Create `inputs/` subfolder (even if empty, for structure consistency).
- [ ] Confirm output directory for run results is:
  - `data/<season>/<tournament>/pre_event/` (pre-event), or
  - `data/<season>/<tournament>/post_event/` (post-event)
- [ ] Know the output base name: derived from `--tournament` (lowercased, spaces → underscores).

## 5) Run Mode Decisions

- [ ] **Pre-event** mode (no `--post`).
- [ ] Choose whether to include **approach skills** (API):
  - [ ] Include approach (default if API available).
  - [ ] Disable approach (set `VALIDATION_APPROACH_MODE=none` or run flag if available).
- [ ] Decide seed / tests (e.g., `OPT_SEED`, `OPT_TESTS`).
- [ ] Decide whether to write templates (`--writeTemplates`) or dry-run only.

## 6) Expected Outputs (Pre-event)

- [ ] `data/<season>/<tournament>/pre_event/<output-base>_pre_event_results.json`
- [ ] `data/<season>/<tournament>/pre_event/<output-base>_pre_event_results.txt`
- [ ] `data/<season>/<tournament>/pre_event/<output-base>_pre_event_rankings.json`
- [ ] `data/<season>/<tournament>/pre_event/<output-base>_pre_event_rankings.csv`
- [ ] Optional: dry-run template outputs (if enabled)
  - [ ] `data/<season>/<tournament>/pre_event/dryrun/dryrun_weightTemplates.js`
  - [ ] `data/<season>/<tournament>/pre_event/dryrun/dryrun_deltaPlayerScores.node.js`

---

## Notes

- If **course context is incomplete**, fill missing fields before running.
- If **approach skills are unavailable**, consider disabling approach to avoid partial blends.
- If **similar/putting lists are unknown**, start with a conservative default and revise after first validation pass.
