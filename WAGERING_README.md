# WAGERING_README

> **Project status (2026‑03‑25):** Live wagering pipeline produces a **10‑bet probability‑first card** (7 non‑matchups + 3 matchups) with edge‑z filtering and a fallback fill to preserve volume. Betting‑card validation outputs are written to `data/wagering/validation/` (see `betting_card_validation_{season|all}.*`).
> **Note:** This document describes a *technical evaluation* workflow for comparing model probabilities vs market odds. It is **not** wagering advice.

---

## Future development (not implemented)

- **Calibration metrics** in betting‑card validation (Brier, LogLoss, Platt/Isotonic).
- **DraftKings contest analytics** (cash rate, ROI vs field/optimal) once contest IDs or results are available.
- **DraftKings contest evaluation:** scaffolding exists but is **not active** without valid contest IDs. Outputs are expected under `data/wagering/contests/draftkings/` once implemented.
- **Explicit settlement audit** (automatic verification of `settled stake`, `total return`, `net`).

---

## Goal

Quantify whether the model’s predictions provide **statistical value** versus market‑implied probabilities using strict, time‑aligned, out‑of‑sample evaluation, and produce a reproducible **betting card** with transparent selection and validation outputs.

---

## Evidentiary thresholds and evaluation questions

This section makes the intent explicit: **what questions are we trying to answer** at each entry point (pre‑event vs post‑event), and what evidence would be convincing.

### Pre‑event questions (before odds settle outcomes)

- **Are probabilities calibrated?** Do pre‑event model probabilities behave like probabilities (LogLoss/Brier better than baseline)?
- **Is there stable value vs market?** Are edges consistently positive when aligned to **prior** odds snapshots?
- **Is value robust across markets?** Do outrights and matchups both show signal without collapsing in smaller markets?

### Post‑event questions (after outcomes are known)

- **Did positive‑edge picks realize value?** Are hit‑rate and ROI stable when judged on settled results?
- **Does performance persist by season?** Do we see consistency across multiple seasons and event clusters?
- **Is selection logic doing what we intend?** Does probability‑first protect hit‑rate while still preserving edge?

### What would convince me

- **Consistent OOS edge** across at least 2–3 seasons.
- **Stable calibration** (LogLoss/Brier better than baseline) in OOS splits.
- **Edge survives** across market types and does not collapse by timing.
- **Robustness** to different market sources and odds snapshots.

---

## Pipeline overview (wagering)

In practice, you usually run **one of two entry points**, because the weekly simulation is embedded in the pipeline:

1. **`scripts/run_wagering_pipeline.js`** — end‑to‑end build (fetch odds, build model probs, join, edge evaluation, and **runs weekly simulation** to write the betting card).
2. **`scripts/run_weekly_simulation.js`** — direct betting‑card builder (use when odds_eval files already exist).

For **historical grading**, the workflow is:

- Run `run_wagering_pipeline.js` (historical) to regenerate odds_eval with outcomes.
- Run `run_weekly_simulation.js` with `--oddsSource historical --updateExisting true --reset false` to **backfill settled fields** on existing betting‑card rows.
- Then run validation (see “Grading historical bets” and “Betting‑card validation”).

Validation is a separate step:

- **`scripts/run_betting_card_validation.js`** — summarizes **settled** betting‑card performance (ROI, hit‑rate, profit) across events/markets/books.

> **Refactor note:** We currently have three scripts because selection and validation grew separately from the end‑to‑end pipeline. **Future refactor goal:** make `run_wagering_pipeline.js` the single entry point for **live** and **historical** end‑to‑end runs, with validation integrated as an optional post‑step.

### Live vs Historical behavior

- **Live mode** (odds source `live`):
  - Uses **edge shrink** by default (`edgeShrink = 0.5`), optionally bucketed by odds.
  - Defaults to **probability‑first** selection and **edge‑z filtering**.
  - Applies **fallback fill** if edge‑z filtering reduces the card below target size.

- **Historical mode** (odds source `historical`):
  - Uses **no shrink** by default (`edgeShrink = 1`).
  - Selection defaults to **edge‑first** unless overridden.

---

## Selection logic (betting card)

### Selection modes

