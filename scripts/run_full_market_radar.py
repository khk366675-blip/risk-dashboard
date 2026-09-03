from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pandas as pd
from dotenv import load_dotenv

from radar_pipeline import config
from radar_pipeline.dart import (
    DartClient,
    event_source_payload,
    parse_full_enrichment,
    parse_major_quarters,
)
from radar_pipeline.market import (
    collect_price_histories,
    collect_universe,
    completed_market_date,
    is_common_equity,
    load_price_checkpoint,
    median_traded_value,
    save_price_checkpoint,
)
from radar_pipeline.storage import connect_database, insert_many, optimize
from scripts.export_radar_previews import export_radar_previews
from scripts.radar_v0 import run as evaluate_radar


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def load_rule_config() -> dict[str, Any]:
    with config.RULES_PATH.open(encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2, allow_nan=False)
        file.write("\n")
    for attempt in range(8):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.1 * (attempt + 1))


def listing_market_cap(row: pd.Series, price_rows: list[dict[str, Any]] | None) -> int | None:
    shares = finite(row.get("Stocks"))
    if price_rows and shares and price_rows[-1].get("close"):
        return int(float(price_rows[-1]["close"]) * shares)
    raw = finite(row.get("Marcap"))
    return int(raw) if raw is not None else None


def latest_quarters(quarters: list[dict[str, Any]], count: int = 4) -> list[dict[str, Any]]:
    return quarters[-count:] if quarters else []


def aggregate_valuation(
    market_cap: int | None,
    quarters: list[dict[str, Any]],
    updated_at: str,
) -> dict[str, Any]:
    recent = latest_quarters(quarters, 4)

    def total(metric: str) -> float | None:
        values = [finite(quarter.get(metric)) for quarter in recent]
        return sum(value for value in values if value is not None) if len(values) == 4 and all(value is not None for value in values) else None

    ttm_rev = total("rev")
    ttm_op = total("op")
    ttm_ni = total("ni")
    ttm_ocf = total("ocf")
    interest = total("interest_exp")
    latest = recent[-1] if recent else {}
    equity = finite(latest.get("equity"))
    debt = finite(latest.get("debt"))
    cash = finite(latest.get("cash"))
    financial_debt = finite(latest.get("fin_debt"))

    roe = ttm_ni / equity if ttm_ni is not None and equity and equity > 0 else None
    debt_ratio = debt / equity if debt is not None and equity and equity > 0 else None
    interest_coverage = ttm_op / interest if ttm_op is not None and interest and interest > 0 else None
    per = market_cap / ttm_ni if market_cap and ttm_ni and ttm_ni > 0 else None
    pbr = market_cap / equity if market_cap and equity and equity > 0 else None
    ev_ebitda = None
    if market_cap and ttm_op and ttm_op > 0 and financial_debt is not None and cash is not None:
        enterprise_value = market_cap + financial_debt - cash
        ev_ebitda = enterprise_value / ttm_op if enterprise_value > 0 else None
    return {
        "per": per,
        "pbr": pbr,
        "ev_ebitda": ev_ebitda,
        "market_cap": market_cap,
        "updated_at": updated_at,
        "ttm_rev": ttm_rev,
        "ttm_op": ttm_op,
        "ttm_ni": ttm_ni,
        "ttm_ocf": ttm_ocf,
        "ttm_roe": roe,
        "debt_ratio": debt_ratio,
        "ttm_icr": interest_coverage,
    }


def quality_enrichment_codes(
    code_to_quarters: dict[str, list[dict[str, Any]]],
    market_caps: dict[str, int | None],
    maximum: int | None,
) -> list[str]:
    candidates: list[tuple[str, int, float]] = []
    for code, quarters in code_to_quarters.items():
        valuation = aggregate_valuation(market_caps.get(code), quarters, "")
        recent = latest_quarters(quarters, 4)
        profitable = sum((finite(quarter.get("op")) or 0) > 0 for quarter in recent)
        signals = 0
        if len(recent) == 4 and profitable >= 3:
            signals += 1
        if (valuation.get("ttm_roe") or 0) >= 0.05:
            signals += 1
        if valuation.get("debt_ratio") is not None and valuation["debt_ratio"] <= 2:
            signals += 1
        if valuation.get("ttm_rev") and valuation.get("ttm_op") is not None and valuation["ttm_op"] / valuation["ttm_rev"] > 0:
            signals += 1
        if signals >= 3 and profitable >= 3:
            candidates.append((code, signals, valuation.get("ttm_roe") or 0))
    candidates.sort(key=lambda item: (-item[1], -item[2], item[0]))
    codes = [code for code, _signals, _roe in candidates]
    return codes[:maximum] if maximum else codes


