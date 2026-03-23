# WAGERING_UTILITY

> **Project status (2026‑03‑18):** Paper bet validation is implemented and writing outputs to `data/wagering/validation/`. Current mode is **top 10 model‑probability bets per event** with $100 total stake split by Kelly fraction across **outrights + matchups + 3‑balls**. Outputs include `paper_bet_validation_2026.json/.csv/.md` plus `paper_bet_validation_2026_bets.csv`. DraftKings contest API fetch scaffolding exists in `utilities/draftkingsContestClient.js` and `scripts/fetch_dk_contest_results.js`, and it needs a valid contest key (prior attempt returned `CON‑109 Invalid contest key`).
> **Next steps:** Obtain valid DraftKings contest IDs or contest results CSVs, fetch/cache contests to `data/contests/draftkings/`, add DK lineup comparison metrics (cash rate, ROI, percentile vs field, vs optimal) once payout data is available, and run DK lineup evaluation across all 2026 events in the manifest (eventId < 475).
> **Note:** This document describes a *technical evaluation* workflow for comparing model probabilities vs market odds. It is **not** wagering advice.

## Goal

Quantify whether the model’s predictions provide **statistical value** versus market-implied probabilities using strict, time-aligned, out-of-sample evaluation.

---

## Local execution (macOS) — recommended setup

This project runs cleanly on macOS using **Node.js LTS**. I recommend keeping the repo at:

- `~/Projects/modelOptimizer`

### Required software

- **Node.js LTS (v20.x)**
- **Git**
- **VS Code** (optional)

### One-time setup (local)

```text
mkdir -p ~/Projects
cd ~/Projects
git clone git@github.com:zbclark/modelOptimizer.git
cd modelOptimizer
npm install
```

### Keeping local code in sync with GitHub

```text
git pull origin optimizer-refactoring
```

### Running locally (example)

```text
node core/optimizer.js --event 475 --season 2026 --name "Valspar Championship" --pre --apiYears 2020-2026 --writeTemplates
```

### Rankings output import

- Place ranking outputs in the folder the pipeline expects (usually under `data/`).
- Keep file names consistent with current scripts to avoid breaking joins.

### Environment variables (local)

- Store secrets in a local `.env` file at the repo root.
- Typical keys used here:
  - `DATAGOLF_API_KEY=...`
  - `DATAGOLF_API_KEY_PREMIUM=...` (if applicable)
- Never commit `.env` to Git.

---

## Codespaces for development, local machine for execution

If you want **all coding done in Codespaces**, but **all runs done locally**, use this simple workflow:

1. **Develop in Codespaces**, commit changes to `optimizer-refactoring`.
2. **Push to GitHub**.
3. **Pull locally** (macOS) and run scripts from `~/Projects/modelOptimizer`.

This keeps your repo clean and versioned, while ensuring all execution happens on your personal computer.

> **Review note (2026‑03‑18):** Run results (Valspar 2026 + DK slates) should be reviewed on a different device. Please open the latest summary markdown under `data/odds_eval/2026/` and the DK lineup outputs under `data/fantasy/draftkings/pga/`.

---

## Implementation plan (phased)

### Phase 0 — Define scope + markets

- Pick **tour**, **seasons**, and **market types** (outright / matchup / 3‑ball).
- Decide **books** and **odds formats** (decimal recommended).
- Choose **snapshot alignment rule** (closest prior to run time).

### Phase 1 — Ingest + normalize data

- Pull **event list** and **historical odds** (outrights + matchups/3‑balls).
- Store snapshots using the **canonical keys** and naming conventions below.
- Normalize **player IDs**, **pairing keys**, and **timestamps**.

### Phase 2 — Join model outputs to odds

- Require `run_timestamp` in model outputs.
- Join model outputs to **closest prior** odds snapshot per market.
- Produce a joined dataset: model probs + odds + implied probs + edge.

### Phase 3 — Evaluation + grading

- Compute **calibration** (LogLoss/Brier) and **discrimination** metrics.
- Compute **edge summaries** by season + market.
- Apply **grading** framework (Section 10) to each opportunity.