- `--selectionMode probability | edge | hybrid` (default live: `probability`, historical: `edge`)
  - **probability**: rank by $p_{model}$ descending; edge is a tiebreaker.
  - **edge**: rank by edge descending.
  - **hybrid**: mixed comparator (currently aligns with comparator defaults).
  - **Step up/down:**
    - Move toward `edge` to chase value at the cost of hit‑rate stability.
    - Move toward `probability` to maximize hit‑rate stability at the cost of average edge.

### Volume targets

- `--liveTopN 7` (default: 7 non‑matchups)
- `--matchupTopN 3` (default: 3 matchups)
- **Target total = 10 bets** (7 + 3)
  - **Step up/down:**
    - Increase `liveTopN` to favor outrights/top‑finish markets.
    - Increase `matchupTopN` to favor matchups (often higher hit‑rate).

### Edge shrink (live‑only by default)

- `--edgeShrink` (default live: `0.5`, historical: `1.0`)
- `--edgeShrinkMode bucket | flat` (default live: `bucket`)
  - **bucket** applies market/odds‑specific shrink factors (see `EDGE_SHRINK_BUCKETS` in `run_weekly_simulation.js`).
  - **flat** applies one shrink value to all edges.
  - **Step up/down:**
    - Increase `edgeShrink` toward `1.0` to trust model edges more (higher variance).
    - Decrease `edgeShrink` toward `0.0` to dampen edges (lower variance, more conservative).

**Clarification (live vs historical):**

- **Live**: edge shrink is a **card‑construction control** to dampen noisy, time‑sensitive edges. It helps avoid over‑confident live selections.
- **Historical**: we use `edgeShrink=1.0` because the goal is **grading/validating already‑selected bets**, not re‑optimizing the edge. Shrinking historical edges would blur the signal you’re trying to validate.

**Does changing shrink create noise/leakage?**

- For **live selection**, shrink is a **design choice** (a risk control), not leakage.
- For **historical grading**, changing shrink **would** introduce bias because it changes the edge basis you’re validating. That’s why historical grading uses `edgeShrink=1.0` and focuses on updating settled fields, not re‑selecting bets.

### Edge‑z filtering

- `--edgeZPercentile` (default: `0.2`)
  - Keeps the top X% of candidates by **edge_z**.
- `--edgeZScope market | all` (default: `market`)
  - `market` = apply percentile inside each market type.
  - `all` = apply percentile across all markets.
- `--edgeZRelaxToFill true | false` (default: `true`)
  - If edge‑z filtering leaves the card short of target size, **relax** edge‑z and fill using base candidates.
  - **Step up/down:**
    - Raise `edgeZPercentile` (e.g., 0.3 → 0.4) to be stricter (fewer bets, higher edge concentration).
    - Lower `edgeZPercentile` (e.g., 0.2 → 0.1) to be looser (more bets, lower edge concentration).
    - Set `edgeZRelaxToFill=false` for strict filtering (may return fewer than 10 bets).

### Market gates (quality filters)

Outrights:

- `--outrightMinModel 0.015` (default)
- `--outrightMaxOdds 25` (default)
  - **Step up/down:** raise min model / lower max odds to tighten quality; lower min model / raise max odds to increase volume.

Top‑5:

- `--top5MinModel 0.50` (default)
- `--top5MaxOdds 6` (default)
  - **Step up/down:** same as above.

Top‑10:

- `--top10MinModel 0.20` (default)
- `--top10MaxOdds 10` (default)
  - **Step up/down:** same as above.

Top‑20:

- `--top20MinModel 0.25` (default)
- `--top20MaxOdds 20` (default)
  - **Step up/down:** same as above.

Matchups:

- `--matchupMinModel 0.56` (default; round matchups)
- `--tournamentMatchupMinModel 0.52` (default; tournament matchups)
- `--matchupMinModel3Balls 0.80` (default; 3‑balls)
- `--matchupEdgeFloor` (default: equals `edgeFloor`)
  - **Step up/down:** raise matchup mins to tighten quality; lower mins to increase volume (especially if you’re under 10 bets).

### Edge floors

