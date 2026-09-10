from __future__ import annotations

import json
import math
import re
import sqlite3
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from radar_pipeline import config


QUARTER_ORDER = {"1Q": 1, "2Q": 2, "3Q": 3, "4Q": 4}

def valuation_methodology(connection):
    try:
        row=connection.execute("SELECT value FROM collector_metadata WHERE key='financial_method_version'").fetchone()
    except sqlite3.OperationalError:
        return {}
    return {'roe_basis':'closing','attribution_basis':'total','interest_basis':'interest'} if row and row[0]=='radar-verified-v2' else {}


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def ratio_percent(value: Any) -> float | None:
    number = finite(value)
    if number is None:
        return None
    # This database stores ratios, not percentages. Never infer units by magnitude.
    return round(number * 100, 2)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2, allow_nan=False)
        file.write("\n")
    for attempt in range(8):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.1 * (attempt + 1))


def load_events(path: Path) -> dict[str, list[dict[str, Any]]]:
    with path.open(encoding="utf-8") as file:
        payload = json.load(file)
    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in payload.get("items", []):
        code = str(item.get("code", "")).zfill(6)
        if len(code) != 6:
            continue
        metadata = item.get("metadata", {})
        by_code[code].append(
            {
                "id": item.get("id"),
                "date": item.get("date"),
                "title": item.get("title"),
                "url": item.get("url"),
                "importance": metadata.get("importance_hint"),
                "direction": metadata.get("direction_hint"),
            }
        )
    for items in by_code.values():
        items.sort(key=lambda item: str(item.get("date") or ""), reverse=True)
    return by_code


def quarter_rows(connection: sqlite3.Connection, code: str) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, str], dict[str, Any]] = {}
    rows = connection.execute(
        "SELECT year, report_code, account_nm, thstrm_amount FROM financials WHERE code = ?",
        (code,),
    ).fetchall()
    for row in rows:
        year = int(row["year"])
        quarter = str(row["report_code"])
        key = (year, quarter)
        grouped.setdefault(key, {"year": year, "quarter": quarter, "label": f"{str(year)[2:]} {quarter}"})
        metric = str(row["account_nm"])
        value = finite(row["thstrm_amount"])
        if value is not None:
            grouped[key][metric] = value
    result = sorted(grouped.values(), key=lambda item: (item["year"], QUARTER_ORDER.get(item["quarter"], 0)))
    raw_ocf_periods = {(item["year"], item["quarter"]) for item in result if finite(item.get("ocf")) is not None}
    for item in result:
        quarter_number = QUARTER_ORDER.get(item["quarter"], 0)
        if finite(item.get("ocf")) is not None and quarter_number > 1:
            prior_key = (item["year"], f"{quarter_number - 1}Q")
            if prior_key not in raw_ocf_periods:
                # Legacy enrichment subtracted zero when the prior YTD was absent.
                # That first observation is cumulative, not a standalone quarter.
                item["ocf"] = None
                item["warnings"] = ["직전 분기 누적 현금흐름이 없어 단독 분기 영업현금흐름을 표시하지 않습니다."]
        revenue = finite(item.get("rev"))
        operating_profit = finite(item.get("op"))
        equity = finite(item.get("equity"))
        debt = finite(item.get("debt"))
        item["op_margin_pct"] = round(operating_profit / revenue * 100, 2) if revenue and operating_profit is not None else None
        item["debt_ratio_pct"] = round(debt / equity * 100, 2) if equity and debt is not None else None
    return result


def price_rows(connection: sqlite3.Connection, code: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT date, open, high, low, close, volume FROM prices WHERE code = ? ORDER BY date",
        (code,),
    ).fetchall()
    return [dict(row) for row in rows]


