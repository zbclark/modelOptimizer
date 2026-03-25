#!/usr/bin/env bash
# run_background.sh
# Runs the optimizer detached from the terminal using nohup so you can safely
# close your terminal without killing the process.
#
# Usage:
#   bash scripts/run_background.sh \
#     --event <EVENT_ID> \
#     --season <SEASON> \
#     --name "<TOURNAMENT_NAME>" \
#     [--post] \
#     [--seeds a,b,c,d,e]
#
# Notes:
#   - Output is written to logs/optimizer_<event>_<timestamp>.log
#   - Closing your computer (suspend/shutdown) will still stop the process.
#     Run on a remote machine or inside a tmux session if you need the run
#     to persist across a sleep or shutdown.

set -euo pipefail

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
EVENT_ID=""
SEASON=""
TOURNAMENT_NAME=""
EXTRA_FLAGS=""
SEEDS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --event|--eventId)
      EVENT_ID="$2"; shift 2 ;;
    --season|--year)
      SEASON="$2"; shift 2 ;;
    --name|--tournament)
      TOURNAMENT_NAME="$2"; shift 2 ;;
    --post|--pre|--dryRun|--log|--writeTemplates|--writeValidationTemplates)
      EXTRA_FLAGS="$EXTRA_FLAGS $1"; shift ;;
    --seeds)
      SEEDS="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$EVENT_ID" || -z "$SEASON" || -z "$TOURNAMENT_NAME" ]]; then
  echo "Usage: bash scripts/run_background.sh --event <EVENT_ID> --season <SEASON> --name \"<TOURNAMENT_NAME>\" [--post] [--seeds a,b,c,d,e]"
  exit 1
fi

# ---------------------------------------------------------------------------
# Prepare log directory
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
# Lowercase, replace non-alphanumeric runs with underscores, strip leading/trailing underscores
SAFE_NAME="$(echo "$TOURNAMENT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_' | sed 's/^_*//;s/_*$//')"
LOG_FILE="$LOG_DIR/optimizer_${EVENT_ID}_${SAFE_NAME}_${TIMESTAMP}.log"

# ---------------------------------------------------------------------------
# Build and launch the command(s)
# ---------------------------------------------------------------------------
if [[ -z "$SEEDS" ]]; then
  CMD="node \"$ROOT_DIR/core/optimizer.js\" --event \"$EVENT_ID\" --season \"$SEASON\" --name \"$TOURNAMENT_NAME\"$EXTRA_FLAGS"
  echo "Starting optimizer in the background..."
  echo "  Log: $LOG_FILE"
  # shellcheck disable=SC2086
  nohup bash -c "$CMD" > "$LOG_FILE" 2>&1 &
  PID=$!
  echo "  PID: $PID"
  echo ""
  echo "Follow progress: tail -f \"$LOG_FILE\""
  echo "Check if running: kill -0 $PID 2>/dev/null && echo running || echo done"
else
  # Multi-seed run: iterate seeds sequentially inside a single nohup shell
  IFS=',' read -ra SEED_LIST <<< "$SEEDS"
  SEED_CMDS=""
  for S in "${SEED_LIST[@]}"; do
    S="$(echo "$S" | tr -d ' ')"
    # Each seed runs sequentially; a failure stops the chain (|| exit 1)
    SEED_CMDS="${SEED_CMDS}echo '=== Seed ${S} ==='; OPT_SEED='${S}' node \"$ROOT_DIR/core/optimizer.js\" --event \"$EVENT_ID\" --season \"$SEASON\" --name \"$TOURNAMENT_NAME\"$EXTRA_FLAGS || exit 1; "
  done
  SEED_CMDS="${SEED_CMDS}echo 'All seeds complete.'"

  echo "Starting multi-seed optimizer run (seeds: $SEEDS) in the background..."
  echo "  Log: $LOG_FILE"
  # shellcheck disable=SC2086
  nohup bash -c "$SEED_CMDS" > "$LOG_FILE" 2>&1 &
  PID=$!
  echo "  PID: $PID"
  echo ""
  echo "Follow progress: tail -f \"$LOG_FILE\""
  echo "Check if running: kill -0 $PID 2>/dev/null && echo running || echo done"
fi