def store_snapshot(
    database_path: Path,
    universe: pd.DataFrame,
    common_rows: pd.DataFrame,
    histories: dict[str, list[dict[str, Any]]],
    code_to_quarters: dict[str, list[dict[str, Any]]],
    generated_at: str,
    market_date: date,
) -> None:
    connection = connect_database(database_path)
    try:
        row_by_code = {str(row["Code"]).zfill(6): row for _, row in common_rows.iterrows()}
        stock_rows = []
        valuation_rows = []
        price_rows = []
        financial_rows = []
        for code, row in row_by_code.items():
            prices = histories.get(code, [])
            market_cap = listing_market_cap(row, prices)
            stock_rows.append(
                (
                    code,
                    str(row.get("Name") or code),
                    str(row.get("Market") or ""),
                    str(row.get("Sector") or ""),
                    str(row.get("Industry") or ""),
                    str(row.get("ListingDate") or ""),
                    market_cap,
                    generated_at,
                )
            )
            for price in prices:
                price_rows.append((code, price["date"], price["open"], price["high"], price["low"], price["close"], price["volume"], None, None, None, None))
            quarters = code_to_quarters.get(code, [])
            for quarter in quarters:
                for metric in ("rev", "op", "ni", "ocf", "interest_exp", "equity", "debt", "cash", "fin_debt"):
                    value = quarter.get(metric)
                    if value is not None:
                        financial_rows.append((code, quarter["year"], quarter["quarter"], metric, str(value), None, None))
                financial_rows.append((code, quarter["year"], quarter["quarter"], "data_quality", quarter.get("data_quality", "partial"), None, None))
            valuation = aggregate_valuation(market_cap, quarters, generated_at)
            valuation_rows.append(
                (
                    code,
                    valuation["per"],
                    valuation["pbr"],
                    None,
                    valuation["ev_ebitda"],
                    None,
                    valuation["market_cap"],
                    None,
                    generated_at,
                    valuation["ttm_rev"],
                    valuation["ttm_op"],
                    valuation["ttm_ni"],
                    valuation["ttm_ocf"],
                    valuation["ttm_roe"],
                    valuation["debt_ratio"],
                    valuation["ttm_icr"],
                    None,
                )
            )
        insert_many(connection, "INSERT INTO stocks VALUES (?,?,?,?,?,?,?,?)", stock_rows)
        insert_many(connection, "INSERT INTO prices VALUES (?,?,?,?,?,?,?,?,?,?,?)", price_rows)
        insert_many(connection, "INSERT INTO financials VALUES (?,?,?,?,?,?,?)", financial_rows)
        insert_many(connection, "INSERT INTO valuations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", valuation_rows)
        connection.execute("INSERT INTO collector_metadata(key,value) VALUES (?,?)", ("market_as_of", market_date.isoformat()))
        connection.execute("INSERT INTO collector_metadata(key,value) VALUES (?,?)", ("generated_at", generated_at))
        optimize(connection)
    finally:
        connection.close()


def merge_enrichment(
    quarters_by_code: dict[str, list[dict[str, Any]]],
    enrichment: dict[str, dict[tuple[int, str], dict[str, float | None]]],
) -> None:
    for code, quarter_values in enrichment.items():
        quarter_map = {(quarter["year"], quarter["quarter"]): quarter for quarter in quarters_by_code.get(code, [])}
        for key, values in quarter_values.items():
            if key not in quarter_map:
                continue
            quarter = quarter_map[key]
            for source_key, target_key in (("ocf", "ocf"), ("interest", "interest_exp"), ("cash", "cash"), ("fin_debt", "fin_debt")):
                if values.get(source_key) is not None:
                    quarter[target_key] = values[source_key]


