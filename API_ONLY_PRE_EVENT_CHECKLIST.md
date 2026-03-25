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

- [ ] Create event folder under `data/<season>/<tournament>/`.
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

---

## Running in the Background (Can I Close My Computer?)

Optimizer runs — especially multi-seed post-event runs — can take several minutes. If you want to close your terminal or step away **without killing the process**, use one of the following approaches.

### Option A: `nohup` (simplest — survives terminal close)

```bash
nohup node core/optimizer.js --event <EVENT_ID> --season <SEASON> --name "<TOURNAMENT_NAME>" --post --log \
  > logs/optimizer_run.log 2>&1 &
echo "Running as PID $!"
```

> `--post` forces post-event mode (use `--pre` for pre-event); `--log` enables verbose file logging in the run output directory.

- Output is written to `logs/optimizer_run.log` (create the `logs/` folder first if it doesn't exist).
- The process keeps running after you close your terminal.
- To follow along: `tail -f logs/optimizer_run.log`
- **Closing your computer (suspend/shutdown) will still stop the process.** Use a remote machine or tmux if you need the run to persist across a sleep/shutdown.

### Option B: `tmux` (survives terminal close; persists while the machine stays on)

**Start a named tmux session and run seeds inside it:**

```bash
# Create a detached session named after the event
tmux new-session -d -s <SESSION_NAME> \
  'for s in a b c d e; do
     echo "=== Seed $s ===";
     OPT_SEED="$s" node core/optimizer.js \
       --event <EVENT_ID> --season <SEASON> --name "<TOURNAMENT_NAME>" --post --log;
   done; echo "All seeds complete."; read'
```

Replace `<SESSION_NAME>`, `<EVENT_ID>`, `<SEASON>`, and `<TOURNAMENT_NAME>` with your values (e.g., `valspar_post_seeds`, `480`, `2026`, `"The Valspar Championship"`).

**Attach / detach:**

```bash
tmux attach -t <SESSION_NAME>   # re-attach to watch progress
# Press Ctrl+B then D to detach again (leaves run going)
```

**Kill the session when done:**

```bash
tmux kill-session -t <SESSION_NAME>
```

### Option C: Use `scripts/run_background.sh` helper

A convenience wrapper is available at `scripts/run_background.sh`:

```bash
bash scripts/run_background.sh \
  --event <EVENT_ID> \
  --season <SEASON> \
  --name "<TOURNAMENT_NAME>" \
  [--post] [--seeds a,b,c,d,e]
```

This wraps the run with `nohup`, writes output to `logs/`, and prints the PID for monitoring.
