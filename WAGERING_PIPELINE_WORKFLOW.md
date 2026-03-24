# WAGERING_PIPELINE_WORKFLOW

This document walks through the end-to-end flow of `scripts/run_wagering_pipeline.js`, showing what data goes in and what data comes out at each step. It includes both historical and live odds paths and clarifies **current-week vs historical** behavior.

---

## Implementation plan (current status)

The desired output structure below is the **target** layout. To fully support it, the pipeline should:

1. Write all tournament-specific inputs and results under `data/wagering/{tournamentSlug}/`.
2. Store **raw artifacts** (joins, evals, model_probs) inside `data/wagering/{tournamentSlug}/inputs/`.
3. Store **human-facing rollups** at the tournament root:
   - `inputs.json` + `inputs.csv` (input references and provenance)
   - `results.json` + `results.csv` (edge summaries and verdicts)
4. Store **season-wide aggregation** (running betting card) at the wagering root:

    - `data/wagering/inputs.json` + `data/wagering/inputs.csv`
    - `data/wagering/betting-card.csv`

**Behavioral expectations (requested):**

- **Current tournament (live):**
  - `*_odds_join.csv` is written and should include **all identified opportunities** (positive edge picks), with the implied wager amount (assume 10 units each).
  - `*_odds_eval.csv` and `*_edge_summary.*` are **not written for the current week** (no graded outcomes yet).
  - `results.json` should still list all identified opportunities for the current tournament with **blank outcomes**.

- **Historical validation:**
  - Evaluations and summaries **are written**, using **all available historical seasons** from historical odds and DFS APIs.
  - Historical results must be **separate from current-week opportunities**, even if the tournament slug matches the current event.

- **Betting card (root):**
  - Lists **all identified opportunities/bets** across completed tournaments.
  - Outcomes are **blank until graded**, then updated on the next run.
  - New rows are appended below the last row.

---

## 0) Inputs to the pipeline

**Required:**

- `--season`
- One of: `--eventId`, `--tournamentSlug`, or `--tournamentName`

**Common optional flags:**

- `--tour` (default: `pga`)
- `--market` (default: `all`)
- `--book` (default: `bet365, caesars, draftkings, sportsbook`)
- `--oddsSource` (`historical`, `live`, or `both`, default: `historical`)

**Default behavior (requested):**

- If `--market` is omitted or set to `all`, the pipeline iterates **all supported markets**.
- If `--year` is omitted for historical, the pipeline uses **all available years** found under `data/wagering/odds_archive/outrights/{tour}/`.
- `--oddsFormat` (default: `decimal`)
- Current season is included automatically when `--oddsSource historical` (useful for post-tournament updates).

**Skip switches:**

- `--skipOddsFetch`, `--skipModelProbs`, `--skipJoin`, `--skipEval`, `--skipMonthly`, `--skipSummary`, `--skipDk`

---

## 1) Odds fetch step

**Script invoked:**

- Historical: `scripts/fetch_historical_odds.js`
- Live: `scripts/fetch_live_odds.js` (outrights) or `scripts/fetch_live_matchups.js` (matchups / 3-balls)

**Input data:**

- `--tour`, `--market`, `--oddsFormat`
- Historical only: `--eventId`, `--year` (defaults to `--season`)
- Live only: no `year` and no `eventId` required
- Requires `DATAGOLF_API_KEY` in `.env`

**Output data:**

- Historical outrights: `data/wagering/odds_archive/outrights/{tour}/{year}/{market}/{eventId}/{book}.json`
- Historical matchups: `data/wagering/odds_archive/matchups/{tour}/{year}/{eventId}/{book}.json`
- Live outrights: `data/wagering/odds_live/outrights/{tour}/{market}/latest.json`
- Live matchups / 3-balls: `data/wagering/odds_live/matchups/{tour}/{market}/latest.json`

---

## 2) Model probabilities build

**Script invoked:**

- `scripts/build_model_probs.js`

**Input data:**

- `data/{season}/{tournamentSlug}/pre_event/pre_event_results.json` (from your pre-event run)
- `--season`, plus one of `--eventId` / `--tournamentSlug` / `--tournamentName`

**Output data:**

- `data/wagering/{tournamentSlug}/inputs/{tournamentSlug}_{market}_model_probs.csv`

**Notes:**

- This currently produces outright-style probabilities only (win/top-N).
- For matchups / 3-balls, the model CSV must include `opponent_ids` to allow joining (see Step 3).
- The rankings sheet is **upstream** of this step. Its influence is captured indirectly via the model probabilities CSV (the rankings are inputs to the pre-event results used here).

---

## 3) Join model probabilities to odds