### Phase 4 — Paper simulation + reporting

- Run monthly **flat‑stake** simulation (Section 11).
- Track ROI, hit rate, and calibration for each month.
- Review OOS stability across seasons and market types.

---

## 1) Data requirements

### A. Model outputs (per run)

For each tournament and timestamped model run:

- `event_id`, `tournament`, `season`, `run_timestamp`
- `player_id` (DataGolf ID), `player_name`
- **Outright**: `p_win` (or full finish-position distribution)
- **Match-up**: `p_playerA_over_playerB`
- **3-ball**: `p_playerA_win`, `p_playerB_win`, `p_playerC_win`

### B. Market odds (timestamped)

For the same event, with **exact timestamps**:

- `market_timestamp`
- `market_source` (DataGolf or sportsbook)
- **Outright**: `player_id`, `odds_decimal` (or American), `each_way` if applicable
- **Match-up**: `playerA_id`, `playerB_id`, `oddsA`, `oddsB`
- **3-ball**: `playerA_id`, `playerB_id`, `playerC_id`, `oddsA`, `oddsB`, `oddsC`

> If you have DataGolf historical APIs, they cover this layer directly:
>
> - **Historical Odds Data Event IDs** → lookup for event identifiers and metadata
> - **Historical Outrights** → outright odds snapshots
> - **Historical Match-Ups & 3-Balls** → matchup/3-ball odds snapshots

#### DataGolf historical odds endpoints (reference)

Use these endpoints to backfill odds snapshots and outcomes:

- **Event list (IDs + availability)**
  - `https://feeds.datagolf.com/historical-odds/event-list?tour=[tour]&file_format=[file_format]&key=...`
  - Params: `tour` (pga/euro/alt), `file_format` (json/csv)
  - Fields: `event_id`, `calendar_year`, `event_name`, and flags for `archived_preds`, `matchups`, `outrights`

- **Historical outrights**
  - `https://feeds.datagolf.com/historical-odds/outrights?tour=[tour]&event_id=[event_id]&year=[year]&market=[market]&book=[book]&odds_format=[odds_format]&file_format=[file_format]&key=...`
  - Params: `market` (win, top_5, top_10, top_20, make_cut, mc), `book` (draftkings, pinnacle, etc.), `odds_format` (decimal/american/percent/fraction)
  - Fields: `open_odds`, `open_time`, `close_odds`, `close_time`, `dg_id`, `player_name`, `outcome`, `bet_outcome_text`

- **Historical match-ups & 3-balls**
  - `https://feeds.datagolf.com/historical-odds/matchups?tour=[tour]&event_id=[event_id]&year=[year]&book=[book]&odds_format=[odds_format]&file_format=[file_format]&key=...`
  - Fields: `bet_type` (72‑hole / round matchup / 3‑ball), `p1_*`, `p2_*`, `p3_*` odds + outcomes, `tie_rule`, open/close times

#### Data ingestion checklist

- **Event list**
  - Pull event list once per tour/year.
  - Store `event_id`, `calendar_year`, `event_name`, and availability flags.
  - Use this table to validate all downstream requests.

- **Historical outrights**
  - Choose a sportsbook and market (win/top_10/top_20, etc.).
  - Request **open** and **close** odds for each event.
  - Store `open_time`, `close_time`, `open_odds`, `close_odds`, `dg_id`, `player_name`, `outcome`.
  - Decide whether you will compare against **open**, **close**, or **closest prior** snapshot.

- **Historical match‑ups / 3‑balls**
  - Choose sportsbook + odds format.
  - Capture `bet_type` to separate 72‑hole vs round markets.
  - Store `p1_*`, `p2_*`, `p3_*` odds + outcomes and `tie_rule`.
  - Normalize each pairing into a canonical key (e.g., `event_id|year|bet_type|p1_dg_id|p2_dg_id|p3_dg_id`).

- **Timestamp alignment**
  - For each model run, select the **closest prior** odds snapshot.
  - Exclude any odds updates **after** the model run time.
  - Exclude markets created **after** event start.

#### Canonical key schema (examples)