- `--edgeFloor 0` (default) applies to non‑matchups.
- `--matchupEdgeFloor` defaults to `edgeFloor` unless overridden.
  - **Step up/down:** raise floors to reduce bet count and increase average edge; lower floors to preserve volume.

### Dedupe + tie‑breakers

- **Dedupe by player**: if a player appears multiple times in a candidate pool, keep the **highest‑odds** version.
- **Tie preference**: when edges and $p_{model}$ are within small deltas, matchups can be preferred during fill.
  - `--edgeTieDelta` default `0.01`
  - `--pModelTieDelta` default `0.02`
  - **Step up/down:** increase deltas to favor matchups more often; decrease to make tie‑breakers rarer.

### Fill logic

1. Select top `liveTopN` non‑matchups and `matchupTopN` matchups.
2. If short, fill with remaining ranked candidates.
3. If still short **and** `edgeZRelaxToFill=true`, fill from **edge‑floor‑only** candidates (no edge‑z filter).

---

## Staking & allocation

### Stake modes

- `--stakeMode edge_scaled | flat` (default: `edge_scaled`)
  - **edge_scaled** (default): weights by $p_{model}$ (or edge if missing).
  - **flat**: equal stakes across the card.
  - **Step up/down:** move to `flat` to remove weighting; keep `edge_scaled` to emphasize higher $p_{model}$ bets.

### Total stake

- `--totalStake` or `--eventStake` (live default: `100`)
  - **Step up/down:** higher totalStake scales all bets up proportionally; lower totalStake scales down.

### Max stake cap

- `--maxStakePct` optional. If omitted, a **dynamic cap** is applied in live mode:
  - `cap_pct = clamp(2 / bet_count, 0.2, 0.5)`
  - **Step up/down:** lower maxStakePct to reduce concentration; higher maxStakePct to allow bigger single bets.

### Allocation behavior

- Weights are normalized across the card.
- Any bet exceeding the cap is **capped**, and remaining stake is reallocated.
- Final amounts are **rounded to whole units**; rounding residuals are distributed by fractional remainder.

---

## Outputs

### Betting card

**Location:** `data/wagering/`

- `betting-card.csv` — primary artifact
- `betting-card.json` — JSON payload with the same rows
- `inputs.json` / `inputs.csv` — metadata describing which odds_eval files were used

**`betting-card.csv` columns** (exact):

```text
season,
book,
odd_source,
tournament_slug,
event,
odds_generated_at,
odds_graded_at,
player,
dg_id,
market,
odds,
stake,
settled stake,
total return,
net,
roi,
,
p_model,
p_implied,
edge
```

> Note: `edge_z` is carried internally but **not** currently written to `betting-card.csv`.

---

## Grading historical bets (updating the betting card)

Use this workflow to **populate settled fields** (`settled stake`, `total return`, `net`, `roi`) for older bets already in `betting-card.csv`.

### How it works

`run_weekly_simulation.js` can update existing betting‑card rows using **historical odds_eval** files that include outcomes. It matches rows on:

- `event` + `market` + `book` + `dg_id`

When outcomes are available in odds_eval data, the script computes:

- `settled stake`
- `total return`
- `net`
- `roi`

> This uses the odds_eval outcomes (including dead‑heat handling when present) and **does not** create new bets in historical mode—it only updates existing rows.

### Required inputs

- Historical odds_eval files for the event/season you want to grade.
- Existing rows in `data/wagering/betting-card.csv` for those bets.

### Workflow

1. **Regenerate historical odds_eval** (ensures outcomes are present):

  ```text
  node scripts/run_wagering_pipeline.js --season 2026 --event 475 --oddsSource historical --market all
  ```

1. **Update settled fields in the betting card** (historical mode, update existing rows):

  ```text
  node scripts/run_weekly_simulation.js --season 2026 --eventId 475 --oddsSource historical --market all --updateExisting true --reset false
  ```

1. **Run validation** on the now‑settled card:

  ```text
  node scripts/run_betting_card_validation.js --season 2026
  ```

**One‑script vs two‑script:**

- If **historical odds_eval files with outcomes already exist**, you can run only the **second** step (update settled fields).
- If outcomes are **not** present yet, you must run **both** steps: regenerate odds_eval **then** update the betting card.

### Important flags

