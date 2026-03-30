#!/usr/bin/env python3
"""Verify Phase outputs (pre/post/validation) with tagged filenames + report-style CSVs.

Notes:
- Pre-event headers allow median-annotated Delta Trend/Predictive columns.
- Validation CSVs are report-style; we only verify file existence and locate section headers.
- Wagering outputs are intentionally ignored (odds point/current can differ).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import argparse
import csv
import json
import subprocess
import re
from typing import Iterable, List, Optional

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class CheckResult:
    label: str
    ok: bool
    detail: str


def run_node_schema_probe() -> dict:
    node_script = r"""
const { getRankingFormattingSchema } = require('./utilities/rankingFormattingSchema');
const { buildResultsMetricSpecs } = require('./utilities/tournamentResultsCsv');
const rankingSchema = getRankingFormattingSchema();
const preHeaders = [rankingSchema.notesColumnHeader, ...rankingSchema.columns.map(col => col.name)];
const metricHeaders = buildResultsMetricSpecs().map(spec => spec.label);
const postHeaders = [
  'Performance Notes',
  'DG ID',
  'Player Name',
  'Finish Position',
  'Model Rank',
  ...metricHeaders.flatMap(label => [`${label} (Actual)`, `${label} (Model)`])
];
console.log(JSON.stringify({ preHeaders, postHeaders }));
"""
    output = subprocess.check_output(["node", "-e", node_script], cwd=str(ROOT))
    return json.loads(output.decode("utf-8"))


def find_header_row(file_path: Path, required_keys: Iterable[str]) -> Optional[List[str]]:
    if not file_path or not file_path.exists():
        return None
    with file_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        for row in reader:
            normalized = [str(cell).strip() for cell in row]
            if all(key in normalized for key in required_keys):
                return normalized
    return None


def read_csv_rows(file_path: Path) -> List[List[str]]:
    if not file_path or not file_path.exists():
        return []
    with file_path.open(newline="", encoding="utf-8") as handle:
        return [list(map(lambda v: str(v).strip(), row)) for row in csv.reader(handle)]


def latest_by_suffix(directory: Path, suffix: str) -> Optional[Path]:
    candidates = sorted(directory.glob(f"*{suffix}"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def latest_results_artifact(directory: Path, ext: str, tag: Optional[str] = None) -> Optional[Path]:
    if not directory or not directory.exists():
        return None
    candidates = []
    tag_value = tag.lower() if tag else None
    for path in directory.glob(f"*{ext}"):
        name = path.name.lower()
        if "_results" not in name:
            continue
        if "post_event_results" in name:
            continue
        if tag_value and tag_value not in name:
            continue
        candidates.append(path)
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def latest_post_event_results(directory: Path, ext: str, tag: Optional[str] = None) -> Optional[Path]:
    if not directory or not directory.exists():
        return None
    candidates = []
    tag_value = tag.lower() if tag else None
    for path in directory.glob(f"*post_event_results.{ext}"):
        name = path.name.lower()
        if tag_value and tag_value not in name:
            continue
        candidates.append(path)
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def normalize_delta_header(header: str) -> str:
    if header.startswith("Delta Trend Score ("):
        return "Delta Trend Score"
    if header.startswith("Delta Predictive Score ("):
        return "Delta Predictive Score"
    return header


def normalize_pre_headers(headers: List[str]) -> List[str]:
    return [normalize_delta_header(h) for h in headers]


def check_pre_event(pre_dir: Path, expected_pre_headers: List[str]) -> List[CheckResult]:
    results: List[CheckResult] = []
    pre_csv = latest_by_suffix(pre_dir, "_pre_event_rankings.csv")
    pre_json = latest_by_suffix(pre_dir, "_pre_event_rankings.json")
    signal_json = latest_by_suffix(pre_dir, "_signal_contributions.json")

    results.append(CheckResult("pre_event_rankings.csv", bool(pre_csv), str(pre_csv or "missing")))
    results.append(CheckResult("pre_event_rankings.json", bool(pre_json), str(pre_json or "missing")))
    results.append(CheckResult("signal_contributions.json", bool(signal_json), str(signal_json or "missing")))

    if pre_csv:
        actual_headers = find_header_row(pre_csv, ["DG ID", "Player Name"]) or []
        normalized_actual = normalize_pre_headers(actual_headers)
        normalized_expected = normalize_pre_headers(expected_pre_headers)
        ok = normalized_actual == normalized_expected
        detail = "OK" if ok else "MISMATCH"
        results.append(CheckResult("pre_event_schema", ok, detail))
    else:
        results.append(CheckResult("pre_event_schema", False, "missing pre-event CSV"))

    return results


def check_post_event(post_dir: Path, expected_post_headers: List[str]) -> List[CheckResult]:
    results: List[CheckResult] = []
    results_csv = latest_results_artifact(post_dir, ".csv")
    results_json = latest_results_artifact(post_dir, ".json")
    post_event_json = latest_post_event_results(post_dir, "json")

    results.append(CheckResult("results.csv", bool(results_csv), str(results_csv or "missing")))
    results.append(CheckResult("results.json", bool(results_json), str(results_json or "missing")))
    results.append(CheckResult("post_event_results.json", bool(post_event_json), str(post_event_json or "missing")))

    if results_csv:
        actual_headers = find_header_row(results_csv, ["Performance Notes", "DG ID", "Player Name"]) or []
        ok = actual_headers == expected_post_headers
        detail = "OK" if ok else "MISMATCH"
        results.append(CheckResult("post_event_schema", ok, detail))
    else:
        results.append(CheckResult("post_event_schema", False, "missing results CSV"))

    return results


def check_validation(val_dir: Path) -> List[CheckResult]:
    results: List[CheckResult] = []
    calibration_csv = val_dir / "Calibration_Report.csv"
    calibration_json = val_dir / "Calibration_Report.json"
    weight_csv = val_dir / "Weight_Templates.csv"
    weight_json = val_dir / "Weight_Templates.json"
    season_summary_csv = val_dir / "season_summaries" / "Season_Post_Event_Summary.csv"
    season_summary_json = val_dir / "season_summaries" / "Season_Post_Event_Summary.json"

    for label, path in [
        ("Calibration_Report.csv", calibration_csv),
        ("Calibration_Report.json", calibration_json),
        ("Weight_Templates.csv", weight_csv),
        ("Weight_Templates.json", weight_json),
        ("Season_Post_Event_Summary.csv", season_summary_csv),
        ("Season_Post_Event_Summary.json", season_summary_json),
    ]:
        results.append(CheckResult(label, path.exists(), str(path if path.exists() else "missing")))

    def detect_report_style(file_path: Path, keywords: Iterable[str]) -> bool:
        if not file_path.exists():
            return False
        rows = read_csv_rows(file_path)
        if not rows:
            return False
        flat = "\n".join(",".join(row) for row in rows)
        return any(keyword.lower() in flat.lower() for keyword in keywords)

    # Report-style CSV sanity: accept header row OR report-style keywords.
    if calibration_csv.exists():
        header_row = find_header_row(calibration_csv, ["season", "event_id"])
        report_ok = detect_report_style(calibration_csv, ["calibration", "template", "metric", "correlation"])
        ok = header_row is not None or report_ok
        detail = "OK" if ok else "no header row or report keywords found"
        results.append(CheckResult("Calibration_Report.csv section header", ok, detail))

    if season_summary_csv.exists():
        header_row = find_header_row(season_summary_csv, ["Season", "Event ID"])
        report_ok = detect_report_style(season_summary_csv, ["season", "summary", "template", "kfold", "top 20"])
        ok = header_row is not None or report_ok
        detail = "OK" if ok else "no header row or report keywords found"
        results.append(CheckResult("Season_Post_Event_Summary.csv section header", ok, detail))

    return results


def print_results(title: str, items: List[CheckResult]) -> None:
    print(f"\n{title}:")
    for item in items:
        status = "OK" if item.ok else "MISSING"
        if item.label.endswith("schema") or "section header" in item.label:
            status = "OK" if item.ok else "MISMATCH"
        print(f"- {item.label}: {status} ({item.detail})")


def extract_run_mode_signature(log_path: Path) -> List[str]:
    if not log_path.exists():
        return []
    patterns = [
        r"Forced pre-tournament mode",
        r"Forced post-tournament mode",
        r"Missing required mode flag",
        r"Skipping course history regression",
        r"Skipping early-season ramp summary",
        r"Pre-tournament override active",
        r"No results found for the current season/event",
        r"Post-tournament mode",
        r"Pre-tournament mode"
    ]
    regex = re.compile("|".join(patterns))
    lines = []
    try:
        for line in log_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if regex.search(line):
                lines.append(line.strip())
    except Exception:
        return []
    return lines


def compare_run_mode_logs(pre_dir: Path, post_dir: Path, phase_tag: str) -> List[CheckResult]:
    results: List[CheckResult] = []

    def latest_with_tag(directory: Path, tag: str, suffix: str) -> Optional[Path]:
        candidates = sorted(
            directory.glob(f"*{tag}*{suffix}"),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
        return candidates[0] if candidates else None

    checks = [
        ("pre_event", pre_dir, "pre_event_log.txt"),
        ("post_event", post_dir, "post_event_log.txt")
    ]

    for label, directory, suffix in checks:
        phase1_log = latest_with_tag(directory, "phase1", suffix)
        phase_target_log = latest_with_tag(directory, phase_tag, suffix)

        if not phase1_log or not phase_target_log:
            results.append(CheckResult(
                f"run_mode_{label}",
                False,
                f"missing phase1/{phase_tag} logs ({phase1_log or 'none'} / {phase_target_log or 'none'})"
            ))
            continue

        sig1 = extract_run_mode_signature(phase1_log)
        sig2 = extract_run_mode_signature(phase_target_log)
        ok = sig1 == sig2
        detail = "OK" if ok else f"differs (phase1={sig1} {phase_tag}={sig2})"
        results.append(CheckResult(f"run_mode_{label}", ok, detail))

    return results


def compare_phase_outputs(
    pre_dir: Path,
    post_dir: Path,
    expected_post_headers: List[str],
    phase_tag: str
) -> List[CheckResult]:
    results: List[CheckResult] = []

    def latest_with_tag(directory: Path, tag: str, suffix: str) -> Optional[Path]:
        candidates = sorted(
            directory.glob(f"*{tag}*{suffix}"),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
        return candidates[0] if candidates else None

    phase1_pre_csv = latest_with_tag(pre_dir, "phase1", "_pre_event_rankings.csv")
    phase_target_pre_csv = latest_with_tag(pre_dir, phase_tag, "_pre_event_rankings.csv")
    phase1_pre_json = latest_with_tag(pre_dir, "phase1", "_pre_event_rankings.json")
    phase_target_pre_json = latest_with_tag(pre_dir, phase_tag, "_pre_event_rankings.json")

    phase1_post_csv = latest_results_artifact(post_dir, ".csv", "phase1")
    phase_target_post_csv = latest_results_artifact(post_dir, ".csv", phase_tag)
    shared_post_csv = latest_results_artifact(post_dir, ".csv")
    phase1_post_json = latest_post_event_results(post_dir, "json", "phase1")
    phase_target_post_json = latest_post_event_results(post_dir, "json", phase_tag)

    for label, phase1_path, phase4_path in [
        ("phase1_pre_event_rankings.csv", phase1_pre_csv, phase_target_pre_csv),
        ("phase1_pre_event_rankings.json", phase1_pre_json, phase_target_pre_json),
        ("phase1_post_event_results.csv", phase1_post_csv or shared_post_csv, phase_target_post_csv or shared_post_csv),
        ("phase1_post_event_results.json", phase1_post_json, phase_target_post_json),
    ]:
        ok = bool(phase1_path and phase4_path)
        detail = "OK" if ok else f"missing (phase1={phase1_path or 'none'}, {phase_tag}={phase4_path or 'none'})"
        results.append(CheckResult(label, ok, detail))

    if phase1_pre_csv and phase_target_pre_csv:
        header1 = find_header_row(phase1_pre_csv, ["DG ID", "Player Name"]) or []
        header4 = find_header_row(phase_target_pre_csv, ["DG ID", "Player Name"]) or []
        ok = normalize_pre_headers(header1) == normalize_pre_headers(header4)
        detail = "OK" if ok else "MISMATCH"
        results.append(CheckResult(f"phase1_vs_{phase_tag}_pre_event_schema", ok, detail))
    else:
        results.append(CheckResult(f"phase1_vs_{phase_tag}_pre_event_schema", False, "missing pre-event CSV"))

    if phase1_post_csv and phase_target_post_csv:
        header1 = find_header_row(phase1_post_csv, ["Performance Notes", "DG ID", "Player Name"]) or []
        header4 = find_header_row(phase_target_post_csv, ["Performance Notes", "DG ID", "Player Name"]) or []
        ok = header1 == header4
        detail = "OK" if ok else "MISMATCH"
        results.append(CheckResult(f"phase1_vs_{phase_tag}_post_event_schema", ok, detail))
    elif shared_post_csv:
        header = find_header_row(shared_post_csv, ["Performance Notes", "DG ID", "Player Name"]) or []
        ok = header == expected_post_headers
        detail = "OK (untagged results.csv)" if ok else "MISMATCH"
        results.append(CheckResult(f"phase1_vs_{phase_tag}_post_event_schema", ok, detail))
    else:
        results.append(CheckResult(f"phase1_vs_{phase_tag}_post_event_schema", False, "missing post-event CSV"))

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify phase outputs (pre/post/validation).")
    parser.add_argument("--season", default="2026", help="Season year (default: 2026)")
    parser.add_argument("--tournament-slug", default="the-players", help="Tournament slug (default: the-players)")
    parser.add_argument("--check-run-modes", action="store_true", help="Compare run-mode decisions between phase1 and phase2 logs")
    parser.add_argument("--compare-phase1", action="store_true", help="Compare latest phase1 vs phase4 outputs for schema parity")
    parser.add_argument("--compare-phase5", action="store_true", help="Compare latest phase1 vs phase5 outputs for schema parity")
    parser.add_argument("--compare-phase6", action="store_true", help="Compare latest phase1 vs phase6 outputs for schema parity")
    parser.add_argument("--compare-phase7", action="store_true", help="Compare latest phase1 vs phase7 outputs for schema parity")
    parser.add_argument(
        "--run-mode-phase",
        default=None,
        choices=["phase2", "phase4", "phase5", "phase6", "phase7"],
        help="Phase tag to compare against phase1 for run-mode checks (default: phase2)."
    )
    args = parser.parse_args()

    schema = run_node_schema_probe()
    expected_pre = schema["preHeaders"]
    expected_post = schema["postHeaders"]

    pre_dir = ROOT / "data" / args.season / args.tournament_slug / "pre_event"
    post_dir = ROOT / "data" / args.season / args.tournament_slug / "post_event"
    val_dir = ROOT / "data" / args.season / "validation_outputs"

    results = []
    results.extend(check_pre_event(pre_dir, expected_pre))
    results.extend(check_post_event(post_dir, expected_post))
    results.extend(check_validation(val_dir))

    run_mode_results: List[CheckResult] = []
    if args.check_run_modes:
        if args.run_mode_phase:
            phase_tag = args.run_mode_phase
        elif args.compare_phase7:
            phase_tag = "phase7"
        elif args.compare_phase6:
            phase_tag = "phase6"
        elif args.compare_phase5:
            phase_tag = "phase5"
        elif args.compare_phase1:
            phase_tag = "phase4"
        else:
            phase_tag = "phase2"
        run_mode_results = compare_run_mode_logs(pre_dir, post_dir, phase_tag)
        results.extend(run_mode_results)

    phase1_results: List[CheckResult] = []
    if args.compare_phase1:
        phase1_results = compare_phase_outputs(pre_dir, post_dir, expected_post, "phase4")
        results.extend(phase1_results)

    phase5_results: List[CheckResult] = []
    if args.compare_phase5:
        phase5_results = compare_phase_outputs(pre_dir, post_dir, expected_post, "phase5")
        results.extend(phase5_results)

    phase6_results: List[CheckResult] = []
    if args.compare_phase6:
        phase6_results = compare_phase_outputs(pre_dir, post_dir, expected_post, "phase6")
        results.extend(phase6_results)

    phase7_results: List[CheckResult] = []
    if args.compare_phase7:
        phase7_results = compare_phase_outputs(pre_dir, post_dir, expected_post, "phase7")
        results.extend(phase7_results)

    print_results("Pre-event checks", results[0:4])
    print_results("Post-event checks", results[4:7])
    print_results("Validation checks", results[7:])
    if run_mode_results:
        print_results("Run-mode checks", run_mode_results)
    if phase1_results:
        print_results("Phase1 parity checks", phase1_results)
    if phase5_results:
        print_results("Phase5 parity checks", phase5_results)
    if phase6_results:
        print_results("Phase6 parity checks", phase6_results)
    if phase7_results:
        print_results("Phase7 parity checks", phase7_results)

    failures = [item for item in results if not item.ok]
    if failures:
        print("\nSummary: ❌ One or more checks failed.")
        return 1
    print("\nSummary: ✅ All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
