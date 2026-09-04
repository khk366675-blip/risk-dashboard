from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable


QUARTER_ORDER = {"1Q": 1, "2Q": 2, "3Q": 3, "4Q": 4}
LENS_ORDER = ("quality", "improvement", "dislocation", "event")
LENS_LABELS = {
    "quality": "Quality",
    "improvement": "Improvement",
    "dislocation": "Dislocation",
    "event": "Event",
}


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return (current / previous - 1) * 100


def percentile_cutoff(values: Iterable[float | None], percentile: float) -> float | None:
    cleaned = sorted(value for value in values if value is not None and value > 0)
    if not cleaned:
        return None
    index = max(0, math.ceil(len(cleaned) * percentile / 100) - 1)
    return cleaned[index]


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    text = str(value).strip()[:10]
    for pattern in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def safe_round(value: float | None, digits: int = 1) -> float | None:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def ratio_as_pct(value: Any) -> float | None:
    """The legacy DB stores ROE and debt ratio as decimals; expose them as percentages."""
    number = finite_number(value)
    return number * 100 if number is not None else None


@dataclass
class StockSnapshot:
    code: str
    name: str
    market: str
    sector: str
    market_cap: float | None
    valuation: dict[str, Any]
    prices: list[dict[str, Any]]
    quarters: list[dict[str, Any]]
    median_traded_value_20d: float | None
    valuation_updated_at: date | None