- `--updateExisting true` (default) — merges settled fields into existing betting‑card rows.
- `--reset false` (default) — keeps existing rows; do **not** wipe the betting card.
- `--oddsSource historical` — enables grading from historical outcomes without adding new bets.
- `--market all` — ensures all market types in the betting card are considered.

---

## Betting‑card validation

### What validation does

`run_betting_card_validation.js` reads **settled** rows from `betting-card.csv` and produces rollups by event/market/book plus bet‑level detail.

**It does NOT compute calibration metrics** (no Brier, no Platt). Those are future‑development items.

### How to run

```text
node scripts/run_betting_card_validation.js --season 2026
```

### Required fields (settled bets)

Validation relies on these being present in `betting-card.csv`:

- `settled stake`
- `total return`
- `net`

These are populated when results are available and the pipeline updates the betting card. If missing, validation still runs but profits/ROI will be zero.

### Validation outputs

**Location:** `data/wagering/validation/`

- `betting_card_validation_{season|all}.json` — full payload
- `betting_card_validation_{season|all}.csv` — summary rows
- `betting_card_validation_{season|all}_bets.csv` — bet‑level rows
- `betting_card_validation_{season|all}.md` — markdown rollup

**Summary CSV columns** (exact):

```text
season,
eventId,
market,
book,
bets,
wins,
stake,
profit,
roi,
hitRate
```

**Bet‑level CSV columns** (exact):

```text
season,
eventId,
market,
book,
dgId,
playerName,
odds,
stake,
settledStake,
totalReturn,
net,
roi,
won,
profit
```

**Validation rollups include:**

- overall totals (bets, wins, stake, profit, ROI, hit rate)
- aggregate by market/book
- per‑event ROI + hit rate

---

## Example workflows

### Live betting card (default entry point)

```text
node scripts/run_wagering_pipeline.js --season 2026 --event 20 --oddsSource live
```

**Required flags:**

- `--season`
- `--event` (or `--eventId` / `--tournamentSlug` / `--name`)
- `--oddsSource live`

**Implied defaults (selection + pipeline):**

- `market=all`
- `tour=pga`
- `oddsFormat=decimal`
- `oddsPoint=current`
- `books=bet365, caesars, draftkings, sportsbook`
- `selectionMode=probability`
- `edgeFloor=0`
- `edgeZPercentile=0.2`
- `edgeZScope=market`
- `edgeZRelaxToFill=true`
- `liveTopN=7`, `matchupTopN=3`
- `edgeShrink=0.5`, `edgeShrinkMode=bucket`

### Live betting card (direct builder, optional)

```text
node scripts/run_weekly_simulation.js --season 2026 --oddsSource live
```

**Required flags:**

- `--season`
- `--oddsSource live`

**Implied defaults (selection):**

- `market=all`
- `selectionMode=probability`
- `edgeFloor=0`
- `edgeZPercentile=0.2`
- `edgeZScope=market`
- `edgeZRelaxToFill=true`
- `liveTopN=7`, `matchupTopN=3`
- `edgeShrink=0.5`, `edgeShrinkMode=bucket`

### Historical: regenerate odds_eval with outcomes

```text
node scripts/run_wagering_pipeline.js --season 2026 --event 475 --oddsSource historical
```

**Required flags:**

- `--season`
- `--event` (or `--eventId` / `--tournamentSlug` / `--name`)
- `--oddsSource historical`

**Defaults used by this command (historical selection):**

- `market=all`
- `selectionMode=edge`
- `edgeShrink=1.0`

### Historical: update settled fields on the betting card

```text
node scripts/run_weekly_simulation.js --season 2026 --eventId 475 --oddsSource historical
```

**Required flags:**

- `--season`
- `--eventId` (or `--event`)
- `--oddsSource historical`

**Defaults used by this command:**

- `market=all`
- `updateExisting=true`
- `reset=false`

### Validate settled betting card

```text
node scripts/run_betting_card_validation.js --season 2026
```

**Required flags:**

- `--season` (omit to validate all seasons)

---

## Data requirements (reference)

This section summarizes the required data inputs for joining model outputs to odds.

### Model outputs (per run)

