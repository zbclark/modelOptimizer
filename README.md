# modelOptimizer

Node-based optimizer for tournament ranking validation, weighting, and post-event analysis. The core pipeline lives in `core/optimizer.js` and emits artifacts under `data/`.

## Documentation

- `MODEL_VALIDATION_AND_OPTIMIZATION.md` — main workflow reference (pre/post modes, inputs, outputs, and validation logic).
- `API_ONLY_PRE_EVENT_CHECKLIST.md` — API-only run checklist (no CSV inputs).
- `utilities-audit.md` — audit findings and refactoring notes.
- `utilities/sheets/PLAYER_RANKING_MODEL_SHEETS_FORMATTING.md` — ranking sheet formatting contract.

## Key entry points

- `core/optimizer.js` — end-to-end optimizer pipeline.
- `core/validationRunner.js` — validation + reporting outputs.
- `scripts/summarizeSeedResults.js` — seed run summary helper.
- `scripts/update_readme_last_updated.js` — README timestamp updater.

---

*Last updated: [date]*