def load_rules(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def load_listings(path: Path) -> dict[str, dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        return {row["Code"].zfill(6): row for row in csv.DictReader(file) if row.get("Code")}


def load_quarters(connection: sqlite3.Connection, code: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT year, report_code, account_nm, thstrm_amount
        FROM financials
        WHERE code = ?
          AND account_nm IN ('rev', 'op', 'ocf', 'equity', 'debt', 'data_quality')
        """,
        (code,),
    ).fetchall()
    grouped: dict[tuple[int, str], dict[str, Any]] = defaultdict(dict)
    for row in rows:
        report_code = row["report_code"]
        if report_code not in QUARTER_ORDER:
            continue
        key = (int(row["year"]), report_code)
        if row["account_nm"] == "data_quality":
            grouped[key]["data_quality"] = row["thstrm_amount"]
        else:
            grouped[key][row["account_nm"]] = finite_number(row["thstrm_amount"])
    return [
        {"year": year, "quarter": quarter, **values}
        for (year, quarter), values in sorted(
            grouped.items(), key=lambda item: (item[0][0], QUARTER_ORDER[item[0][1]])
        )
        if values.get("data_quality") != "uncertain"
    ]


def load_prices(connection: sqlite3.Connection, code: str) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in connection.execute(
            "SELECT date, open, high, low, close, volume FROM prices WHERE code = ? ORDER BY date",
            (code,),
        ).fetchall()
    ]


def build_snapshots(
    connection: sqlite3.Connection,
    listings: dict[str, dict[str, str]],
) -> list[StockSnapshot]:
    valuations = [dict(row) for row in connection.execute("SELECT * FROM valuations ORDER BY code")]
    snapshots: list[StockSnapshot] = []
    for valuation in valuations:
        code = str(valuation["code"]).zfill(6)
        listing = listings.get(code, {})
        prices = load_prices(connection, code)
        traded_values = [
            float(row["close"]) * float(row["volume"])
            for row in prices[-20:]
            if finite_number(row.get("close")) is not None and finite_number(row.get("volume")) is not None
        ]
        market_cap = finite_number(listing.get("Marcap")) or finite_number(valuation.get("market_cap"))
        snapshots.append(
            StockSnapshot(
                code=code,
                name=listing.get("Name") or code,
                market=listing.get("Market") or "시장 미분류",
                sector=listing.get("Sector") or listing.get("Dept") or "업종 미수집",
                market_cap=market_cap,
                valuation=valuation,
                prices=prices,
                quarters=load_quarters(connection, code),
                median_traded_value_20d=statistics.median(traded_values) if traded_values else None,
                valuation_updated_at=parse_date(valuation.get("updated_at")),
            )
        )
    return snapshots


def latest_equity(snapshot: StockSnapshot) -> float | None:
    for quarter in reversed(snapshot.quarters):
        if quarter.get("equity") is not None:
            return finite_number(quarter["equity"])
    return None


def is_preferred_share(name: str) -> bool:
    compact = name.replace(" ", "")
    return compact.endswith("우") or compact.endswith("우B") or compact.endswith("우C")


def common_gate(
    snapshot: StockSnapshot,
    rules: dict[str, Any],
    as_of: date,
    *,
    event_mode: bool = False,
) -> tuple[bool, list[str], list[str]]:
    common = rules["common"]
    failures: list[str] = []
    warnings: list[str] = []
    if snapshot.market_cap is None:
        failures.append("시가총액 누락")
    elif snapshot.market_cap < common["market_cap_min_krw"]:
        failures.append("시가총액 기준 미달")
    if snapshot.median_traded_value_20d is None:
        failures.append("거래대금 데이터 누락")
    elif snapshot.median_traded_value_20d < common["median_traded_value_min_krw"]:
        failures.append("20일 중앙 거래대금 기준 미달")
    minimum_price_days = (
        common["event_price_history_min_days"] if event_mode else common["price_history_min_days"]
    )
    if len(snapshot.prices) < minimum_price_days:
        failures.append("가격 이력 부족")
    if common.get("exclude_preferred_shares") and is_preferred_share(snapshot.name):
        failures.append("우선주 별도 Universe")
    if any(token.lower() in snapshot.name.lower() for token in common["exclude_name_contains"]):
        failures.append("별도 자산군")
    equity = latest_equity(snapshot)
    if equity is not None and equity <= 0:
        failures.append("자본 완전잠식 확인")
    if not event_mode:
        if snapshot.valuation_updated_at is None:
            warnings.append("재무 갱신일 누락")
        elif (as_of - snapshot.valuation_updated_at).days > common["financial_max_age_days"]:
            failures.append("재무 데이터 기한 경과")
    latest_price_date = parse_date(snapshot.prices[-1]["date"]) if snapshot.prices else None
    if latest_price_date is None:
        warnings.append("최신 가격 기준일 누락")
    elif (as_of - latest_price_date).days > common["price_max_age_days"]:
        warnings.append(
            f"가격 데이터가 {latest_price_date.isoformat()} 기준으로 오래되어 현재 가격 신호에 사용하지 않음"
        )
    if not snapshot.sector or snapshot.sector == "업종 미수집":
        warnings.append("업종 분류 미수집: 업종 백분위 대신 Universe 백분위 사용")
    if not snapshot.valuation.get("updated_at"):
        warnings.append("수집 시각 누락")
    return not failures, failures, warnings


def evidence(key: str, label: str, value: Any, comparison: str, period: str, source: str) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "value": value,
        "comparison": comparison,
        "period": period,
        "source": source,
    }


def quality_lens(snapshot: StockSnapshot, rules: dict[str, Any]) -> dict[str, Any]:
    config = rules["quality"]
    valuation = snapshot.valuation
    items: list[dict[str, Any]] = []
    contradictions: list[str] = []
    available = 0
    core = 0
    ttm_ocf = finite_number(valuation.get("ttm_ocf"))
    ttm_op = finite_number(valuation.get("ttm_op"))
    ttm_rev = finite_number(valuation.get("ttm_rev"))
    roe = ratio_as_pct(valuation.get("ttm_roe"))
    interest_coverage = finite_number(valuation.get("ttm_icr"))
    debt_ratio = ratio_as_pct(valuation.get("debt_ratio"))

    if ttm_ocf is not None:
        available += 1
        if ttm_ocf > 0:
            core += 1
            items.append(evidence("positive_ocf", "TTM 영업현금흐름 양수", ttm_ocf, "> 0", "TTM", "DART 재무"))
        else:
            contradictions.append("TTM 영업현금흐름이 음수입니다.")

    recent_quarters = snapshot.quarters[-config["profitable_quarters_window"] :]
    op_quarters = [finite_number(quarter.get("op")) for quarter in recent_quarters]
    known_op_quarters = [value for value in op_quarters if value is not None]
    if known_op_quarters:
        available += 1
        profitable = sum(value > 0 for value in known_op_quarters)
        if profitable >= config["profitable_quarters_required"]:
            core += 1
            items.append(
                evidence(
                    "profit_persistence",
                    f"최근 {len(known_op_quarters)}개 분기 중 {profitable}개 영업흑자",
                    profitable,
                    f">= {config['profitable_quarters_required']}",
                    "최근 분기",
                    "DART 재무",
                )
            )

    if ttm_ocf is not None and ttm_op is not None and ttm_op > 0:
        available += 1
        conversion = ttm_ocf / ttm_op
        if conversion >= config["cash_conversion_min"]:
            core += 1
            items.append(evidence("cash_conversion", "영업이익의 현금 전환 양호", safe_round(conversion, 2), f">= {config['cash_conversion_min']}", "TTM", "DART 재무"))
        elif conversion < 0.4:
            contradictions.append("영업이익 대비 영업현금흐름 전환이 낮습니다.")

    for metric, value, threshold, label, key in (
        ("roe", roe, config["roe_min_pct"], "TTM ROE 기준 통과", "roe"),
        ("interest_coverage", interest_coverage, config["interest_coverage_min"], "이자보상 여력 확인", "interest_coverage"),
    ):
        if value is not None:
            available += 1
            if value >= threshold:
                items.append(evidence(key, label, safe_round(value), f">= {threshold}", "TTM", "DART 재무"))

    if debt_ratio is not None:
        available += 1
        if debt_ratio <= config["debt_ratio_max_pct"]:
            items.append(evidence("debt_ratio", "부채비율 기준 통과", safe_round(debt_ratio), f"<= {config['debt_ratio_max_pct']}%", "최근 보고서", "DART 재무"))
        elif debt_ratio > 300:
            contradictions.append("부채비율이 300%를 초과합니다.")

    if ttm_rev is not None and ttm_rev > 0 and ttm_op is not None:
        available += 1
        margin = ttm_op / ttm_rev * 100
        if margin >= config["operating_margin_min_pct"]:
            items.append(
                evidence(
                    "positive_margin",
                    "TTM 영업이익률 기준 통과",
                    safe_round(margin),
                    f">= {config['operating_margin_min_pct']}%",
                    "TTM",
                    "DART 재무",
                )
            )

    coverage = round(available / 7 * 100)
    matched = core >= config["minimum_core_evidence"] and len(items) >= config["minimum_evidence"] and coverage >= config["minimum_coverage_pct"]
    return lens_result("quality", matched, items, contradictions, coverage, config["strong_evidence"], 7)


def prior_year_quarter(snapshot: StockSnapshot) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if not snapshot.quarters:
        return None, None
    current = snapshot.quarters[-1]
    prior = next(
        (
            quarter
            for quarter in reversed(snapshot.quarters[:-1])
            if quarter["year"] == current["year"] - 1 and quarter["quarter"] == current["quarter"]
        ),
        None,
    )
    return current, prior


def improvement_lens(snapshot: StockSnapshot, rules: dict[str, Any]) -> dict[str, Any]:
    config = rules["improvement"]
    items: list[dict[str, Any]] = []
    contradictions: list[str] = []
    available = 0
    business = 0
    financial_support = 0
    current_operating_margin = None
    current, prior = prior_year_quarter(snapshot)
    if not current or not prior:
        return lens_result("improvement", False, [], [], 0, config["strong_evidence"], 6)

    current_period = f"{current['year']}{current['quarter']}"
    revenue_growth = pct_change(finite_number(current.get("rev")), finite_number(prior.get("rev")))
    if revenue_growth is not None:
        available += 1
        if revenue_growth >= config["revenue_yoy_min_pct"]:
            business += 1
            items.append(evidence("revenue_growth", "분기 매출 성장", safe_round(revenue_growth), f">= {config['revenue_yoy_min_pct']}% YoY", current_period, "DART 재무"))
        elif revenue_growth <= -10:
            contradictions.append("최근 분기 매출이 전년 동기 대비 10% 이상 감소했습니다.")

    current_op = finite_number(current.get("op"))
    prior_op = finite_number(prior.get("op"))
    if current_op is not None and prior_op is not None:
        available += 1
        op_growth = pct_change(current_op, prior_op) if prior_op > 0 else None
        if prior_op < 0 <= current_op:
            business += 1
            items.append(evidence("turnaround", "영업손익 흑자전환", current_op, "전년 동기 적자 → 흑자", current_period, "DART 재무"))
        elif op_growth is not None and op_growth >= config["operating_profit_yoy_min_pct"]:
            business += 1
            items.append(evidence("operating_profit_growth", "분기 영업이익 증가", safe_round(op_growth), f">= {config['operating_profit_yoy_min_pct']}% YoY", current_period, "DART 재무"))
        elif prior_op < 0 and current_op < 0 and current_op > prior_op:
            narrowing = (abs(prior_op) - abs(current_op)) / abs(prior_op) * 100 if prior_op else None
            if narrowing is not None and narrowing >= config["loss_narrowing_min_pct"]:
                business += 1
                items.append(evidence("loss_narrowing", "영업손실 축소", safe_round(narrowing), f">= {config['loss_narrowing_min_pct']}% YoY", current_period, "DART 재무"))
        elif prior_op > 0 and current_op / prior_op - 1 <= -0.3:
            contradictions.append("최근 분기 영업이익이 전년 동기 대비 30% 이상 감소했습니다.")

    current_rev = finite_number(current.get("rev"))
    prior_rev = finite_number(prior.get("rev"))
    if current_rev and prior_rev and current_op is not None and prior_op is not None:
        available += 1
        current_operating_margin = current_op / current_rev * 100
        margin_change = (current_op / current_rev - prior_op / prior_rev) * 100
        if margin_change >= config["margin_yoy_min_pp"]:
            business += 1
            items.append(evidence("margin_improvement", "영업이익률 개선", safe_round(margin_change), f">= +{config['margin_yoy_min_pp']}%p YoY", current_period, "DART 재무"))

    current_ocf = finite_number(current.get("ocf"))
    prior_ocf = finite_number(prior.get("ocf"))
    if current_ocf is not None and prior_ocf is not None:
        available += 1
        if (prior_ocf <= 0 < current_ocf) or current_ocf > prior_ocf:
            financial_support += 1
            items.append(evidence("ocf_improvement", "영업현금흐름 개선", current_ocf, "> 전년 동기", current_period, "DART 재무"))
        elif current_ocf < prior_ocf and current_ocf < 0:
            contradictions.append("영업현금흐름이 전년 동기보다 악화됐습니다.")

    current_equity = finite_number(current.get("equity"))
    prior_equity = finite_number(prior.get("equity"))
    current_debt = finite_number(current.get("debt"))
    prior_debt = finite_number(prior.get("debt"))
    if current_equity and prior_equity and current_debt is not None and prior_debt is not None:
        available += 1
        improvement = prior_debt / prior_equity * 100 - current_debt / current_equity * 100
        if improvement >= config["debt_ratio_improvement_min_pp"]:
            financial_support += 1
            items.append(evidence("debt_improvement", "부채비율 개선", safe_round(improvement), f">= {config['debt_ratio_improvement_min_pp']}%p YoY", current_period, "DART 재무"))

    # TTM 매출 성장에는 8개 분기가 필요하다. 데이터가 있을 때만 계산한다.
    if len(snapshot.quarters) >= 8:
        current_four = [finite_number(quarter.get("rev")) for quarter in snapshot.quarters[-4:]]
        prior_four = [finite_number(quarter.get("rev")) for quarter in snapshot.quarters[-8:-4]]
        if all(value is not None for value in current_four + prior_four):
            available += 1
            current_ttm = sum(value for value in current_four if value is not None)
            prior_ttm = sum(value for value in prior_four if value is not None)
            growth = pct_change(current_ttm, prior_ttm)
            if growth is not None and growth >= config["revenue_yoy_min_pct"]:
                items.append(evidence("ttm_revenue_growth", "TTM 매출 성장", safe_round(growth), f">= {config['revenue_yoy_min_pct']}% YoY", "TTM", "DART 재무"))

    coverage = round(available / 6 * 100)
    matched = (
        business >= config["minimum_business_evidence"]
        and financial_support >= config["minimum_financial_support_evidence"]
        and current_operating_margin is not None
        and current_operating_margin >= config["current_operating_margin_min_pct"]
        and len(items) >= config["minimum_evidence"]
        and coverage >= config["minimum_coverage_pct"]
    )
    return lens_result("improvement", matched, items, contradictions, coverage, config["strong_evidence"], 6)


def price_diagnostics(snapshot: StockSnapshot) -> dict[str, float | None]:
    if not snapshot.prices:
        return {"drawdown_52w": None, "return_6m": None, "position_120d": None, "attention_multiple": None}
    latest = finite_number(snapshot.prices[-1].get("close"))
    recent_252 = snapshot.prices[-252:]
    recent_120 = snapshot.prices[-120:]
    highs_252 = [finite_number(row.get("high")) for row in recent_252]
    highs_120 = [finite_number(row.get("high")) for row in recent_120]
    lows_120 = [finite_number(row.get("low")) for row in recent_120]
    valid_highs_252 = [value for value in highs_252 if value is not None]
    valid_highs_120 = [value for value in highs_120 if value is not None]
    valid_lows_120 = [value for value in lows_120 if value is not None]
    high_52w = max(valid_highs_252) if valid_highs_252 else None
    high_120d = max(valid_highs_120) if valid_highs_120 else None
    low_120d = min(valid_lows_120) if valid_lows_120 else None
    drawdown = pct_change(latest, high_52w)
    return_6m = None
    if len(snapshot.prices) >= 121:
        return_6m = pct_change(latest, finite_number(snapshot.prices[-121].get("close")))
    position = None
    if latest is not None and high_120d is not None and low_120d is not None and high_120d > low_120d:
        position = (latest - low_120d) / (high_120d - low_120d) * 100
    traded_values = [
        finite_number(row.get("close")) * finite_number(row.get("volume"))
        for row in snapshot.prices[-20:]
        if finite_number(row.get("close")) is not None and finite_number(row.get("volume")) is not None
    ]
    attention_multiple = None
    if traded_values and statistics.mean(traded_values[:-1] or traded_values) > 0:
        attention_multiple = traded_values[-1] / statistics.mean(traded_values[:-1] or traded_values)
    return {
        "drawdown_52w": drawdown,
        "return_6m": return_6m,
        "position_120d": position,
        "attention_multiple": attention_multiple,
    }


def dislocation_lens(
    snapshot: StockSnapshot,
    rules: dict[str, Any],
    valuation_cutoffs: dict[str, float | None],
    market_return_median: float | None,
    support: bool,
    as_of: date,
) -> dict[str, Any]:
    config = rules["dislocation"]
    diagnostics = price_diagnostics(snapshot)
    items: list[dict[str, Any]] = []
    contradictions: list[str] = []
    available = 0
    drawdown = diagnostics["drawdown_52w"]
    if drawdown is not None:
        available += 1
        if drawdown <= config["drawdown_52w_max_pct"]:
            items.append(evidence("drawdown", "52주 고점 대비 가격 하락", safe_round(drawdown), f"<= {config['drawdown_52w_max_pct']}%", "최근 252거래일", "KRX 가격"))
        if drawdown <= config["extreme_drawdown_52w_max_pct"]:
            items.append(evidence("extreme_drawdown", "극단적 가격 하락 구간", safe_round(drawdown), f"<= {config['extreme_drawdown_52w_max_pct']}%", "최근 252거래일", "KRX 가격"))

    return_6m = diagnostics["return_6m"]
    if return_6m is not None and market_return_median is not None:
        available += 1
        relative = return_6m - market_return_median
        if relative <= config["relative_return_6m_max_pp"]:
            items.append(evidence("relative_weakness", "6개월 Universe 대비 상대 부진", safe_round(relative), f"<= {config['relative_return_6m_max_pp']}%p", "최근 121거래일", "KRX 가격"))

    position = diagnostics["position_120d"]
    if position is not None:
        available += 1
        if position <= config["price_position_120d_max_pct"]:
            items.append(evidence("price_position", "120일 가격 범위 하단", safe_round(position), f"<= {config['price_position_120d_max_pct']}%", "최근 120거래일", "KRX 가격"))

    valuation_item = None
    for key, label in (("per", "PER"), ("pbr", "PBR"), ("ev_ebitda", "EV/EBITDA")):
        value = finite_number(snapshot.valuation.get(key))
        cutoff = valuation_cutoffs.get(key)
        if value is not None and value > 0 and cutoff is not None:
            available += 1 / 3
            if valuation_item is None and value <= cutoff:
                valuation_item = evidence(
                    "valuation_percentile",
                    f"{label}가 수집 Universe 하위 {config['valuation_percentile_max_pct']}%",
                    safe_round(value, 2),
                    f"<= {safe_round(cutoff, 2)}",
                    "최근 수집값",
                    "KRX·DART",
                )
    if valuation_item:
        items.append(valuation_item)
    if not support:
        contradictions.append("가격 괴리를 지지할 수익성·현금흐름·개선 근거가 부족합니다.")
    coverage = round(min(100, available / 4 * 100))
    latest_price_date = parse_date(snapshot.prices[-1]["date"]) if snapshot.prices else None
    price_is_fresh = bool(
        latest_price_date
        and (as_of - latest_price_date).days <= rules["common"]["price_max_age_days"]
    )
    if not price_is_fresh:
        contradictions.append("가격 데이터가 오래되어 현재 Dislocation 후보 판정을 보류했습니다.")
    matched = (
        len(items) >= config["minimum_evidence"]
        and support
        and price_is_fresh
        and coverage >= config["minimum_coverage_pct"]
    )
    return lens_result("dislocation", matched, items, contradictions, coverage, config["strong_evidence"], 5)


def lens_result(
    lens: str,
    matched: bool,
    items: list[dict[str, Any]],
    contradictions: list[str],
    coverage: int,
    strong_evidence: int,
    evidence_opportunities: int,
) -> dict[str, Any]:
    return {
        "lens": lens,
        "label": LENS_LABELS[lens],
        "matched": matched,
        "band": "strong" if len(items) >= strong_evidence else "review",
        "evidence_count": len(items),
        "evidence_ratio_pct": round(min(100, len(items) / evidence_opportunities * 100)),
        "coverage_pct": coverage,
        "evidence": items,
        "contradictions": contradictions,
    }


def load_event_items(path: Path | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if path is None or not path.exists():
        return [], {"status": "missing", "warning": "Event 원천 파일이 없어 Event 렌즈를 실행하지 않았습니다."}
    with path.open(encoding="utf-8") as file:
        payload = json.load(file)
    items = [
        item
        for item in payload.get("items", [])
        if item.get("source") == "dart_filings" and item.get("source_type") == "filing" and item.get("verified") is True
    ]
    return items, {
        "status": "partial" if payload.get("warnings") else "ok",
        "generated_at": payload.get("generated_at"),
        "record_count": len(items),
        "warning_count": len(payload.get("warnings", [])),
    }


def event_lens(
    snapshot: StockSnapshot,
    rules: dict[str, Any],
    event_items: list[dict[str, Any]],
    as_of: date,
) -> dict[str, Any]:
    config = rules["event"]
    cutoff = as_of - timedelta(days=config["lookback_days"])
    relevant = []
    price_rows = snapshot.prices

    def attention_at(item_date: date) -> tuple[float | None, float | None]:
        event_index = next(
            (index for index, row in enumerate(price_rows) if (parse_date(row.get("date")) or date.min) >= item_date),
            None,
        )
        if event_index is None:
            return None, None
        row = price_rows[event_index]
        value = (finite_number(row.get("close")) or 0) * (finite_number(row.get("volume")) or 0)
        prior_values = [
            (finite_number(prior.get("close")) or 0) * (finite_number(prior.get("volume")) or 0)
            for prior in price_rows[max(0, event_index - 20) : event_index]
        ]
        valid_prior = [prior for prior in prior_values if prior > 0]
        baseline = statistics.mean(valid_prior) if valid_prior else None
        multiple = value / baseline if baseline and baseline > 0 else None
        return value, multiple

    for item in event_items:
        if str(item.get("code", "")).zfill(6) != snapshot.code:
            continue
        item_date = parse_date(item.get("date"))
        importance = item.get("metadata", {}).get("importance_hint")
        if not item_date or not (cutoff <= item_date <= as_of) or importance not in config["material_importance_hints"]:
            continue
        traded_value, attention_multiple = attention_at(item_date)
        age_days = (as_of - item_date).days
        is_recent = age_days <= config["recent_event_days"]
        is_recent_risk = importance in config["risk_importance_hints"] and age_days <= config["risk_event_days"]
        has_attention = bool(
            traded_value is not None
            and traded_value >= config["attention_traded_value_min_krw"]
            and attention_multiple is not None
            and attention_multiple >= config["attention_traded_value_multiple"]
        )
        attention_window_match = age_days <= config["attention_event_days"] and has_attention
        ordinary_recent_with_attention = is_recent and has_attention
        if is_recent_risk or ordinary_recent_with_attention or attention_window_match:
            item = dict(item)
            item["_attention_multiple"] = safe_round(attention_multiple, 2)
            relevant.append(item)
    items = []
    contradictions = []
    for item in relevant:
        importance = item.get("metadata", {}).get("importance_hint")
        label = {
            "positive_contract": "중요 공급계약 공시",
            "buyback": "자사주 관련 공시",
            "dilution_risk": "희석 가능 자금조달 공시",
        }.get(importance, "중요 공시")
        items.append(
            evidence(
                f"filing:{item.get('id', '')}",
                label,
                item.get("url"),
                "DART 중요성 분류",
                item.get("date", ""),
                "DART 원문",
            )
        )
        if (
            item.get("_attention_multiple") is not None
            and item["_attention_multiple"] >= config["attention_traded_value_multiple"]
        ):
            items.append(
                evidence(
                    f"attention:{item.get('id', '')}",
                    "공시 전후 거래대금 반응",
                    item["_attention_multiple"],
                    f">= {config['attention_traded_value_multiple']}배",
                    item.get("date", ""),
                    "KRX 가격",
                )
            )
        if importance in config["risk_importance_hints"]:
            contradictions.append("희석 가능성이 있는 자금조달 공시입니다. 조건과 사용처 확인이 필요합니다.")
    return lens_result("event", bool(items), items, contradictions, 100 if items else 0, config["strong_evidence"], 3)


def candidate_from_snapshot(
    snapshot: StockSnapshot,
    lens_results: list[dict[str, Any]],
    warnings: list[str],
    as_of: date,
) -> dict[str, Any] | None:
    matches = [result for result in lens_results if result["matched"]]
    if not matches:
        return None
    primary = max(
        matches,
        key=lambda result: (
            result["evidence_ratio_pct"],
            result["coverage_pct"],
            -LENS_ORDER.index(result["lens"]),
        ),
    )
    contradictions = list(dict.fromkeys(item for result in matches for item in result["contradictions"]))
    latest_price_date = parse_date(snapshot.prices[-1]["date"]) if snapshot.prices else None
    freshness_days = (as_of - latest_price_date).days if latest_price_date else None
    return {
        "code": snapshot.code,
        "name": snapshot.name,
        "market": snapshot.market,
        "sector": snapshot.sector,
        "market_cap_krw": snapshot.market_cap,
        "primary_lens": primary["lens"],
        "matched_lenses": [result["lens"] for result in matches],
        "lenses": {result["lens"]: result for result in lens_results},
        "plot": {
            "evidence_density_pct": primary["evidence_ratio_pct"],
            "coverage_pct": primary["coverage_pct"],
        },
        "contradictions": contradictions,
        "warnings": list(dict.fromkeys(warnings)),
        "as_of": as_of.isoformat(),
        "latest_price_date": latest_price_date.isoformat() if latest_price_date else None,
        "freshness": "latest" if freshness_days is not None and freshness_days <= 3 else "stale",
    }


def diagnostic_reason(failures: list[str]) -> str:
    return failures[0] if failures else "통과"


def focus_sort_key(
    lens: str,
    snapshot: StockSnapshot,
    result: dict[str, Any],
) -> tuple[Any, ...]:
    traded_values = [
        (finite_number(row.get("close")) or 0) * (finite_number(row.get("volume")) or 0)
        for row in snapshot.prices[-20:]
    ]
    liquidity = statistics.median(value for value in traded_values if value > 0) if any(value > 0 for value in traded_values) else 0
    if lens == "event":
        filing_dates = [
            parse_date(item.get("period"))
            for item in result["evidence"]
            if str(item.get("key", "")).startswith("filing:")
        ]
        latest_filing = max((value for value in filing_dates if value), default=date.min)
        return (
            -latest_filing.toordinal(),
            -result["evidence_count"],
            -result["coverage_pct"],
            -liquidity,
            snapshot.code,
        )
    return (
        -result["evidence_count"],
        -result["coverage_pct"],
        len(result["contradictions"]),
        -liquidity,
        -(snapshot.market_cap or 0),
        snapshot.code,
    )


def run(args: argparse.Namespace) -> dict[str, Any]:
    rules = load_rules(args.rules)
    listings = load_listings(args.listing_csv)
    connection = sqlite3.connect(args.database)
    connection.row_factory = sqlite3.Row
    try:
        snapshots = build_snapshots(connection, listings)
    finally:
        connection.close()
    as_of = parse_date(args.as_of) or date.today()

    standard_eligible: list[tuple[StockSnapshot, list[str]]] = []
    event_eligible: dict[str, tuple[StockSnapshot, list[str]]] = {}
    standard_rejections: Counter[str] = Counter()
    event_rejections: Counter[str] = Counter()
    for snapshot in snapshots:
        passed, failures, warnings = common_gate(snapshot, rules, as_of)
        if passed:
            standard_eligible.append((snapshot, warnings))
        else:
            standard_rejections[diagnostic_reason(failures)] += 1
        event_passed, event_failures, event_warnings = common_gate(snapshot, rules, as_of, event_mode=True)
        if event_passed:
            event_eligible[snapshot.code] = (snapshot, list(dict.fromkeys(warnings + event_warnings)))
        else:
            event_rejections[diagnostic_reason(event_failures)] += 1

    valuation_cutoffs = {
        key: percentile_cutoff(
            (finite_number(snapshot.valuation.get(key)) for snapshot, _warnings in standard_eligible),
            rules["dislocation"]["valuation_percentile_max_pct"],
        )
        for key in ("per", "pbr", "ev_ebitda")
    }
    market_returns = [price_diagnostics(snapshot)["return_6m"] for snapshot, _warnings in standard_eligible]
    market_return_median = statistics.median(value for value in market_returns if value is not None) if any(value is not None for value in market_returns) else None
    event_items, event_source_status = load_event_items(args.events_json)

    results_by_code: dict[str, dict[str, Any]] = {}
    lens_counts: Counter[str] = Counter()
    evaluated_by_code: dict[str, tuple[StockSnapshot, list[str], list[dict[str, Any]]]] = {}
    for snapshot, warnings in standard_eligible:
        quality = quality_lens(snapshot, rules)
        improvement = improvement_lens(snapshot, rules)
        support = (
            quality["evidence_count"] >= 2
            or improvement["evidence_count"] >= 2
            or (finite_number(snapshot.valuation.get("ttm_op")) or 0) > 0
            or (finite_number(snapshot.valuation.get("ttm_ocf")) or 0) > 0
        )
        dislocation = dislocation_lens(snapshot, rules, valuation_cutoffs, market_return_median, support, as_of)
        event = event_lens(snapshot, rules, event_items, as_of) if snapshot.code in event_eligible else lens_result("event", False, [], [], 0, rules["event"]["strong_evidence"], 3)
        lens_results = [quality, improvement, dislocation, event]
        evaluated_by_code[snapshot.code] = (snapshot, warnings, lens_results)

    for code, (snapshot, warnings) in event_eligible.items():
        if code in evaluated_by_code:
            continue
        event = event_lens(snapshot, rules, event_items, as_of)
        empty_results = [lens_result(lens, False, [], [], 0, 99, 1) for lens in LENS_ORDER[:-1]]
        evaluated_by_code[code] = (snapshot, warnings, [*empty_results, event])

    qualified_lens_counts: Counter[str] = Counter()
    selected_by_lens: dict[str, set[str]] = {}
    for lens in LENS_ORDER:
        qualified = [
            (code, snapshot, result)
            for code, (snapshot, _warnings, lens_results) in evaluated_by_code.items()
            for result in lens_results
            if result["lens"] == lens and result["matched"]
        ]
        qualified_lens_counts[lens] = len(qualified)
        qualified.sort(key=lambda item: focus_sort_key(lens, item[1], item[2]))
        limit = int(rules[lens].get("focus_limit") or len(qualified))
        selected_by_lens[lens] = {code for code, _snapshot, _result in qualified[:limit]}

    for code, (snapshot, warnings, lens_results) in evaluated_by_code.items():
        for result in lens_results:
            result["qualified"] = result["matched"]
            result["matched"] = result["matched"] and code in selected_by_lens[result["lens"]]
        candidate = candidate_from_snapshot(snapshot, lens_results, warnings, as_of)
        if candidate:
            results_by_code[code] = candidate
            for lens in candidate["matched_lenses"]:
                lens_counts[lens] += 1

    candidates = sorted(
        results_by_code.values(),
        key=lambda candidate: (
            -len(candidate["matched_lenses"]),
            -candidate["plot"]["evidence_density_pct"],
            -candidate["plot"]["coverage_pct"],
            candidate["name"],
        ),
    )
    listing_common_count = sum(
        1
        for listing in listings.values()
        if str(listing.get("Market", "")).startswith(("KOSPI", "KOSDAQ"))
        and not is_preferred_share(listing.get("Name", ""))
        and not any(token.lower() in listing.get("Name", "").lower() for token in rules["common"]["exclude_name_contains"])
    )
    financial_coverage_count = sum(
        any(finite_number(snapshot.valuation.get(key)) is not None for key in ("ttm_rev", "ttm_op", "ttm_ni"))
        for snapshot in snapshots
    )
    warnings = []
    if len(snapshots) < listing_common_count:
        warnings.append(
            f"전체 상장 Universe {listing_common_count:,}개 중 평가 레코드가 있는 {len(snapshots):,}개만 확인했습니다."
        )
    if any(snapshot.sector in {"", "업종 미수집", "nan"} for snapshot in snapshots):
        warnings.append("일부 업종 분류가 없어 Dislocation 밸류에이션은 수집 Universe 백분위를 임시 사용했습니다.")
    warnings.append("감사의견·거래정지·상장폐지 절차의 구조화 데이터는 별도 위험 소스에서 확인해야 합니다.")
    unknown_events = sum(
        item.get("metadata", {}).get("importance_hint") not in rules["event"]["material_importance_hints"]
        for item in event_items
    )
    if unknown_events:
        warnings.append(f"중요성을 구조화하지 못한 DART 공시 {unknown_events}건은 Event 후보로 사용하지 않았습니다.")
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    return {
        "schema_version": "radar-run.v1",
        "rule_version": rules["rule_version"],
        "run_id": f"radar_{as_of.isoformat()}_seed_v1",
        "generated_at": generated_at,
        "as_of": as_of.isoformat(),
        "status": "partial",
        "scope_label": "기존 DB seed 진단 실행",
        "summary": {
            "listing_universe_count": listing_common_count,
            "financial_universe_count": financial_coverage_count,
            "evaluated_universe_count": len(evaluated_by_code),
            "financial_coverage_count": financial_coverage_count,
            "standard_eligible_count": len(standard_eligible),
            "event_eligible_count": len(event_eligible),
            "candidate_unique_count": len(candidates),
            "lens_counts": {lens: lens_counts[lens] for lens in LENS_ORDER},
        },
        "diagnostics": {
            "standard_rejections": dict(standard_rejections.most_common()),
            "event_rejections": dict(event_rejections.most_common()),
            "valuation_cutoffs_universe_fallback": {key: safe_round(value, 2) for key, value in valuation_cutoffs.items()},
            "median_return_6m_pct": safe_round(market_return_median),
            "qualified_lens_counts_before_focus_limit": {
                lens: qualified_lens_counts[lens] for lens in LENS_ORDER
            },
            "focus_limit_per_lens": {lens: rules[lens].get("focus_limit") for lens in LENS_ORDER},
        },
        "source_status": {
            "stock_database": {"status": "partial", "record_count": len(snapshots), "path_redacted": args.database.name},
            "market_listing": {"status": "ok", "record_count": len(listings), "path_redacted": args.listing_csv.name},
            "dart_events": event_source_status,
        },
        "warnings": warnings,
        "candidates": candidates,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2, allow_nan=False)
        file.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the transparent Radar v0 seed evaluator.")
    parser.add_argument("--database", type=Path, required=True, help="SQLite stock database path")
    parser.add_argument("--listing-csv", type=Path, required=True, help="KRX listing snapshot CSV path")
    parser.add_argument("--events-json", type=Path, help="Optional DART source items JSON path")
    parser.add_argument("--rules", type=Path, default=Path("radar/rules.v1.json"))
    parser.add_argument("--output", type=Path, default=Path("data/radar/latest.json"))
    parser.add_argument("--public-output", type=Path, default=Path("public/data/radar/latest.json"))
    parser.add_argument("--as-of", help="Override evaluation date (YYYY-MM-DD)")
    args = parser.parse_args()
    payload = run(args)
    write_json(args.output, payload)
    write_json(args.public_output, payload)
    summary = payload["summary"]
    print(
        f"Radar seed run complete: {summary['candidate_unique_count']} unique candidates / "
        f"{summary['standard_eligible_count']} standard eligible / "
        f"{summary['financial_universe_count']} financial records"
    )
    print(json.dumps(summary["lens_counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
