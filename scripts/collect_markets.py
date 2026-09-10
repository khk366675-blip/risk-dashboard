from __future__ import annotations

import json
import math
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from radar_pipeline import config
from radar_pipeline.market import completed_market_date
from radar_pipeline.market_sources import bounded_price_frame, current_listing


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


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


def previous_payload() -> dict[str, Any]:
    if not config.PUBLIC_MARKET_PATH.exists():
        return {}
    try:
        with config.PUBLIC_MARKET_PATH.open(encoding="utf-8") as file:
            return json.load(file)
    except (OSError, ValueError):
        return {}


def percentage_change(values: list[float], periods: int) -> float | None:
    if len(values) <= periods or values[-periods - 1] == 0:
        return None
    return round((values[-1] / values[-periods - 1] - 1) * 100, 2)


def absolute_change(values: list[float], periods: int) -> float | None:
    if len(values) <= periods:
        return None
    return round(values[-1] - values[-periods - 1], 4)


def collect_asset(spec: dict[str, Any], start: date, today: date) -> dict[str, Any]:
    source = "FinanceDataReader"
    source_warning = None
    fallback = config.MARKET_FALLBACK_SYMBOLS.get(spec["symbol"])
    try:
        frame = bounded_price_frame(spec["symbol"], start, today)
        if "Close" not in frame or len(frame["Close"].dropna()) < 61:
            raise RuntimeError("원 시세의 가격 이력이 부족합니다")
    except Exception:
        if not fallback:
            raise
        frame = bounded_price_frame(fallback, start, today)
        source = "Yahoo Finance via FinanceDataReader"
        source_warning = "KRX 지수 수집 실패로 Yahoo Finance 원지표를 사용했습니다."
    if fallback and source == "FinanceDataReader":
        try:
            alternate = bounded_price_frame(fallback, start, today)
            if not alternate.empty and "Close" in alternate and not alternate["Close"].dropna().empty and (frame.empty or alternate["Close"].dropna().index[-1] > frame["Close"].dropna().index[-1]):
                frame = alternate
                source = "Yahoo Finance via FinanceDataReader"
                source_warning = "KRX 지수 자료보다 최신인 Yahoo Finance 원지표를 사용했습니다."
        except Exception:
            pass  # The successfully fetched primary series remains available.
    if "Close" not in frame.columns:
        raise RuntimeError("Close column missing")
    close = frame["Close"].dropna()
    close = close[close.map(lambda value: finite(value) is not None)]
    if len(close) < 61:
        raise RuntimeError(f"insufficient history: {len(close)} rows")
    values = [float(value) for value in close.tolist()]
    dates = [index.date().isoformat() for index in close.index]
    latest_row = frame.loc[close.index[-1]]
    session_open = finite(latest_row.get("Open"))
    session_high = finite(latest_row.get("High"))
    session_low = finite(latest_row.get("Low"))
    session_close = values[-1]
    window = values[-252:]
    low, high = min(window), max(window)
    position = round((values[-1] - low) / (high - low) * 100, 2) if high > low else None
    age = (today - close.index[-1].date()).days
    freshness = "latest" if age <= 3 else "stale"
    return {
        **spec,
        "value": round(values[-1], 4),
        "change_1d_pct": percentage_change(values, 1),
        "change_5d_pct": percentage_change(values, 5),
        "change_20d_pct": percentage_change(values, 20),
        "change_60d_pct": percentage_change(values, 60),
        "change_252d_pct": percentage_change(values, 252),
        "change_1d_value": absolute_change(values, 1),
        "change_5d_value": absolute_change(values, 5),
        "change_20d_value": absolute_change(values, 20),
        "change_60d_value": absolute_change(values, 60),
        "change_252d_value": absolute_change(values, 252),
        "position_252d_pct": position,
        "as_of": dates[-1],
        "source": source,
        "freshness": freshness,
        "warning": " ".join(item for item in (source_warning, f"마지막 관측일이 {age}일 전입니다." if freshness == "stale" else None) if item) or None,
        "latest_session": {
            "date": dates[-1],
            "open": session_open,
            "high": session_high,
            "low": session_low,
            "close": session_close,
            "range_pct": round((session_high / session_low - 1) * 100, 2) if session_high is not None and session_low else None,
            "from_open_pct": round((session_close / session_open - 1) * 100, 2) if session_open else None,
        },
        "sparkline": [{"date": item_date, "value": round(item_value, 4)} for item_date, item_value in zip(dates[-253:], values[-253:])],
    }


