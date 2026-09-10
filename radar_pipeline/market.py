from __future__ import annotations

import gzip
import hashlib
import json
import math
import re
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from radar_pipeline.market_sources import current_listing, listing_descriptions


SEOUL = ZoneInfo("Asia/Seoul")


def _normalize_code(value: object) -> str:
    if value is None:
        return ""
    text = str(value).split(".")[0].strip()
    return text.zfill(6) if text else ""


def collect_universe(market_date: date | None = None) -> pd.DataFrame:
    market_date = market_date or completed_market_date()
    listing = current_listing(market_date)
    metadata = dict(listing.attrs)
    warnings = list(metadata.get("warnings", []))
    try:
        descriptions = listing_descriptions(market_date)
        metadata["descriptions_as_of"] = descriptions.attrs.get("as_of")
        if metadata["descriptions_as_of"] != market_date.isoformat():
            warnings.append(f"업종·상장일 정보는 {metadata['descriptions_as_of']} 자료입니다. 시세는 별도로 최신 수집합니다.")
    except Exception as error:
        descriptions = None
        warnings.append(f"업종·상장일 정보 수집 실패: {type(error).__name__}. 해당 정보는 미확인으로 유지합니다.")
    if listing is None or listing.empty:
        raise RuntimeError("FinanceDataReader returned an empty KRX listing")
    listing = listing.copy()
    listing["Code"] = listing["Code"].map(_normalize_code)
    if descriptions is not None and not descriptions.empty:
        descriptions = descriptions.copy()
        descriptions["Code"] = descriptions["Code"].map(_normalize_code)
        keep = [column for column in ("Code", "Sector", "Industry", "ListingDate") if column in descriptions.columns]
        listing = listing.merge(descriptions[keep].drop_duplicates("Code"), on="Code", how="left")
    listing = listing[listing["Code"].str.fullmatch(r"\d{6}")].drop_duplicates("Code")
    listing = listing.reset_index(drop=True)
    listing.attrs = {**metadata, "warnings": warnings}
    return listing


def completed_market_date(now: datetime | None = None) -> date:
    now = now.astimezone(SEOUL) if now else datetime.now(SEOUL)
    start = now.date() - timedelta(days=15)
    _code, rows, error = fetch_price_history("005930", start, now.date())
    if error or not rows:
        raise RuntimeError("Unable to determine the latest Korean market date")
    available = sorted(date.fromisoformat(str(row["date"])) for row in rows)
    if available[-1] == now.date() and now.time() < time(16, 0):
        if len(available) < 2:
            raise RuntimeError("No completed market date is available")
        return available[-2]
    return available[-1]


def is_preferred_share(name: str) -> bool:
    compact = str(name).replace(" ", "")
    return compact.endswith("우") or compact.endswith("우B") or compact.endswith("우C")


def is_common_equity(row: pd.Series, excluded_tokens: list[str]) -> bool:
    market = str(row.get("Market", ""))
    name = str(row.get("Name", ""))
    return (
        (market.startswith("KOSPI") or market.startswith("KOSDAQ"))
        and not is_preferred_share(name)
        and not any(token.lower() in name.lower() for token in excluded_tokens)
    )


def _finite(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def fetch_price_history(code: str, start: date, end: date, retries: int = 3) -> tuple[str, list[dict[str, int | str]], str | None]:
    last_error: Exception | None = None
    for _attempt in range(retries):
        try:
            response = requests.get(
                "https://fchart.stock.naver.com/sise.nhn",
                params={"timeframe": "day", "count": 600, "requestType": 0, "symbol": code},
                timeout=20,
                headers={"User-Agent": "value-invest-dashboard/0.1"},
            )
            response.raise_for_status()
            data_items = re.findall(r'<item data="(.*?)"\s*/>', response.text, re.DOTALL)
            if not data_items:
                raise RuntimeError("empty price response")
            rows: list[dict[str, int | str]] = []
            for item in data_items:
                parts = item.split("|")
                if len(parts) != 6:
                    continue
                item_date = datetime.strptime(parts[0], "%Y%m%d").date()
                if item_date < start or item_date > end:
                    continue
                values = [_finite(value) for value in parts[1:]]
                if values[3] is None:
                    continue
                rows.append(
                    {
                        "date": item_date.isoformat(),
                        "open": int(values[0] or values[3]),
                        "high": int(values[1] or values[3]),
                        "low": int(values[2] or values[3]),
                        "close": int(values[3]),
                        "volume": int(values[4] or 0),
                    }
                )
            if not rows:
                raise RuntimeError("no valid price rows")
            return code, rows[-260:], None
        except Exception as exc:  # source-specific errors are returned per ticker
            last_error = exc
    return code, [], f"{type(last_error).__name__}: {last_error}" if last_error else "unknown error"


def collect_price_histories(
    codes: list[str],
    start: date,
    end: date,
    workers: int,
    progress: Callable[[int, int], None] | None = None,
) -> tuple[dict[str, list[dict[str, int | str]]], dict[str, str]]:
    histories: dict[str, list[dict[str, int | str]]] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(fetch_price_history, code, start, end): code for code in codes}
        for completed, future in enumerate(as_completed(futures), start=1):
            code, rows, error = future.result()
            if error:
                errors[code] = error
            else:
                histories[code] = rows
            if progress and (completed % 25 == 0 or completed == len(futures)):
                progress(completed, len(futures))
    return histories, errors


def _price_checkpoint_path(directory: Path, codes: list[str], market_date: date) -> Path:
    fingerprint = hashlib.sha256("\n".join(codes).encode("utf-8")).hexdigest()[:16]
    return directory / f"{market_date.isoformat()}_{fingerprint}.json.gz"


def load_price_checkpoint(
    directory: Path,
    codes: list[str],
    market_date: date,
) -> dict[str, list[dict[str, int | str]]] | None:
    path = _price_checkpoint_path(directory, codes, market_date)
    if not path.exists():
        return None
    try:
        with gzip.open(path, "rt", encoding="utf-8") as file:
            payload = json.load(file)
        histories = payload.get("histories", {})
        if payload.get("market_date") != market_date.isoformat() or set(histories) != set(codes):
            return None
        if not all(rows and rows[-1].get("date") == market_date.isoformat() for rows in histories.values()):
            return None
        return histories
    except (OSError, json.JSONDecodeError, TypeError, AttributeError):
        return None


def save_price_checkpoint(
    directory: Path,
    codes: list[str],
    market_date: date,
    histories: dict[str, list[dict[str, int | str]]],
) -> None:
    if set(histories) != set(codes):
        return
    directory.mkdir(parents=True, exist_ok=True)
    path = _price_checkpoint_path(directory, codes, market_date)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(temporary, "wt", encoding="utf-8", newline="\n") as file:
        json.dump(
            {"market_date": market_date.isoformat(), "histories": histories},
            file,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    temporary.replace(path)


def median_traded_value(rows: list[dict[str, int | str]], days: int = 20) -> float | None:
    values = [
        int(row["close"]) * int(row["volume"])
        for row in rows[-days:]
        if int(row["close"]) > 0 and int(row["volume"]) >= 0
    ]
    return statistics.median(values) if values else None