**Script invoked:**

- `scripts/build_odds_join.js`

**Input data:**

- Model probs CSV from Step 2
- Odds JSON from Step 1 (historical or live)
- `--oddsSource` controls whether historical or live odds are used
- If `--oddsSource both`, the pipeline runs **historical first**, then **live**, and writes separate outputs for each.

**Output data:**

- `data/wagering/{tournamentSlug}/inputs/{tournamentSlug}_{market}_{oddsSource}_odds_join.csv`

**Join behavior:**

- Outrights: join by `player_id` to odds entries
- Matchups / 3-balls: join by `player_id` + `opponent_ids` (canonical key of all players in the matchup)

**Key output columns:**

- `p_model`, `odds_decimal`, `p_implied`, `edge`
- `odds_source_path`, `model_probs_path`
- **Requested addition:** each row should also include a **human-readable summary** (e.g., one-line text describing player, odds, implied probability, model probability, and edge).

---

## 4) Edge evaluation (grading + outcomes)

**Script invoked:**

- `scripts/run_edge_evaluation.js`

**Input data:**

- `data/wagering/{tournamentSlug}/inputs/{tournamentSlug}_{market}_{oddsSource}_odds_join.csv`

**Output data:**

- `data/wagering/{tournamentSlug}/inputs/{tournamentSlug}_{market}_{oddsSource}_edge_summary.json`
- `data/wagering/{tournamentSlug}/inputs/{tournamentSlug}_{market}_{oddsSource}_edge_summary.csv`
- `data/wagering/{tournamentSlug}/inputs/{tournamentSlug}_{market}_{oddsSource}_odds_eval.csv`

**What it does:**

- Computes edge z-scores and grades
- Pulls outcomes from the odds payload when available
- Produces summary metrics (avg edge, hit rate, brier, log loss)

**Requested behavior:**

- For the **current tournament**, these files should be **deferred** until results are available (post-tournament).
- For **historical seasons**, these files are written immediately.
- Historical results should be stored **per season** (one row per season in summary outputs).

---

## 5) Weekly simulation

**Script invoked:**

- `scripts/run_weekly_simulation.js`

**Input data:**

- Uses the join output and/or evaluation outputs (from Step 3 / 4)
- `--stake` optional

**Output data:**

- Writes the running betting card under `data/wagering/betting-card.csv`

**Note:**

- This runs one odds source at a time (historical OR live). To compare both, run twice with different `--oddsSource`.

---

## 6) Summary report

**Script invoked:**

- `scripts/run_wagering_summary.js`

**Input data:**

- `data/wagering/{tournamentSlug}/inputs/{tournamentSlug}_{market}_{oddsSource}_odds_eval.csv`

**Output data:**

- `data/wagering/{tournamentSlug}/results.json`
- `data/wagering/{tournamentSlug}/results.csv`
- `data/wagering/{tournamentSlug}/inputs.json`
- `data/wagering/{tournamentSlug}/inputs.csv`

**Note:**

- Tournament results do not include weekly simulation. Weekly aggregation lives in the wagering root outputs.

**Requested additions:**

- `results.json` should include **all identified opportunities** for the current tournament (with blank outcomes), with fields:
  - `season`, `tournament_slug`, `market`, `odds_source`, `wager_amount`, `outcome`
- `results.json` should include a **human-readable** summary or richer `value_verdict` text.

---

## 7) DK lineup optimizer (optional)

**Script invoked:**

- `scripts/run_dk_lineup_optimizer.js`

**Input data:**

- Current slate configuration and optional optimizer settings
- Uses DataGolf fantasy projection defaults (live)

**Output data:**

- DraftKings lineup outputs under `data/wagering/fantasy/draftkings/pga/`

---

## Typical usage patterns

### A) Historical backtest (odds validation)

- `--oddsSource historical`
- Requires `--eventId` and `--year`
- Produces evaluation metrics and summaries
- If validation is negative, treat the current event edge as informational only.

### B) Current event edge (live odds)

- `--oddsSource live`
- Does not require `--year` for odds
- Uses current odds snapshots to compute edge

### C) Combined run (historical + live)

- `--oddsSource both`
- Runs historical first, then live
- Produces **two** sets of inputs and results in the tournament folder, keyed by `{oddsSource}`

### D) Historical odds cache (reduce weekly API calls)

Use the historical cache runner to pre-fetch and store odds snapshots by year/event/book/market under `data/wagering/odds_archive/`. Weekly runs can then use `--skipOddsFetch` to avoid re-calling the API.

**Script:**

- `scripts/cache_historical_odds.js`

**Example usage (all historical years in `data/{year}/manifest.json`):**