- `event_id`, `tournament`, `season`, `run_timestamp`
- `player_id` (DataGolf ID), `player_name`
- **Outright**: `p_win` (or finish‑position distribution)
- **Match‑up**: `p_playerA_over_playerB`
- **3‑ball**: `p_playerA_win`, `p_playerB_win`, `p_playerC_win`

### Market odds (timestamped)

- `market_timestamp`
- `market_source`
- **Outright**: `player_id`, `odds_decimal`
- **Match‑up**: `playerA_id`, `playerB_id`, `oddsA`, `oddsB`
- **3‑ball**: `playerA_id`, `playerB_id`, `playerC_id`, `oddsA`, `oddsB`, `oddsC`

### Alignment rules (critical)

1. Only use odds snapshots **before** the model run time.
2. Select the **closest prior** snapshot.
3. Exclude markets created **after** event start.

---

## Appendix A — DataGolf API references (params + endpoints)

### Historical odds

- **Event list (IDs + availability)**
  - `https://feeds.datagolf.com/historical-odds/event-list?tour=[tour]&file_format=[file_format]&key=...`
  - Params: `tour` (pga/euro/alt), `file_format` (json/csv)
  - Fields: `event_id`, `calendar_year`, `event_name`, flags for `archived_preds`, `matchups`, `outrights`

- **Historical outrights**
  - `https://feeds.datagolf.com/historical-odds/outrights?tour=[tour]&event_id=[event_id]&year=[year]&market=[market]&book=[book]&odds_format=[odds_format]&file_format=[file_format]&key=...`
  - Params: `market` (win, top_5, top_10, top_20, make_cut, mc), `book` (draftkings, pinnacle, etc.), `odds_format` (decimal/american/percent/fraction)
  - Fields: `open_odds`, `open_time`, `close_odds`, `close_time`, `dg_id`, `player_name`, `outcome`, `bet_outcome_text`

- **Historical matchups & 3‑balls**
  - `https://feeds.datagolf.com/historical-odds/matchups?tour=[tour]&event_id=[event_id]&year=[year]&book=[book]&odds_format=[odds_format]&file_format=[file_format]&key=...`
  - Fields: `bet_type` (72‑hole / round matchup / 3‑ball), `p1_*`, `p2_*`, `p3_*` odds + outcomes, `tie_rule`, open/close times

### Live betting tools

- **Live outrights (finish position odds + DataGolf predictions)**
  - `https://feeds.datagolf.com/betting-tools/outrights?tour=[tour]&market=[market]&odds_format=[odds_format]&file_format=[file_format]&key=...`
  - Params: `market` (win, top_5, top_10, top_20, mc, make_cut, frl), `tour` (pga/euro/kft/opp/alt)
  - Fields: sportsbook odds per player + `datagolf` predictions

- **Live matchups / 3‑balls (odds + DataGolf predictions)**
  - `https://feeds.datagolf.com/betting-tools/matchups?tour=[tour]&market=[market]&odds_format=[odds_format]&file_format=[file_format]&key=...`
  - Params: `market` (tournament_matchups, round_matchups, 3_balls)
  - Fields: `match_list` with `p1/p2/p3` odds and tie rules

- **Live matchups / 3‑balls (all pairings, DataGolf odds only)**
  - `https://feeds.datagolf.com/betting-tools/matchups-all-pairings?tour=[tour]&odds_format=[odds_format]&file_format=[file_format]&key=...`
  - Fields: `pairings` with `p1/p2/p3` odds, course, tee time, round

---

## Appendix B — Storage layout & naming conventions

### Suggested storage layout

```text
data/
  wagering/
    odds_archive/
      event_list/
        event_list_2025.json
      outrights/
        pga/2025/win/draftkings.json
        pga/2025/top_20/pinnacle.json
      matchups/
        pga/2025/draftkings.json
    odds_live/
      outrights/
        pga/win/latest.json
      matchups/
        pga/3_balls/latest.json
      matchups_all_pairings/
        pga/latest.json
    betting-card.csv
    betting-card.json
    inputs.json
    inputs.csv
    {tournament_slug}/
      inputs/
        {slug}_{market}_{oddsSource}_{book}_odds_join.csv
        {slug}_{market}_{oddsSource}_{book}_odds_eval.csv
        {slug}_{market}_{oddsSource}_{book}_edge_summary.json
        {slug}_{market}_{oddsSource}_{book}_edge_summary.csv
        {slug}_{market}_model_probs.csv
      inputs.json
      inputs.csv
      results.json
      results.csv
```

