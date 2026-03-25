# LOCAL_EXECUTION

## Local execution (macOS) — recommended setup

This project runs cleanly on macOS using **Node.js LTS**. I recommend keeping the repo at:

- `~/Projects/modelOptimizer`

### Required software

- **Node.js LTS** (see this repo’s `.nvmrc` or `package.json` `engines` field for the supported version)
- **Git**
- **VS Code** (optional)

### One‑time setup (local)

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