def stale_asset(spec: dict[str, Any], previous: dict[str, Any], error: Exception, today: date) -> dict[str, Any]:
    old = next((item for item in previous.get("assets", []) if item.get("key") == spec["key"]), None)
    if old and old.get("as_of"):
        try:
            age = (today - date.fromisoformat(old["as_of"][:10])).days
        except ValueError:
            age = config.MARKET_MAX_STALE_DAYS + 1
        if age <= config.MARKET_MAX_STALE_DAYS:
            return {**old, "freshness": "stale", "warning": f"이번 수집 실패로 {old['as_of']} 관측값을 유지합니다.", "collection_error": f"{type(error).__name__}: {str(error)[:300]}"}
    return {
        **spec,
        "value": None,
        "change_1d_pct": None,
        "change_5d_pct": None,
        "change_20d_pct": None,
        "change_60d_pct": None,
        "change_252d_pct": None,
        "change_1d_value": None,
        "change_5d_value": None,
        "change_20d_value": None,
        "change_60d_value": None,
        "change_252d_value": None,
        "position_252d_pct": None,
        "as_of": None,
        "source": "FinanceDataReader",
        "freshness": "missing",
        "warning": "이번 실행에서 데이터를 불러오지 못했습니다.",
        "collection_error": f"{type(error).__name__}: {str(error)[:300]}",
        "latest_session": None,
        "sparkline": [],
    }


def korea_breadth(database_path: Path, market_sessions: list[str] | None = None) -> dict[str, Any]:
    if not database_path.exists():
        return {"status": "missing", "as_of": None, "coverage_count": 0, "advancers_pct": None, "above_20d_pct": None, "above_60d_pct": None, "new_high_20d_pct": None, "new_low_20d_pct": None}
    connection = sqlite3.connect(database_path)
    try:
        rows = connection.execute("SELECT code, date, close FROM prices ORDER BY code, date").fetchall()
    finally:
        connection.close()
    by_code: dict[str, list[tuple[str, float]]] = {}
    for code, observed, close in rows:
        value = finite(close)
        if value is not None:
            by_code.setdefault(str(code), []).append((str(observed), value))
    latest_date = max((items[-1][0] for items in by_code.values() if items), default=None)
    target_date = latest_date
    warning = None
    refresh_source = "radar_market.db"
    try:
        completed = completed_market_date().isoformat()
        target_date = completed
        if latest_date is None or completed > latest_date:
            if latest_date and market_sessions and len([day for day in market_sessions if latest_date < day <= completed]) > 1:
                raise RuntimeError("중간 거래일 가격이 누락되어 있습니다. Radar 실행 후 가격 이력이 보완됩니다.")
            listing = current_listing(date.fromisoformat(completed))
            if listing is None or listing.empty or "Code" not in listing.columns or "Close" not in listing.columns:
                raise RuntimeError("KRX latest snapshot is empty")
            latest_closes: dict[str, float] = {}
            for _, row in listing.iterrows():
                if str(row.get("QuoteDate", listing.attrs.get("as_of", ""))) != completed:
                    continue
                code = str(row.get("Code", "")).split(".")[0].strip().zfill(6)
                close = finite(row.get("Close"))
                if code in by_code and close is not None and close > 0:
                    latest_closes[code] = close
            if not latest_closes:
                raise RuntimeError("완료 시장일과 일치하는 종가가 없습니다")
            for code, close in latest_closes.items():
                if not by_code[code] or by_code[code][-1][0] < completed:
                    by_code[code].append((completed, close))
            refresh_source = f"{listing.attrs.get('source', 'FinanceDataReader KRX latest')} + radar_market.db history"
    except Exception as error:
        target_date = latest_date
        warning = f"KRX breadth 최신화 실패로 {latest_date or '기존'} 관측값을 유지합니다: {type(error).__name__}: {str(error)[:200]}"

    eligible = [items for items in by_code.values() if len(items) >= 60 and items[-1][0] == target_date]
    if not eligible:
        return {"status": "missing", "as_of": target_date, "coverage_count": 0, "advancers_pct": None, "above_20d_pct": None, "above_60d_pct": None, "new_high_20d_pct": None, "new_low_20d_pct": None, "source": refresh_source, "warning": warning}

    def pct(predicate: Any) -> float:
        return round(sum(bool(predicate(items)) for items in eligible) / len(eligible) * 100, 1)

    return {
        "status": "stale" if warning else "ok",
        "as_of": target_date,
        "coverage_count": len(eligible),
        "advancers_pct": pct(lambda items: items[-1][1] > items[-2][1]),
        "above_20d_pct": pct(lambda items: items[-1][1] > sum(value for _day, value in items[-20:]) / 20),
        "above_60d_pct": pct(lambda items: items[-1][1] > sum(value for _day, value in items[-60:]) / 60),
        "new_high_20d_pct": pct(lambda items: items[-1][1] >= max(value for _day, value in items[-20:])),
        "new_low_20d_pct": pct(lambda items: items[-1][1] <= min(value for _day, value in items[-20:])),
        "source": refresh_source,
        "warning": warning,
    }