### Tournament subdirectory layout (per event)

```text
data/wagering/{tournament_slug}/
  inputs/
    {slug}_{market}_{oddsSource}_{book}_odds_join.csv
    {slug}_{market}_{oddsSource}_{book}_odds_eval.csv
    {slug}_{market}_{oddsSource}_{book}_edge_summary.json
    {slug}_{market}_{oddsSource}_{book}_edge_summary.csv
    {slug}_{market}_model_probs.csv
  inputs.json
  inputs.csv
  results.json
  results.csv
```

### Naming conventions (recommended)

- **Outrights**: `{tour}/{year}/{market}/{book}.json`
- **Matchups / 3‑balls**: `{tour}/{year}/{book}.json`
- **Live snapshots**: `{tour}/{market}/latest.json` (or timestamped: `YYYYMMDD_HHMM.json`)

---

## Appendix C — File schemas (reference)

### `inputs.json`

- Top‑level keys: `live`, `historical` (odds sources).
- Each entry includes: `season`, `tournament_slug`, `market`, `odds_source`, `odds_year`, `book`, `generated_at`, and `outputs` (array of `{ label, path, exists }`).

### `results.json`

- Top‑level keys: `live`, `historical` (odds sources).
- Each entry includes: `season`, `tournament_slug`, `market`, `odds_source`, `odds_year`, `book`, `value_verdict`, and `edge_summary` (object).

### `inputs.csv`

```text
season,market,odds_source,odds_year,book,label,path,exists
```

### `results.csv`

```text
odds_source,odds_year,book,season,tournament_slug,market,value_verdict,avg_edge,median_edge,hit_rate,brier,log_loss
```

### `model_probs.csv`

```text
run_timestamp,event_id,season,market_type,player_id,player_name,opponent_ids,p_model,p_win,p_top_n,score,summary
```

### `odds_join.csv`

```text
run_timestamp,event_id,season,odds_year,market_type,book,odds_point,player_id,player_name,opponent_ids,p_model,odds_decimal,p_implied,edge,odds_source_path,model_probs_path
```

### `odds_eval.csv`

```text
run_timestamp,event_id,season,market_type,book,odds_point,player_id,player_name,p_model,odds_decimal,p_implied,edge,edge_z,grade_edge,outcome,odds_source_path,model_probs_path
```

### `edge_summary.csv`

```text
event_id,season,odds_year,book,market,total_rows,rows_with_outcomes,avg_edge,median_edge,hit_rate,brier,log_loss
```

### `market_odds.csv`

```text
market_timestamp,event_id,market_type,player_id,player_name,opponent_ids,odds_decimal
```

### `outcomes.csv`

```text
event_id,player_id,finish_position,win_flag
```

---

## Appendix D — Equations & scoring

### Implied probability (from odds)

$$
p_{imp} = \begin{cases}
\frac{1}{odds_{decimal}} & \text{decimal}\\
\frac{100}{odds_{american}+100} & \text{if } odds_{american}>0\\
\frac{-odds_{american}}{-odds_{american}+100} & \text{if } odds_{american}<0
\end{cases}
$$

### Edge

$$
edge = p_{model} - p_{imp}
$$

### Edge z‑score

$$
edge\_z = \frac{edge - \mu_{edge}}{\sigma_{edge}}
$$

### Logistic transform

$$
\sigma(x) = \frac{1}{1 + e^{-x}}
$$

### Softmax (used for score‑based win probabilities)

$$
softmax(s_i) = \frac{e^{s_i}}{\sum_j e^{s_j}}
$$

### Top‑N probability heuristic (build_model_probs)

$$
z_i = \frac{score_i - \mu}{\sigma}
$$

$$
p_i = \sigma\left( scale \cdot (z_i - threshold) \right)
$$

Where $threshold$ is the $(1 - \frac{N}{field\_size})$ percentile of $z$, and $scale$ is chosen so $\frac{1}{field\_size}\sum_i p_i \approx \frac{N}{field\_size}$.