- `node scripts/cache_historical_odds.js --season 2026 --includeMatchups --sleepMs 250`

**Notes:**

- Excludes the current season by default (uses `--season` to determine current year).
- Skips files that already exist unless `--force` is provided.
- Accepts `--years`, `--fromYear`, `--toYear`, `--eventIds`, and `--limitEvents` to control scope.

### E) Post-tournament update (historical odds + grading for last week)

Use this after results post to refresh any missing historical odds cache entries for the event and rebuild the betting card.

**Example:**

- `node scripts/run_wagering_pipeline.js --season 2026 --event 475 --name "The Valspar" --oddsSource historical --oddsPoint close --market all`

### F) Current week (live odds)

**Example:**

- `node scripts/run_wagering_pipeline.js --season 2026 --event <EVENT_ID> --name "<TOURNAMENT_NAME>" --oddsSource live --oddsPoint current --market all`

---

## Known gaps and next steps

- Matchups and 3-balls require model CSVs with `opponent_ids`.
- If you want DFS backtesting, use `scripts/fetch_historical_dfs_points.js` to build a DFS archive for join and validation.
- DFS points payload already includes salaries/ownership; cached under `data/wagering/odds_archive/draftkings/{eventId}.json` via `scripts/fetch_historical_dfs_points.js`.

---

## Wagering root outputs (current-year aggregation)

- `data/wagering/inputs.json`
- `data/wagering/inputs.csv`
- `data/wagering/betting-card.csv`

---

## Example tree (the-valspar)

Assume:

- tournament slug: `the-valspar`
- season: `2026`
- markets: `win`, `top_10`, `top_20`, etc.
- odds sources: `historical` and `live`

Example output tree (expected):

```text
data/
  wagering/
    inputs.json
    inputs.csv
    betting-card.csv
    the-valspar/
      inputs.json
      inputs.csv
      results.json
      results.csv
      inputs/
        the-valspar_win_historical_model_probs.csv
        the-valspar_win_historical_odds_join.csv
        the-valspar_win_historical_odds_eval.csv
        the-valspar_win_historical_edge_summary.json
        the-valspar_win_historical_edge_summary.csv
        the-valspar_win_live_odds_join.csv
        # Live eval/summary files are written post-tournament
        the-valspar_top_10_historical_model_probs.csv
        ... (repeat per market and odds source)
```

---

## File contents (verbose)

### `data/wagering/{tournamentSlug}/inputs.json`

**Purpose:** Captures **all inputs and provenance** used for that tournament’s run. This is the definitive reference for which raw files were used to build the results.

**Contains:**

- `season`, `tournament_slug`, `market`
- `odds_source` (e.g., `historical` or `live`)
- `generated_at` timestamp
- `outputs`: a list of file references with existence flags
  - Odds source JSON path (historical or live)
  - Model probabilities CSV path
  - Odds join CSV path
  - Odds eval CSV path
  - Edge summary JSON/CSV paths
  - DK lineup output paths (if present)

**Example structure (conceptual):**

```json
{
  "historical": {
    "season": "2026",
    "tournament_slug": "the-valspar",
    "market": "win",
    "odds_source": "historical",
    "generated_at": "2026-03-18T15:40:00.000Z",
    "outputs": [
      { "label": "Odds archive", "path": "data/wagering/odds_archive/...", "exists": true },
      { "label": "Model probabilities", "path": "data/wagering/the-valspar/inputs/...", "exists": true },
      { "label": "Odds join", "path": "data/wagering/the-valspar/inputs/...", "exists": true },
      { "label": "Odds evaluation", "path": "data/wagering/the-valspar/inputs/...", "exists": true },
      { "label": "Edge summary (json)", "path": "data/wagering/the-valspar/inputs/...", "exists": true },
      { "label": "Edge summary (csv)", "path": "data/wagering/the-valspar/inputs/...", "exists": true }
    ]
  },
  "live": { "...": "..." }
}
```

### `data/wagering/{tournamentSlug}/inputs.csv`

**Purpose:** Flat, filterable input inventory (human-friendly and easy to diff).

**Columns:**

- `season`
- `market`
- `odds_source`
- `label`
- `path`
- `exists`

Each row maps to one input/output artifact for the tournament and odds source.

---

### `data/wagering/{tournamentSlug}/results.json`

**Purpose:** Final **per-source results** (historical vs live) for the tournament. This file is the authoritative “did the model show value?” record.

**Contains:**

- `season`, `tournament_slug`, `market`, `odds_source`
- `value_verdict`: `Positive`, `Negative`, or `Neutral`
- `edge_summary`: the computed summary metrics
  - `avg_edge`, `median_edge`, `hit_rate`, `brier`, `log_loss`
  - `total_rows`, `rows_with_outcomes`