def metric(assets: list[dict[str, Any]], key: str, field: str) -> float | None:
    item = next((asset for asset in assets if asset["key"] == key), {})
    return finite(item.get(field))


def build_summary(assets: list[dict[str, Any]], breadth: dict[str, Any]) -> dict[str, Any]:
    sp20 = metric(assets, "sp500", "change_20d_pct")
    nas20 = metric(assets, "nasdaq", "change_20d_pct")
    vix = metric(assets, "vix", "value")
    global_checks = [sp20 is not None and sp20 > 0, nas20 is not None and nas20 > 0, vix is not None and vix <= 20]
    global_positive = sum(global_checks)
    global_label = "위험선호 우호" if global_positive == 3 else "위험선호 부담" if global_positive == 0 else "위험선호 혼조"

    kospi20 = metric(assets, "kospi", "change_20d_pct")
    kosdaq20 = metric(assets, "kosdaq", "change_20d_pct")
    above20 = finite(breadth.get("above_20d_pct"))
    above60 = finite(breadth.get("above_60d_pct"))
    korea_checks = [
        kospi20 is not None and kospi20 > 0,
        kosdaq20 is not None and kosdaq20 > 0,
        above20 is not None and above20 >= 50,
        above60 is not None and above60 >= 50,
    ]
    korea_positive = sum(korea_checks)
    korea_label = "시장 확산 우호" if korea_positive >= 3 else "시장 확산 약함" if korea_positive <= 1 else "시장 확산 혼조"

    usd20 = metric(assets, "usdkrw", "change_20d_pct")
    dxy20 = metric(assets, "dxy", "change_20d_pct")
    fx_values = [value for value in (usd20, dxy20) if value is not None]
    fx_pressure = sum(fx_values) / len(fx_values) if fx_values else None
    fx_label = "압력 확대" if fx_pressure is not None and fx_pressure >= 2 else "압력 완화" if fx_pressure is not None and fx_pressure <= -2 else "중립"

    one_line = f"글로벌은 {global_label}, 한국은 {korea_label}, 달러·원화는 {fx_label}입니다. 합성점수 없이 원지표 조건으로 구분했습니다."
    return {
        "global_risk_label": global_label,
        "korea_label": korea_label,
        "fx_pressure_label": fx_label,
        "one_line": one_line,
        "method": "rule_based_raw_metrics",
        "signals": {
            "sp500_20d_pct": sp20,
            "nasdaq_20d_pct": nas20,
            "vix_level": vix,
            "kospi_20d_pct": kospi20,
            "kosdaq_20d_pct": kosdaq20,
            "above_20d_pct": above20,
            "above_60d_pct": above60,
            "usdkrw_20d_pct": usd20,
            "dxy_20d_pct": dxy20,
        },
    }


