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
#   - Output is written to the optimizer log path (computed via outputPaths).
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
RUN_CONTEXT="run"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--event|--eventId)
			EVENT_ID="$2"; shift 2 ;;
		--season|--year)
			SEASON="$2"; shift 2 ;;
		--name|--tournament)
			TOURNAMENT_NAME="$2"; shift 2 ;;
		--post)
			EXTRA_FLAGS="$EXTRA_FLAGS $1"; RUN_CONTEXT="post_event"; shift ;;
		--pre)
			EXTRA_FLAGS="$EXTRA_FLAGS $1"; RUN_CONTEXT="pre_event"; shift ;;
		--dryRun|--log|--writeTemplates|--writeValidationTemplates)
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
# Prepare log directory (computed to match optimizer logging)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

compute_log_file() {
	local seed_value="$1"
	ROOT_DIR="$ROOT_DIR" EVENT_ID="$EVENT_ID" SEASON="$SEASON" TOURNAMENT_NAME="$TOURNAMENT_NAME" RUN_CONTEXT="$RUN_CONTEXT" OPT_SEED="$seed_value" \
		node - <<'NODE'
const path = require('path');

const rootDir = process.env.ROOT_DIR || process.cwd();
const eventId = process.env.EVENT_ID || '';
const season = process.env.SEASON || '';
const tournamentName = process.env.TOURNAMENT_NAME || '';
const runContext = process.env.RUN_CONTEXT || 'run';
const optSeedRaw = process.env.OPT_SEED || '';
const outputTagRaw = String(process.env.OUTPUT_TAG || '').trim();
const kfoldRaw = process.env.EVENT_KFOLD_K;

const { resolveTournamentRoot, resolveModeRoot } = require(path.resolve(rootDir, 'utilities', 'outputPaths'));
const { resolveKFoldTag } = require(path.resolve(rootDir, 'utilities', 'kfoldTag'));

const sanitize = value => String(value || '')
	.toLowerCase()
	.replace(/\s+/g, '_')
	.replace(/[^a-z0-9_\-]/g, '')
	.replace(/^_+|_+$/g, '');

const tournamentRoot = resolveTournamentRoot({
	workspaceRoot: rootDir,
	dataRoot: path.resolve(rootDir, 'data'),
	season,
	tournamentName,
	tournamentSlug: null
});
const modeRoot = resolveModeRoot({ tournamentRoot, mode: runContext });
const loggingDir = modeRoot || path.resolve(rootDir, 'data');

const safeEvent = sanitize(tournamentName || eventId || 'event') || 'event';
const seedSuffix = optSeedRaw
	? `_seed-${sanitize(optSeedRaw)}`
	: '';
const outputTagSuffix = outputTagRaw
	? `_${sanitize(outputTagRaw)}`
	: '';
const kfoldTag = resolveKFoldTag(kfoldRaw);
const kfoldTagSuffix = (runContext === 'post_event' && !optSeedRaw)
	? `_${String(kfoldTag.tag || 'LOEO')}`
	: '';

const logContext = `${runContext}${seedSuffix}${kfoldTagSuffix}${outputTagSuffix}`;
const logFile = path.resolve(loggingDir, `${safeEvent}_${logContext}_log.txt`);
console.log(logFile);
NODE
}

# ---------------------------------------------------------------------------
# Build and launch the command(s)
# ---------------------------------------------------------------------------
if [[ -z "$SEEDS" ]]; then
	LOG_FILE="$(compute_log_file "")"
	mkdir -p "$(dirname "$LOG_FILE")"
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
		LOG_FILE="$(compute_log_file "$S")"
		mkdir -p "$(dirname "$LOG_FILE")"
		# Each seed runs sequentially; a failure stops the chain (|| exit 1)
		SEED_CMDS="${SEED_CMDS}echo '=== Seed ${S} ==='; OPT_SEED='${S}' node \"$ROOT_DIR/core/optimizer.js\" --event \"$EVENT_ID\" --season \"$SEASON\" --name \"$TOURNAMENT_NAME\"$EXTRA_FLAGS > \"${LOG_FILE}\" 2>&1 || exit 1; "
	done
	SEED_CMDS="${SEED_CMDS}echo 'All seeds complete.'"

	echo "Starting multi-seed optimizer run (seeds: $SEEDS) in the background..."
	echo "  Logs: (per seed)"
	# shellcheck disable=SC2086
	nohup bash -c "$SEED_CMDS" > /dev/null 2>&1 &
	PID=$!
	echo "  PID: $PID"
	echo ""
	echo "Follow progress: tail -f <seed-log>"
	echo "Check if running: kill -0 $PID 2>/dev/null && echo running || echo done"
fi
