from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from radar_pipeline import config
from scripts.export_radar_previews import export_radar_previews
from scripts.radar_v0 import run as evaluate_radar


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2, allow_nan=False)
        file.write("\n")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-evaluate the latest validated market snapshot with current Radar rules.")
    parser.add_argument("--rules", type=Path, default=config.RULES_PATH)
    args = parser.parse_args()

    previous = load_json(config.PUBLIC_RADAR_PATH)
    required = (config.DATABASE_PATH, config.LISTING_PATH, config.EVENTS_PATH)
    missing = [path.name for path in required if not path.exists()]
    if missing:
        raise RuntimeError(f"Validated market snapshot is incomplete: {', '.join(missing)}")
    if previous.get("status") != "ok" or not previous.get("source_status"):
        raise RuntimeError("The latest published Radar is not a validated full-market run")

    payload = evaluate_radar(
        SimpleNamespace(
            database=config.DATABASE_PATH,
            listing_csv=config.LISTING_PATH,
            events_json=config.EVENTS_PATH,
            rules=args.rules,
            as_of=previous.get("as_of"),
        )
    )
    evaluated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    base_run_id = re.sub(r"(?:_rules_v\d+)+$", "", previous["run_id"])
    payload.update(
        {
            "run_id": f"{base_run_id}_rules_{payload['rule_version'].split('.')[-1]}",
            "generated_at": evaluated_at,
            "source_generated_at": previous.get("source_generated_at") or previous.get("generated_at"),
            "status": "ok",
            "scope_label": "KOSPI·KOSDAQ 전체시장 최신 실행",
            "source_status": previous["source_status"],
        }
    )
    payload["summary"]["evaluated_universe_count"] = payload["summary"]["standard_eligible_count"]
    covered_financials = previous.get("source_status", {}).get("dart_financials", {}).get("covered_count")
    if isinstance(covered_financials, int):
        payload["summary"]["financial_coverage_count"] = covered_financials
    for key in ("price_target_count", "fresh_price_count"):
        if key in previous.get("summary", {}):
            payload["summary"][key] = previous["summary"][key]
    export_radar_previews(payload)
    write_json(config.INTERNAL_RADAR_PATH, payload)
    write_json(config.PUBLIC_RADAR_PATH, payload)
    print(
        f"Radar rules re-evaluated: {payload['summary']['candidate_unique_count']} candidates / "
        f"{payload['rule_version']} / source {payload['source_generated_at']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