def collect() -> dict[str, Any]:
    today = date.today()
    start = today - timedelta(days=config.MARKET_LOOKBACK_CALENDAR_DAYS)
    old = previous_payload()
    assets: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(collect_asset, dict(spec), start, today): dict(spec) for spec in config.MARKET_ASSETS}
        for future in as_completed(futures):
            spec = futures[future]
            try:
                assets.append(future.result())
            except Exception as error:
                assets.append(stale_asset(spec, old, error, today))
    order = {spec["key"]: index for index, spec in enumerate(config.MARKET_ASSETS)}
    assets.sort(key=lambda item: order[item["key"]])
    korea_index = next((asset for asset in assets if asset["key"] == "kospi"), {})
    sessions = [item["date"] for item in korea_index.get("sparkline", [])]
    try:
        breadth = korea_breadth(config.DATABASE_PATH, sessions)
    except Exception as error:
        # A locked/unavailable local price DB must not discard 11 fetched assets.
        breadth = {"status": "missing", "as_of": None, "coverage_count": 0,
                   "advancers_pct": None, "above_20d_pct": None, "above_60d_pct": None,
                   "new_high_20d_pct": None, "new_low_20d_pct": None, "source": "radar_market.db",
                   "warning": f"시장 확산 지표 수집 실패: {type(error).__name__}: {str(error)[:200]}"}
    latest_count = sum(asset["freshness"] == "latest" for asset in assets)
    stale_count = sum(asset["freshness"] == "stale" for asset in assets)
    missing_count = sum(asset["freshness"] == "missing" for asset in assets)
    breadth_status = breadth.get("status")
    status = "ok" if missing_count == 0 and stale_count == 0 and breadth_status == "ok" else "partial" if latest_count else "error"
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    return {
        "schema_version": "market-snapshot.v1",
        "generated_at": generated_at,
        "status": status,
        "as_of": max((asset["as_of"] for asset in assets if asset.get("as_of")), default=None),
        "summary": build_summary(assets, breadth),
        "breadth": breadth,
        "assets": assets,
        "source_status": {
            "finance_data_reader": {"status": status, "target_count": len(assets), "latest_count": latest_count, "stale_count": stale_count, "missing_count": missing_count},
            "korea_breadth": breadth,
        },
        "warnings": [asset["warning"] for asset in assets if asset.get("warning")] + ([breadth["warning"]] if breadth.get("warning") else []),
    }


def main() -> int:
    started = datetime.now().astimezone().isoformat(timespec="seconds")
    status = {"run_id": f"markets_{datetime.now().strftime('%Y%m%d_%H%M%S')}", "started_at": started, "status": "running"}
    write_json(config.MARKET_COLLECTOR_STATUS_PATH, status)
    try:
        payload = collect()
    except Exception as error:
        write_json(config.MARKET_COLLECTOR_STATUS_PATH, {**status, "status": "failed", "finished_at": datetime.now().astimezone().isoformat(), "error": f"{type(error).__name__}: {error}"})
        raise
    payload["run_id"] = status["run_id"]
    write_json(config.MARKET_COLLECTOR_STATUS_PATH, {**status, "status": payload["status"], "finished_at": payload["generated_at"], "as_of": payload["as_of"], "warnings": payload["warnings"], "sources": payload["source_status"], "errors": {asset["key"]: asset["collection_error"] for asset in payload["assets"] if asset.get("collection_error")}})
    write_json(config.INTERNAL_MARKET_PATH, payload)
    write_json(config.PUBLIC_MARKET_PATH, payload)
    print(f"Market snapshot {payload['status']}: {payload['source_status']['finance_data_reader']['latest_count']}/{len(payload['assets'])} latest")
    return 0 if payload["status"] != "error" else 1


if __name__ == "__main__":
    raise SystemExit(main())