- **Outright**: `event_id|year|market|book|dg_id`
- **Match‑up (H2H)**: `event_id|year|bet_type|book|p1_dg_id|p2_dg_id`
- **3‑ball**: `event_id|year|bet_type|book|p1_dg_id|p2_dg_id|p3_dg_id`

These keys make joins deterministic across model outputs, odds snapshots, and outcomes.

#### Suggested storage layout

```text
data/
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
  model_probs/
    2025/the_masters_model_probs.csv
```

#### Naming conventions (recommended)

- **Outrights**: `{tour}/{year}/{market}/{book}.json`
- **Matchups / 3‑balls**: `{tour}/{year}/{book}.json`
- **Live snapshots**: `{tour}/{market}/latest.json` (or timestamped: `YYYYMMDD_HHMM.json`)

Keep `year` aligned to **calendar year** for historical odds endpoints.

#### DataGolf live betting APIs (reference)

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

#### Timestamping strategy (recommended)

- **Snapshot cadence**
  - Pre‑event: every 6–12 hours.
  - Tournament week: every 1–3 hours (more often on final day).
  - Store the provider’s `last_updated`/`last_update` timestamp alongside your fetch time.

- **Alignment rules**
  - For evaluation, select the **closest prior** snapshot to each model run time.
  - Exclude snapshots taken **after** the model run time.
  - For round‑based markets, store `round_num` and align to the matching round start.

- **File naming**
  - Prefer timestamps in UTC: `YYYYMMDD_HHMMZ`.
  - Example: `pga/win/20260318_1400Z.json`.

### C. Outcomes

- Event results: `finish_position`, `winner_id`
- Match-up results: `winner_id` (head-to-head)
- 3-ball results: `winner_id`

---

## 2) Alignment rules (critical)

To avoid leakage:

1. **Only compare odds snapshots taken *before* the model run time** (or same timestamp).
2. If multiple snapshots exist, prefer the **closest prior snapshot** to the model run.
3. Exclude any markets created **after** the event start.

> With historical APIs, you can enforce (1) and (2) precisely by selecting the closest prior snapshot to each model run timestamp.

---

## 3) Core evaluation metrics

### A. Calibration

- **Platt / isotonic calibration** by market type
- **Reliability curves** (binned predicted vs actual)
- **LogLoss and Brier** vs baseline (base rate)

### B. Discrimination

- ROC-AUC / PR-AUC (for binary markets)
- Spearman rank correlation (for outright ranking)

### C. Value vs implied probability

For each bet candidate:

- Convert odds → implied probability:
  
  $$
  p_{imp} = \begin{cases}
  \frac{1}{odds_{decimal}} & \text{decimal}\\
  \frac{100}{odds_{american}+100} & \text{if } odds_{american}>0\\
  \frac{-odds_{american}}{-odds_{american}+100} & \text{if } odds_{american}<0
  \end{cases}
  $$

- Compute edge:
  
  $$
  edge = p_{model} - p_{imp}
  $$

- Track **average edge**, **median edge**, and **hit rate** for positive-edge picks.

### D. Out-of-sample (OOS) stability

- Use **walk-forward** or **time-split** testing
- Report metrics by **season** and **event cluster**
- Check **variance** and **confidence intervals** of hit rates

---

## 4) Suggested minimal schema

### `model_probs.csv`

