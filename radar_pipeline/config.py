from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "market"
CACHE_DIR = ROOT / "data" / "cache"
PRICE_CHECKPOINT_DIR = CACHE_DIR / "prices"
LOG_DIR = ROOT / "logs"
RULES_PATH = ROOT / "radar" / "rules.v1.json"
PUBLIC_RADAR_PATH = ROOT / "public" / "data" / "radar" / "latest.json"
PUBLIC_STOCK_DETAIL_DIR = ROOT / "public" / "data" / "stocks"
PUBLIC_MARKET_PATH = ROOT / "public" / "data" / "markets" / "latest.json"
INTERNAL_MARKET_PATH = ROOT / "data" / "market" / "markets_latest.json"
INTERNAL_RADAR_PATH = ROOT / "data" / "radar" / "latest.json"
COLLECTOR_STATUS_PATH = DATA_DIR / "collector_status.json"
DATABASE_PATH = DATA_DIR / "radar_market.db"
LISTING_PATH = DATA_DIR / "listing_latest.csv"
EVENTS_PATH = DATA_DIR / "dart_events_latest.json"

PRICE_LOOKBACK_CALENDAR_DAYS = 430
PRICE_WORKERS = 8
DART_WORKERS = 4
DART_BATCH_SIZE = 100
DART_EVENT_LOOKBACK_DAYS = 120
DART_TIMEOUT_SECONDS = 40
DART_RETRIES = 3
MIN_PRICE_COVERAGE_PCT = 95
MIN_DART_FINANCIAL_COVERAGE_PCT = 75

MARKET_LOOKBACK_CALENDAR_DAYS = 430
MARKET_MAX_STALE_DAYS = 7
MARKET_ASSETS = (
    {"key": "sp500", "label": "S&P 500", "group": "global_equity", "symbol": "US500", "unit": "pt", "inverse": False},
    {"key": "nasdaq", "label": "Nasdaq", "group": "global_equity", "symbol": "IXIC", "unit": "pt", "inverse": False},
    {"key": "vix", "label": "VIX", "group": "global_equity", "symbol": "VIX", "unit": "pt", "inverse": True},
    {"key": "kospi", "label": "KOSPI", "group": "korea", "symbol": "KS11", "unit": "pt", "inverse": False},
    {"key": "kosdaq", "label": "KOSDAQ", "group": "korea", "symbol": "KQ11", "unit": "pt", "inverse": False},
    {"key": "usdkrw", "label": "USD/KRW", "group": "fx_rates", "symbol": "USD/KRW", "unit": "KRW", "inverse": True},
    {"key": "dxy", "label": "Dollar Index", "group": "fx_rates", "symbol": "DX-Y.NYB", "unit": "pt", "inverse": True},
    {"key": "us10y", "label": "US 10Y", "group": "fx_rates", "symbol": "US10YT", "unit": "%", "inverse": True},
    {"key": "gold", "label": "Gold", "group": "real_assets", "symbol": "GC=F", "unit": "USD", "inverse": False},
    {"key": "silver", "label": "Silver", "group": "real_assets", "symbol": "SI=F", "unit": "USD", "inverse": False},
    {"key": "wti", "label": "WTI", "group": "real_assets", "symbol": "CL=F", "unit": "USD", "inverse": True},
)


@dataclass(frozen=True)
class ReportPeriod:
    year: int
    report_code: str
    quarter: str

    @property
    def key(self) -> str:
        return f"{self.year}_{self.report_code}"


REPORT_SEQUENCE = (
    ("1Q", "11013"),
    ("2Q", "11012"),
    ("3Q", "11014"),
    ("4Q", "11011"),
)


def latest_available_period(run_date: date) -> ReportPeriod:
    if run_date.month >= 11:
        return ReportPeriod(run_date.year, "11014", "3Q")
    if run_date.month >= 8:
        return ReportPeriod(run_date.year, "11012", "2Q")
    if run_date.month >= 5:
        return ReportPeriod(run_date.year, "11013", "1Q")
    return ReportPeriod(run_date.year - 1, "11011", "4Q")


def recent_report_periods(run_date: date, count: int = 8) -> list[ReportPeriod]:
    latest = latest_available_period(run_date)
    index = next(index for index, item in enumerate(REPORT_SEQUENCE) if item[1] == latest.report_code)
    year = latest.year
    periods: list[ReportPeriod] = []
    for _ in range(count):
        quarter, report_code = REPORT_SEQUENCE[index]
        periods.append(ReportPeriod(year, report_code, quarter))
        index -= 1
        if index < 0:
            index = len(REPORT_SEQUENCE) - 1
            year -= 1
    return periods