def stock_payload(
    connection: sqlite3.Connection,
    candidate: dict[str, Any],
    events: list[dict[str, Any]],
    generated_at: str,
) -> dict[str, Any]:
    code = str(candidate["code"]).zfill(6)
    stock = connection.execute("SELECT * FROM stocks WHERE code = ?", (code,)).fetchone()
    valuation = connection.execute("SELECT * FROM valuations WHERE code = ?", (code,)).fetchone()
    prices = price_rows(connection, code)
    quarters = quarter_rows(connection, code)
    latest = prices[-1] if prices else None
    previous = prices[-2] if len(prices) > 1 else None
    close = finite(latest.get("close")) if latest else None
    previous_close = finite(previous.get("close")) if previous else None
    high_52w = max((finite(row.get("high")) or 0 for row in prices[-252:]), default=0) or None
    low_52w = min((finite(row.get("low")) for row in prices[-252:] if finite(row.get("low")) is not None), default=None)
    change_1d_pct = round((close / previous_close - 1) * 100, 2) if close is not None and previous_close else None
    drawdown_52w_pct = round((close / high_52w - 1) * 100, 2) if close is not None and high_52w else None
    price_position_52w_pct = (
        round((close - low_52w) / (high_52w - low_52w) * 100, 2)
        if close is not None and low_52w is not None and high_52w and high_52w > low_52w
        else None
    )
    valuation_values = dict(valuation) if valuation else {}
    methodology = valuation_methodology(connection)
    recent_ocf = [finite(item.get("ocf")) for item in quarters[-4:]]
    recent_periods = [item["year"] * 4 + QUARTER_ORDER[item["quarter"]] for item in quarters[-4:]]
    consecutive = len(recent_periods) == 4 and recent_periods == list(range(recent_periods[0], recent_periods[0] + 4))
    ttm_ocf = sum(recent_ocf) if consecutive and all(value is not None for value in recent_ocf) else None
    financial_warning = "연결 우선·별도 대체 수집. 현재 저장 자료에는 분기별 재무제표 구분과 공시 접수번호가 없습니다."
    event_warning = "Radar가 수집한 계약·자기주식·자금조달 공시만 포함합니다. 전체 공시나 향후 일정이 아닙니다."
    return {
        "schema_version": "stock-detail.v2",
        "generated_at": generated_at,
        "code": code,
        "name": stock["name"] if stock else candidate.get("name"),
        "market": stock["market"] if stock else candidate.get("market"),
        "sector": stock["sector"] if stock else candidate.get("sector"),
        "industry": stock["industry"] if stock else None,
        "listing_date": stock["listing_date"] if stock else None,
        "summary": {
            "latest_price": close,
            "change_1d_pct": change_1d_pct,
            "price_as_of": latest.get("date") if latest else None,
            "market_cap_krw": finite(stock["market_cap"]) if stock else candidate.get("market_cap_krw"),
            "high_52w": high_52w,
            "low_52w": low_52w,
            "drawdown_52w_pct": drawdown_52w_pct,
            "price_position_52w_pct": price_position_52w_pct,
        },
        "valuation": {
            **methodology,
            "per": finite(valuation_values.get("per")),
            "pbr": finite(valuation_values.get("pbr")),
            "ev_ebitda": None,
            "ev_operating_profit": finite(valuation_values.get("ev_ebitda")),
            "ttm_roe_pct": ratio_percent(valuation_values.get("ttm_roe")),
            "debt_ratio_pct": ratio_percent(valuation_values.get("debt_ratio")),
            "interest_coverage": finite(valuation_values.get("ttm_icr")),
            "ttm_revenue": finite(valuation_values.get("ttm_rev")),
            "ttm_operating_profit": finite(valuation_values.get("ttm_op")),
            "ttm_net_income": finite(valuation_values.get("ttm_ni")),
            "ttm_operating_cash_flow": ttm_ocf,
        },
        "quarters": quarters,
        "radar_valuation_basis": methodology,
        "prices": prices,
        "events": events,
        "radar": candidate,
        "warnings": [financial_warning, event_warning] + [warning for quarter in quarters for warning in quarter.get("warnings", [])],
        "source_status": {
            "prices": {"status": "ok" if prices else "missing", "record_count": len(prices), "as_of": latest.get("date") if latest else None, "source": "네이버 금융 일별 시세"},
            "financials": {"status": "partial" if quarters else "missing", "quarter_count": len(quarters), "as_of": f"{quarters[-1]['year']} {quarters[-1]['quarter']}" if quarters else None, "source": "DART 재무제표", "warning": financial_warning},
            "dart_events": {"status": "partial", "record_count": len(events), "source": "DART 공시 목록", "warning": event_warning},
        },
    }


def export_stock_details(
    radar_payload: dict[str, Any] | None = None,
    database_path: Path = config.DATABASE_PATH,
    events_path: Path = config.EVENTS_PATH,
    output_dir: Path = config.PUBLIC_STOCK_DETAIL_DIR,
) -> dict[str, Any]:
    if radar_payload is None:
        with config.PUBLIC_RADAR_PATH.open(encoding="utf-8") as file:
            radar_payload = json.load(file)
    events_by_code = load_events(events_path)
    with events_path.open(encoding="utf-8") as file:
        events_metadata = json.load(file)
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    exported = []
    try:
        for candidate in radar_payload.get("candidates", []):
            code = str(candidate.get("code", "")).zfill(6)
            payload = stock_payload(connection, candidate, events_by_code.get(code, []), generated_at)
            payload["run_id"] = radar_payload.get("run_id")
            payload["collected_at"] = radar_payload.get("source_generated_at") or radar_payload.get("generated_at")
            for source in payload["source_status"].values():
                source["collected_at"] = payload["collected_at"]
            event_source = payload["source_status"]["dart_events"]
            event_source["collected_at"] = events_metadata.get("generated_at")
            if events_metadata.get("sources", {}).get("dart_filings", {}).get("status") in ("error", "missing"):
                event_source["status"] = events_metadata["sources"]["dart_filings"]["status"]
            payload["warnings"].extend(events_metadata.get("warnings", []))
            write_json(output_dir / f"{code}.json", payload)
            exported.append({"code": code, "name": payload["name"], "path": f"/data/stocks/{code}.json"})
    finally:
        connection.close()
    current_codes = {item["code"] for item in exported}
    for existing in output_dir.glob("*.json"):
        if existing.name != "index.json" and re.fullmatch(r"\d{6}", existing.stem) and existing.stem not in current_codes:
            existing.unlink()
    index = {"schema_version": "stock-detail-index.v1", "generated_at": generated_at, "items": exported}
    write_json(output_dir / "index.json", index)
    return index


def main() -> int:
    index = export_stock_details()
    print(f"Exported {len(index['items'])} stock detail files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