```text
run_timestamp,event_id,season,market_type,player_id,player_name,opponent_ids,p_win
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

## 5) Example evaluation flow

1. **Load** model probabilities + market odds + outcomes.
2. **Join** on `(event_id, market_type, player_id, opponent_ids)`.
3. **Filter** to odds snapshots prior to model run.
4. **Compute** implied probabilities and edge.
5. **Report** calibration + discrimination + edge summaries.
6. **Repeat** by season and market type.

---

## 6) What would convince me (technical, not wagering)

- **Consistent OOS edge** across at least 2–3 seasons.
- **Stable calibration** (LogLoss/Brier better than baseline) in OOS splits.
- **Edge survives** across market types and does not collapse by timing.
- **Robustness** to different market sources and odds snapshots.

---

## 6.5) What this does (and does not) prove

This framework can:

- Provide **statistical evidence** that your model outperforms a baseline (via OOS calibration, log loss, Brier, and stability tests).
- Identify **model‑implied value gaps** (where $p_{model} > p_{imp}$) in a purely analytical sense.

It cannot:

- Guarantee outcomes or profits.
- Remove market frictions (vig, limits, line movement, timing).
- Substitute for live, time‑aligned evaluation.

---

## 7) Practical next step

If you want, I can generate a small script to:

- build the joins,
- compute implied probabilities and edges,
- produce calibration plots and summary tables.

Just tell me the file locations and preferred market type(s).

---

## 8) How this maps to your existing validation

Based on the current validation outputs, you already have evidence for **model quality** and **probability calibration**. Here’s how it lines up:

### Already covered (✅)

- **Ranking skill**: correlations, RMSE/MAE, Top‑10/Top‑20 hit rates.
- **Probability calibration**: Platt calibration (LogLoss/Brier vs base rate).
- **Stability signals**: event‑level CV / k‑fold summaries where available.

### Not yet covered (❌)

- **Market alignment**: time‑aligned odds snapshots joined to model runs.
- **Implied probability & edge**: $p_{model} - p_{imp}$ by market type.
- **Out‑of‑sample edge stability**: walk‑forward tests on odds‑aligned edges.
- **Timing/line movement effects**: sensitivity to snapshot timing.

---

## 9) Recommended additions (if not present)

### Data & alignment

- **Historical odds snapshots** for each market type (outright, match‑up, 3‑ball).
- **Run timestamp tracking** in model outputs (so we can pick the closest prior odds snapshot).
- **Outcome mapping** for each market type (winner/finish position by pairing).

### Evaluation

- **Edge summary tables**: average/median edge, hit‑rate for positive‑edge picks.
- **Reliability curves** by market type (decile bins).
- **OOS stability**: walk‑forward windows (e.g., rolling seasons).

### Risk controls (technical)

- **Leakage audits**: exclude any odds snapshots after model run time.
- **Sensitivity analysis**: test how edge changes with different snapshot cutoffs.

---

## 10) Opportunity grading (technical)

Define a neutral grading score that combines **edge**, **calibration confidence**, and **stability**:

1. **Edge**

  $$
  edge = p_{model} - p_{imp}
  $$

1. **Normalized edge**

  $$
  edge_z = \frac{edge}{\sigma_{edge}}
  $$

1. **Calibration confidence** (example)

  $$
  conf = 1 + \alpha \cdot (baseline\_brier - model\_brier)
  $$

1. **Stability score** (example)

  $$
  stability = \frac{mean\_edge}{stdev\_edge}
  $$

1. **Composite grade**

  $$
  grade = 0.5 \cdot edge\_score + 0.3 \cdot conf + 0.2 \cdot stability
  $$

Suggested buckets:

- **A**: $\ge 0.80$
- **B**: $0.65$–$0.79$
- **C**: $0.50$–$0.64$
- **D**: $< 0.50$

---

## 11) Weekly simulation (paper‑tracking only)

> **Important:** This is a *paper simulation* to evaluate statistical performance. It is not wagering advice.

### Rule

- For **every opportunity where** $p_{model} > p_{imp}$, record a **fixed 10‑unit stake**.
- Evaluate results **at week‑end**.

### What to record per opportunity

- `event_id`, `market_type`, `book`, `timestamp`
- `p_model`, `p_imp`, `edge`, `edge_z`, `grade`
- `stake` (fixed at 10)
- `odds` (decimal)
- `outcome` (win/loss/push)

### Weekly summary metrics

- **Total stake** (count × 10)
- **Total return** (sum of payouts)
- **Net** (return − stake)
- **ROI**: $\frac{net}{total\_stake}$
- **Hit rate** (wins / total)
- **Calibration checks** (LogLoss/Brier for the week)

### Notes

- Keep the simulation **time‑aligned** (only odds snapshots before model run time).
- Track **edge distribution** by market type (outright vs matchup vs 3‑ball).
