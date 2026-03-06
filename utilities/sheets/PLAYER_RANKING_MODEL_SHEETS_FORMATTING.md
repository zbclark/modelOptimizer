# Player Ranking Model — Google Sheets Formatting (Bound Script)

This repo generates a **formatting schema** for the *Player Ranking Model* rankings output.

- Schema source of truth (Node): `utilities/rankingFormattingSchema.js`
- Generated artifacts:
  - `utilities/sheets/ranking_formatting_schema.json`
  - `utilities/sheets/ranking_formatting_schema.csv`

> This formatter acts as a **standalone library** by storing schema JSON files in Google Drive and referencing them by file ID. The bound script dynamically fetches schemas at runtime.

---

## 1) Sheet layout assumptions

The schema currently assumes:

- Sheet name: **"Player Ranking Model"**
- Notes column: **A**
- Table starts: **B** (Rank at **B5**)
- Header row: **5**
- Median row: **4** (synthetic row inserted by Node export)
- Player rows start: **6**

These are encoded in `ranking_formatting_schema.json`:

- `headerRow = 5`
- `medianRow = 4`
- `dataStartRow = 6`
- `conditionalFormattingStartRow = 6` (important: median row excluded)

---

## 2) Add the bound formatter

1. In the Google Sheet: **Extensions → Script editor**
2. Create a new script file (e.g. `PlayerRankingModelFormatter.bound.gs`)
3. Copy/paste the contents of:

   `utilities/sheets/PlayerRankingModelFormatter.bound.gs`

4. **Important:** The script references schema JSON files stored in Google Drive:
   - Ranking schema: `RANKING_FORMATTING_SCHEMA_FILE_ID = '1cph5kQftNPZp-Cd2J7pwR0Kl_b5jEiZY'`
   - Tournament Results schema: `TOURNAMENT_RESULTS_FORMATTING_SCHEMA_FILE_ID = '1B0-F7qx1ipQLY7ELFBgV1KgIHWV7cf_E'`

   These file IDs must match the schema JSON files uploaded to Drive.

5. Reload the spreadsheet.

You should see a menu: **🏌️ Golf Model Menu**

- **🎨 Format Player Ranking Model**
- **🎯 Format Tournament Results**

---

## 3) What the formatter does

- Sets column widths from schema (including Notes = 350px)
- Styles header row (row 5)
- Styles the **MEDIAN** row (row 4) light blue
- Coerces imported numeric strings (including percent strings like `"12.3%"`) to actual numbers
- Applies number formats per column
- Replaces conditional formatting rules for the sheet with:
  - **Grey background** for `zeroAsNoData` columns *only* (prevents blanks being grey)
  - **Z-score-based coloring** for columns with `zScoreColoring: true` (computed from raw values)
  - **Trend coloring** for columns with `trend: true`

---

## 4) Slicer setup (recommended)

If you want interactive filtering (e.g., show only players above the median for some columns):

1. Select the table range starting at the header row (row 5). Include Notes column A.
2. **Data → Add a slicer**
3. In the slicer panel:
   - Choose the column to filter (e.g., `SG Total`, `WAR`, `Delta Predictive Score`)
   - Filter by condition:
     - **Greater than** a threshold, or
     - Use **Filter by values** and deselect blanks

### Tip: filtering vs median row

- Because MEDIAN is on row 4, most slicers will include it if you include the full table.
- Best practice: set your slicer range to start at **row 5** (the header) but consider excluding row 4 if you don't want MEDIAN appearing in filtered results.

---

## 5) Common gotchas

- **If everything is a string:** Conditional formatting won’t behave until values are numeric. The formatter includes a coercion pass.
- **If blanks turn grey:** Grey is only applied where `zeroAsNoData` is true, and the rule uses `ISNUMBER(...)` so blanks should stay blank.
- **If the sheet is named differently:** Rename the sheet manually to match `schema.sheetName` or the formatter will rename it automatically.

---

## 6) Updating the schema

If you change `rankingFormattingSchema.js` (e.g. add/remove columns or change row positions):

1. Re-run the generator:
   - `scripts/generate_ranking_formatting_output.js`
2. Re-upload the updated JSON files to Google Drive (replacing the existing files at the same file IDs).
3. The bound script will automatically fetch the latest schema on next run.