def save_listing(universe: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    universe.to_csv(path, index=False, encoding="utf-8-sig")


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect a fresh full-market snapshot and run Radar v0.")
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--price-workers", type=int, default=config.PRICE_WORKERS)
    parser.add_argument("--dart-workers", type=int, default=config.DART_WORKERS)
    parser.add_argument("--max-enrichment", type=int, default=0, help="0 means enrich every Quality pre-candidate")
    parser.add_argument("--max-price-targets", type=int, default=0, help="Development-only limit; 0 means full market")
    parser.add_argument("--skip-enrichment", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Collect and validate but do not publish latest artifacts")
    args = parser.parse_args()

    if args.env_file.exists():
        load_dotenv(args.env_file)
    dart_key = os.getenv("DART_API_KEY", "").strip()
    if not dart_key:
        raise RuntimeError("DART_API_KEY is missing. Set it in .env.local or the process environment.")

    rules = load_rule_config()
    run_started = datetime.now().astimezone()
    generated_at = run_started.isoformat(timespec="seconds")
    run_id = f"full_market_{run_started.strftime('%Y%m%d_%H%M%S')}"
    staging_dir = config.DATA_DIR / "staging" / run_id
    staging_dir.mkdir(parents=True, exist_ok=True)
    staging_db = staging_dir / "radar_market.db"
    staging_listing = staging_dir / "listing.csv"
    staging_events = staging_dir / "events.json"
    staging_radar = staging_dir / "radar.json"

    status: dict[str, Any] = {
        "run_id": run_id,
        "started_at": generated_at,
        "status": "running",
        "sources": {},
        "warnings": [],
    }
    write_json(config.COLLECTOR_STATUS_PATH, status)

    try:
        log("1/7 KRX 전체 Universe 최신 스냅샷 수집")
        universe = collect_universe()
        market_date = completed_market_date()
        common_mask = universe.apply(lambda row: is_common_equity(row, rules["common"]["exclude_name_contains"]), axis=1)
        common_rows = universe[common_mask].copy()
        status["sources"]["universe"] = {
            "status": "ok",
            "collected_at": generated_at,
            "record_count": int(len(common_rows)),
            "market_as_of": market_date.isoformat(),
        }
        log(f"전체 보통주 Universe {len(common_rows):,}개 · 완료 시장일 {market_date}")

        market_cap_min = rules["common"]["market_cap_min_krw"]
        price_targets = [
            str(row["Code"]).zfill(6)
            for _, row in common_rows.iterrows()
            if (finite(row.get("Marcap")) or 0) >= market_cap_min
        ]
        if args.max_price_targets > 0:
            price_targets = price_targets[: args.max_price_targets]
            status["warnings"].append(f"개발 검증용 가격 대상 제한: {args.max_price_targets}개")
        log(f"2/7 가격·유동성 수집 대상 {len(price_targets):,}개")
        histories = load_price_checkpoint(config.PRICE_CHECKPOINT_DIR, price_targets, market_date)
        if histories is None:
            histories, price_errors = collect_price_histories(
                price_targets,
                market_date - timedelta(days=config.PRICE_LOOKBACK_CALENDAR_DAYS),
                market_date,
                args.price_workers,
                progress=lambda done, total: log(f"가격 {done:,}/{total:,}"),
            )
        else:
            price_errors = {}
            log(f"동일 완료 시장일 검증 가격 체크포인트 재사용 {len(histories):,}개")
        fresh_price_count = sum(rows and rows[-1]["date"] == market_date.isoformat() for rows in histories.values())
        price_coverage = fresh_price_count / len(price_targets) * 100 if price_targets else 0
        status["sources"]["prices"] = {
            "status": "ok" if price_coverage >= config.MIN_PRICE_COVERAGE_PCT else "error",
            "market_as_of": market_date.isoformat(),
            "target_count": len(price_targets),
            "fresh_count": fresh_price_count,
            "error_count": len(price_errors),
            "coverage_pct": round(price_coverage, 1),
        }
        if price_coverage < config.MIN_PRICE_COVERAGE_PCT:
            raise RuntimeError(f"Fresh price coverage {price_coverage:.1f}% is below {config.MIN_PRICE_COVERAGE_PCT}%")
        if not price_errors and len(histories) == len(price_targets):
            save_price_checkpoint(config.PRICE_CHECKPOINT_DIR, price_targets, market_date, histories)

        for index, row in universe.iterrows():
            code = str(row["Code"]).zfill(6)
            rows = histories.get(code)
            shares = finite(row.get("Stocks"))
            if not rows:
                continue
            latest_price = rows[-1]
            universe.at[index, "Close"] = latest_price["close"]
            universe.at[index, "Volume"] = latest_price["volume"]
            universe.at[index, "Amount"] = int(latest_price["close"]) * int(latest_price["volume"])
            if shares:
                universe.at[index, "Marcap"] = int(latest_price["close"] * shares)
        common_rows = universe[common_mask].copy()
        save_listing(universe, staging_listing)

        liquid_codes = [
            code
            for code, rows in histories.items()
            if len(rows) >= rules["common"]["price_history_min_days"]
            and (median_traded_value(rows, rules["common"]["median_traded_value_days"]) or 0)
            >= rules["common"]["median_traded_value_min_krw"]
        ]
        log(f"가격 최신성 통과 {fresh_price_count:,}개 · 공통 유동성 통과 {len(liquid_codes):,}개")

        log("3/7 DART 기업코드와 최근 8개 분기 주요재무 수집")
        dart = DartClient(dart_key, config.CACHE_DIR / "dart")
        corp_map = dart.corporation_codes(refresh=True)
        mapped_codes = [code for code in liquid_codes if code in corp_map]
        periods = config.recent_report_periods(run_started.date(), 8)
        latest_period_keys = {period.key for period in periods[:2]}
        major_records, dart_financial_errors = dart.multi_accounts(
            [corp_map[code]["corp_code"] for code in mapped_codes],
            periods,
            batch_size=config.DART_BATCH_SIZE,
            workers=args.dart_workers,
            refresh_period_keys=latest_period_keys,
            progress=lambda done, total: log(f"DART 배치 {done:,}/{total:,}"),
        )
        if dart_financial_errors:
            raise RuntimeError(f"DART batch failures: {dart_financial_errors[:3]}")
        quarters_by_code = parse_major_quarters(major_records, periods)
        financial_coverage = len(quarters_by_code) / len(mapped_codes) * 100 if mapped_codes else 0
        status["sources"]["dart_financials"] = {
            "status": "ok" if financial_coverage >= config.MIN_DART_FINANCIAL_COVERAGE_PCT else "error",
            "latest_period": periods[0].key,
            "target_count": len(mapped_codes),
            "covered_count": len(quarters_by_code),
            "coverage_pct": round(financial_coverage, 1),
        }
        if financial_coverage < config.MIN_DART_FINANCIAL_COVERAGE_PCT:
            raise RuntimeError(f"DART financial coverage {financial_coverage:.1f}% is below {config.MIN_DART_FINANCIAL_COVERAGE_PCT}%")
        log(f"DART 주요재무 {len(quarters_by_code):,}/{len(mapped_codes):,}개")

        row_by_code = {str(row["Code"]).zfill(6): row for _, row in common_rows.iterrows()}
        market_caps = {code: listing_market_cap(row_by_code[code], histories.get(code)) for code in row_by_code}
        enrichment_codes = quality_enrichment_codes(
            quarters_by_code,
            market_caps,
            args.max_enrichment if args.max_enrichment > 0 else None,
        )
        if not args.skip_enrichment and enrichment_codes:
            log(f"4/7 Quality 예비후보 {len(enrichment_codes):,}개 현금흐름 보강")
            enrichment_periods = periods[:4]
            responses, enrichment_errors = dart.full_accounts_many(
                {code: corp_map[code]["corp_code"] for code in enrichment_codes if code in corp_map},
                enrichment_periods,
                workers=args.dart_workers,
                refresh_period_keys={enrichment_periods[0].key},
                progress=lambda done, total: log(f"DART 전체재무 {done:,}/{total:,}"),
            )
            if enrichment_errors:
                raise RuntimeError(f"DART enrichment failures: {enrichment_errors[:3]}")
            enrichment = parse_full_enrichment(responses, enrichment_periods)
            merge_enrichment(quarters_by_code, enrichment)
            status["sources"]["dart_enrichment"] = {
                "status": "ok",
                "target_count": len(enrichment_codes),
                "covered_count": len(enrichment),
            }
        else:
            log("4/7 Quality 현금흐름 보강 생략")
            status["sources"]["dart_enrichment"] = {"status": "skipped", "target_count": len(enrichment_codes)}

        log("5/7 최근 120일 DART 중요 이벤트 최신 수집")
        disclosures, event_errors = dart.disclosure_events(
            run_started.date() - timedelta(days=config.DART_EVENT_LOOKBACK_DAYS),
            run_started.date(),
            workers=args.dart_workers,
            progress=lambda done, total, detail: log(f"DART 이벤트 쿼리 {done}/{total} · {detail}"),
        )
        if event_errors:
            raise RuntimeError(f"DART event failures: {event_errors[:3]}")
        events_payload = event_source_payload(disclosures, [], generated_at)
        write_json(staging_events, events_payload)
        status["sources"]["dart_events"] = {
            "status": "ok",
            "raw_count": len(disclosures),
            "material_count": len(events_payload["items"]),
            "through": run_started.date().isoformat(),
        }

        log("6/7 동일 기준일 분석 DB 생성")
        store_snapshot(staging_db, universe, common_rows, histories, quarters_by_code, generated_at, market_date)

        log("7/7 Radar v0 평가 및 게시 검증")
        evaluate_args = SimpleNamespace(
            database=staging_db,
            listing_csv=staging_listing,
            events_json=staging_events,
            rules=config.RULES_PATH,
            as_of=run_started.date().isoformat(),
        )
        radar_payload = evaluate_radar(evaluate_args)
        radar_payload["run_id"] = run_id
        radar_payload["generated_at"] = generated_at
        radar_payload["status"] = "ok"
        radar_payload["scope_label"] = "KOSPI·KOSDAQ 전체시장 최신 실행"
        radar_payload["source_status"] = status["sources"]
        radar_payload["warnings"] = [
            warning
            for warning in radar_payload.get("warnings", [])
            if "기존" not in warning and "레거시" not in warning
        ]
        radar_payload["summary"]["evaluated_universe_count"] = radar_payload["summary"]["standard_eligible_count"]
        radar_payload["summary"]["financial_coverage_count"] = len(quarters_by_code)
        radar_payload["summary"]["price_target_count"] = len(price_targets)
        radar_payload["summary"]["fresh_price_count"] = fresh_price_count
        write_json(staging_radar, radar_payload)

        status["status"] = "validated"
        status["finished_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
        status["summary"] = radar_payload["summary"]
        if not args.dry_run:
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(staging_db, config.DATABASE_PATH)
            shutil.copy2(staging_listing, config.LISTING_PATH)
            shutil.copy2(staging_events, config.EVENTS_PATH)
            export_radar_previews(radar_payload)
            write_json(config.INTERNAL_RADAR_PATH, radar_payload)
            write_json(config.PUBLIC_RADAR_PATH, radar_payload)
            status["status"] = "published"
        write_json(config.COLLECTOR_STATUS_PATH, status)
        log(
            f"완료 · 전체 {len(common_rows):,}개 / 재무 {len(quarters_by_code):,}개 / "
            f"후보 {radar_payload['summary']['candidate_unique_count']:,}개"
        )
        return 0
    except Exception as exc:
        status["status"] = "failed"
        status["finished_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
        status["error"] = f"{type(exc).__name__}: {exc}"
        write_json(config.COLLECTOR_STATUS_PATH, status)
        log(f"실패 · 기존 게시 결과 유지 · {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
