"""Bounded market adapters. Never relabel a previous listing as today's data."""
from __future__ import annotations

import io
import json
import math
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import pandas as pd
import requests

from radar_pipeline import config


def cached_listing(kind: str, observed: date) -> pd.DataFrame:
    response = requests.get(
        f"{config.FDR_LISTING_CACHE_URL}/{kind}/{observed.isoformat()}.csv",
        timeout=config.LISTING_HTTP_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    frame = pd.read_csv(io.StringIO(response.content.decode("utf-8-sig")), dtype={"Code": str})
    required = {"Code", "Name", "Close", "Marcap", "Stocks", "Market"} if kind == "krx" else {"Code"}
    if frame.empty or not required.issubset(frame.columns):
        raise ValueError(f"{kind} 종목 목록 형식이 올바르지 않습니다")
    frame.attrs = {"source": "FinanceDataReader KRX cache", "as_of": observed.isoformat()}
    return frame


def naver_listing() -> pd.DataFrame:
    def page(market: str, number: int) -> dict:
        response = requests.get(
            f"{config.NAVER_LISTING_URL}/{market}",
            params={"page": number, "pageSize": config.LISTING_PAGE_SIZE},
            headers={"User-Agent": "value-invest-dashboard/0.1"},
            timeout=config.LISTING_HTTP_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()

    rows = []
    dates = []
    for market in ("KOSPI", "KOSDAQ"):
        first = page(market, 1)
        total = int(first["totalCount"])
        count = math.ceil(total / config.LISTING_PAGE_SIZE)
        if not 1 <= count <= config.LISTING_MAX_PAGES:
            raise ValueError(f"{market} 종목 목록 개수가 올바르지 않습니다")
        with ThreadPoolExecutor(max_workers=4) as executor:
            pages = [first, *executor.map(lambda number: page(market, number), range(2, count + 1))]
        stocks = [stock for result in pages for stock in result["stocks"]]
        codes = [stock["itemCode"] for stock in stocks]
        if len(stocks) != total or len(set(codes)) != total:
            raise ValueError(f"{market} 목록 수집 중 누락/중복이 발생했습니다. 다시 실행해 주세요.")
        for stock in stocks:
            # This endpoint also includes ETF/ETN; they are not company candidates.
            if stock.get("stockEndType") != "stock":
                continue
            code = stock["itemCode"]
            if len(code) != 6 or not code.isdigit():
                continue
            def number(raw: str, formatted: str, scale: int = 1) -> int:
                value = stock.get(raw)
                return int(value) if value is not None else int(str(stock[formatted]).replace(",", "")) * scale
            close = number("closePriceRaw", "closePrice")
            cap = number("marketValueRaw", "marketValue", 100_000_000)
            observed = datetime.fromisoformat(stock["localTradedAt"]).date().isoformat()
            dates.append(observed)
            # Exact KRW capitalization / quote yields shares only when integral.
            # Rounded Korean-unit capitalization must not be used to invent shares.
            shares = cap // close if close > 0 and stock.get("marketValueRaw") is not None and cap % close == 0 else None
            rows.append({"Code": code, "Name": stock["stockName"], "Market": market,
                         "Close": close, "Marcap": cap, "Stocks": shares,
                         "Volume": number("accumulatedTradingVolumeRaw", "accumulatedTradingVolume"),
                         "Amount": number("accumulatedTradingValueRaw", "accumulatedTradingValue", 1_000_000),
                         "QuoteDate": observed})
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise ValueError("네이버 종목 목록이 비어 있습니다")
    frame.attrs = {"source": "Naver Finance market listing", "as_of": max(dates),
                   "collected_at": datetime.now().astimezone().isoformat(),
                   "shares_method": "exact_market_cap_divided_by_quote_when_integral"}
    return frame


def current_listing(completed: date) -> pd.DataFrame:
    try:
        return cached_listing("krx", completed)
    except (requests.RequestException, ValueError) as error:
        frame = naver_listing()
        if frame.attrs["as_of"] < completed.isoformat():
            raise ValueError(f"최신 종목 목록이 없습니다. 필요 기준일: {completed}, 제공일: {frame.attrs['as_of']}") from error
        frame.attrs["warnings"] = [f"{completed} KRX 목록 수집 실패({type(error).__name__})로 네이버 최신 목록을 사용했습니다."]
        return frame


def listing_descriptions(completed: date) -> pd.DataFrame:
    for offset in range(config.LISTING_DESCRIPTION_LOOKBACK_DAYS + 1):
        try:
            return cached_listing("desc", completed - timedelta(days=offset))
        except requests.HTTPError as error:
            if error.response is None or error.response.status_code != 404:
                raise
    raise ValueError("최근 기업 업종·상장일 목록을 찾지 못했습니다")


def bounded_price_frame(symbol: str, start: date, today: date) -> pd.DataFrame:
    # FDR's underlying requests have no timeout. A separate process provides a
    # hard deadline without leaving blocked threads behind or patching requests globally.
    code = """
import contextlib, io, sys
import FinanceDataReader as fdr
with contextlib.redirect_stdout(io.StringIO()):
    frame = fdr.DataReader(sys.argv[1], sys.argv[2], sys.argv[3])
print(frame.to_json(orient='split', date_format='iso'))
"""
    # Yahoo's end date is exclusive: include the requested calendar day.
    result = subprocess.run(
        [sys.executable, "-X", "utf8", "-c", code, symbol, start.isoformat(), (today + timedelta(days=1)).isoformat()],
        capture_output=True, text=True, encoding="utf-8", timeout=config.MARKET_SOURCE_TIMEOUT_SECONDS,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode:
        raise RuntimeError(f"{symbol} 시세 수집 실패: {result.stderr.strip().splitlines()[-1][:300] if result.stderr else '응답 없음'}")
    payload = json.loads(result.stdout)
    frame = pd.DataFrame(payload["data"], columns=payload["columns"], index=pd.to_datetime(payload["index"]))
    return frame.loc[frame.index.date <= today]