**Example structure (conceptual):**

```json
{
  "historical": {
    "season": "2026",
    "tournament_slug": "the-valspar",
    "market": "win",
    "odds_source": "historical",
    "value_verdict": "Positive",
    "edge_summary": {
      "avg_edge": 0.012,
      "median_edge": 0.006,
      "hit_rate": 0.54,
      "brier": 0.226,
      "log_loss": 0.617,
      "total_rows": 156,
      "rows_with_outcomes": 156
    }
  },
  "live": {
    "...": "..."
  }
}
```

**Requested additions to this file:**

- Include an `opportunities` array for the current tournament with:
  - `player_id`, `player_name`, `market`, `odds_decimal`, `p_model`, `p_implied`, `edge`
  - `wager_amount` (assume 10 units)
  - `outcome` (blank until graded)
- Make `value_verdict` human-readable (e.g., a short narrative sentence).

### `data/wagering/{tournamentSlug}/results.csv`

**Purpose:** Single-row-per-odds-source summary table for quick scanning and sorting.

**Columns:**

- `odds_source`
- `season`
- `tournament_slug`
- `market`
- `value_verdict`
- `avg_edge`
- `median_edge`
- `hit_rate`
- `brier`
- `log_loss`

---

### `data/wagering/{tournamentSlug}/inputs/` (raw artifacts)

This folder holds all raw intermediate files used to produce the results. These are the files you’ll open when troubleshooting or validating the run.

#### `{slug}_{market}_model_probs.csv`

**Source:** `build_model_probs.js`

**Contains:** model probabilities for each player:

- `run_timestamp`, `event_id`, `season`, `market_type`
- `player_id`, `player_name`
- `opponent_ids` (empty for outrights)
- `p_model`, `p_win`, `p_top_n`, `score`

**Requested addition:**

- A human-readable summary column per row (e.g., “Player X: model win prob Y%, top‑10 prob Z%”).

#### `{slug}_{market}_{oddsSource}_odds_join.csv`

**Source:** `build_odds_join.js`

**Contains:** joined model probabilities + odds + implied probability + edge:

- Player identity: `player_id`, `player_name`
- Market: `market_type`, `book`, `odds_point`
- Odds: `odds_decimal`, `p_implied`
- Model: `p_model`
- `edge = p_model - p_implied`
- `odds_source_path`, `model_probs_path`
- For matchups/3-balls: `opponent_ids`

**Requested addition:**

- A human-readable summary column per row describing the opportunity (player, odds, implied vs model, edge).

#### `{slug}_{market}_{oddsSource}_odds_eval.csv`

**Source:** `run_edge_evaluation.js`

**Contains:** joined rows plus grading and outcomes:

- All join columns
- `outcome` (0/1 when available)
- `edge_z` (z-score of edge)
- `grade_edge` (A/B/C/D)

**Requested behavior:**

- For the current tournament, this file should not be produced until outcomes are available.

#### `{slug}_{market}_{oddsSource}_edge_summary.json`

**Source:** `run_edge_evaluation.js`

**Contains:** summary metrics:

- `avg_edge`, `median_edge`, `hit_rate`
- `brier`, `log_loss`
- `total_rows`, `rows_with_outcomes`

**Requested behavior:**

- For historical runs, produce one row per **season/year**.
- For current tournament, defer until outcomes are available.

#### `{slug}_{market}_{oddsSource}_edge_summary.csv`

**Source:** `run_edge_evaluation.js`

**Contains:** one-row CSV mirror of the JSON summary.

---

## Root wagering outputs (current-year aggregation)

### `data/wagering/inputs.json`

**Purpose:** Global input inventory for aggregation.

**Contains:**

- Season and odds source
- `odds_eval_files`: list of all evaluation files used to build the betting card

### `data/wagering/inputs.csv`

**Purpose:** Flat list of evaluation files used in the aggregation.

**Columns:**

- `season`, `market`, `odds_source`, `odds_eval_path`

### `data/wagering/betting-card.csv`

**Purpose:** Running list of all bets placed across tournaments.

**Columns:**

- `season`
- `market`
- `book`
- `odd_source`
- `tournament_slug`
- `event`
- `generated_at`
- `player`
- `odds`
- `stake`
- `settled_stake`
- `total_return`
- `net`
- `roi`
- `notes`
- `p_model`
- `p_implied`
- `edge`

---

If you want, I can also add a one-page diagram that shows the full data flow visually.

---
If you want, I can also add a one-page diagram that shows the full data flow visually.