### Matchup probability (head‑to‑head)

$$
p_{A} = \sigma(score_A - score_B)
$$

### Brier score

$$
\mathrm{Brier} = \frac{1}{N} \sum_{i=1}^{N} (p_i - y_i)^2
$$

### Log loss

$$
\mathrm{LogLoss} = -\frac{1}{N} \sum_{i=1}^{N} \left( y_i \log p_i + (1-y_i) \log(1-p_i) \right)
$$

### ROI

$$
ROI = \frac{net}{total\_stake}
$$

### Stake allocation (edge_scaled)

$$
weight_i = p_{model,i}\;\text{(fallback to edge when needed)}
$$

$$
stake_i = total\_stake \cdot \frac{weight_i}{\sum_j weight_j}
$$

### Dynamic max stake cap (live default)

$$
cap\_pct = clamp\left(\frac{2}{bet\_count}, 0.2, 0.5\right)
$$

### Edge grade (from edge z‑score)

$$
grade = \sigma(edge\_z)
$$

Buckets: **A** $\ge 0.80$, **B** $0.65$–$0.79$, **C** $0.50$–$0.64$, **D** $< 0.50$.

---

## Appendix E — Helper scripts & utilities (wagering pipeline)

### Helper scripts

- `scripts/run_wagering_pipeline.js` — Orchestrates the end‑to‑end wagering workflow (fetch odds → model probs → join → edge eval → betting card → summary). Insertion points: **primary entry point** for live/historical runs.
- `scripts/fetch_live_odds.js` — Pulls live outrights from DataGolf and caches to `data/wagering/odds_live/`. Insertion points: **odds fetch (live outrights)** inside `run_wagering_pipeline.js`.
- `scripts/fetch_live_matchups.js` — Pulls live matchups/3‑balls from DataGolf and caches to `data/wagering/odds_live/`. Insertion points: **odds fetch (live matchups)** inside `run_wagering_pipeline.js`.
- `scripts/fetch_historical_odds.js` — Pulls historical odds (event list, outrights, matchups) for the archive. Insertion points: **historical cache priming** inside `run_wagering_pipeline.js` when archive is missing.
- `scripts/build_model_probs.js` — Converts optimizer pre‑event rankings into market‑specific probabilities. Insertion points: **model_probs step** inside `run_wagering_pipeline.js` (per market).
- `scripts/build_odds_join.js` — Joins `model_probs` with odds snapshots to compute implied probabilities and edge. Insertion points: **odds join step** inside `run_wagering_pipeline.js` (per book/market).
- `scripts/run_edge_evaluation.js` — Calculates `edge_z`, grades edges, and writes `odds_eval` + `edge_summary`. Insertion points: **edge evaluation step** inside `run_wagering_pipeline.js`.
- `scripts/run_weekly_simulation.js` — Builds the betting card (selection, stake allocation) and optionally backfills settled fields for historical grading. Insertion points: **betting card builder** inside `run_wagering_pipeline.js` (live + historical updates).
- `scripts/run_wagering_summary.js` — Writes per‑event `inputs.json/csv` and `results.json/csv` summaries. Insertion points: **summary step** inside `run_wagering_pipeline.js`.
- `scripts/run_betting_card_validation.js` — Aggregates betting‑card outcomes (ROI/hit‑rate) into validation outputs. Insertion points: **post‑card validation** (manual step after card settlement).
- `scripts/run_dk_lineup_optimizer.js` — Optional DraftKings lineup optimizer using DataGolf fantasy projections. Insertion points: **optional DFS branch** when `run_wagering_pipeline.js` is run with `--runDk`.

### Utilities

- `utilities/wageringSelectionUtils.js` — Selection helpers (edge‑z filters, ranking comparators, mode normalization). Insertion points: `scripts/run_weekly_simulation.js` during candidate ranking and filtering.
- `utilities/dataGolfClient.js` — DataGolf API + cache wrappers (live odds, historical odds, fantasy projections). Insertion points: `fetch_live_odds.js`, `fetch_live_matchups.js`, `fetch_historical_odds.js`, `run_dk_lineup_optimizer.js`.
