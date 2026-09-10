from __future__ import annotations

import hashlib
import io
import json
import math
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Iterable
from xml.etree import ElementTree

import requests

from .config import DART_RETRIES, DART_TIMEOUT_SECONDS, ReportPeriod


DART_BASE_URL = "https://opendart.fss.or.kr/api"


def finite_number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if text in {"", "-", "None", "nan"}:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


class DartClient:
    def __init__(self, api_key: str, cache_dir: Path):
        if not api_key:
            raise ValueError("DART_API_KEY is required")
        self.api_key = api_key
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, endpoint: str, params: dict[str, Any], suffix: str = ".json") -> Path:
        safe_params = {key: value for key, value in params.items() if key != "crtfc_key"}
        digest = hashlib.sha256(json.dumps(safe_params, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:24]
        return self.cache_dir / endpoint.replace(".", "_") / f"{digest}{suffix}"

    def _request(self, endpoint: str, params: dict[str, Any]) -> requests.Response:
        request_params = {**params, "crtfc_key": self.api_key}
        last_error: Exception | None = None
        for attempt in range(DART_RETRIES):
            try:
                response = requests.get(
                    f"{DART_BASE_URL}/{endpoint}",
                    params=request_params,
                    timeout=DART_TIMEOUT_SECONDS,
                    headers={"User-Agent": "value-invest-dashboard/0.1"},
                )
                response.raise_for_status()
                return response
            except Exception as exc:
                last_error = exc
                time.sleep(0.8 * (2**attempt))
        # requests exceptions can contain the full URL with crtfc_key.
        raise RuntimeError(f"DART request failed for {endpoint}: {type(last_error).__name__}")

    def json(self, endpoint: str, params: dict[str, Any], *, refresh: bool) -> dict[str, Any]:
        cache_path = self._cache_path(endpoint, params)
        if cache_path.exists() and not refresh:
            try:
                with cache_path.open(encoding="utf-8") as file:
                    return json.load(file)
            except (json.JSONDecodeError, OSError):
                # An interrupted prior process must not make the persistent
                # cache authoritative. Re-fetch and replace it atomically.
                pass

        last_error: Exception | None = None
        payload: dict[str, Any] | None = None
        for attempt in range(DART_RETRIES):
            try:
                candidate = self._request(endpoint, params).json()
                if not isinstance(candidate, dict):
                    raise ValueError("DART JSON root is not an object")
                payload = candidate
                break
            except (requests.JSONDecodeError, json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                time.sleep(0.8 * (2**attempt))
        if payload is None:
            raise RuntimeError(f"DART returned invalid JSON for {endpoint}: {last_error}")
        status = payload.get("status")
        if status not in {"000", "013"}:
            raise RuntimeError(f"DART {endpoint} error {status}: {payload.get('message')}")
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_suffix(cache_path.suffix + ".tmp")
        with temporary.open("w", encoding="utf-8", newline="\n") as file:
            json.dump(payload, file, ensure_ascii=False, allow_nan=False)
        temporary.replace(cache_path)
        return payload

    def corporation_codes(self, *, refresh: bool = True) -> dict[str, dict[str, str]]:
        params: dict[str, Any] = {}
        cache_path = self._cache_path("corpCode.xml", params, suffix=".zip")
        if cache_path.exists() and not refresh:
            content = cache_path.read_bytes()
        else:
            content = self._request("corpCode.xml", params).content
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(content)
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            xml_name = next(name for name in archive.namelist() if name.lower().endswith(".xml"))
            root = ElementTree.fromstring(archive.read(xml_name))
        result: dict[str, dict[str, str]] = {}
        for item in root.findall("list"):
            stock_code = (item.findtext("stock_code") or "").strip()
            if len(stock_code) != 6:
                continue
            result[stock_code] = {
                "corp_code": (item.findtext("corp_code") or "").strip(),
                "corp_name": (item.findtext("corp_name") or "").strip(),
                "modify_date": (item.findtext("modify_date") or "").strip(),
            }
        return result

    def multi_accounts(
        self,
        corp_codes: list[str],
        periods: list[ReportPeriod],
        *,
        batch_size: int,
        workers: int,
        refresh_period_keys: set[str],
        progress: Callable[[int, int], None] | None = None,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        tasks = [
            (period, batch)
            for period in periods
            for batch in chunks(corp_codes, batch_size)
        ]
        records: list[dict[str, Any]] = []
        errors: list[str] = []

        def fetch_batch(period: ReportPeriod, batch: list[str]) -> list[dict[str, Any]]:
            try:
                payload = self.json(
                    "fnlttMultiAcnt.json",
                    {
                        "corp_code": ",".join(batch),
                        "bsns_year": str(period.year),
                        "reprt_code": period.report_code,
                    },
                    refresh=period.key in refresh_period_keys,
                )
                return payload.get("list", []) if payload.get("status") == "000" else []
            except RuntimeError as exc:
                # DART occasionally returns an empty 200 response for a legal
                # 100-company request. Split only the failed group so successful
                # batches remain cached and traceable.
                if "invalid JSON" not in str(exc) or len(batch) <= 1:
                    raise
                midpoint = len(batch) // 2
                return fetch_batch(period, batch[:midpoint]) + fetch_batch(period, batch[midpoint:])

        def fetch(task: tuple[ReportPeriod, list[str]]) -> list[dict[str, Any]]:
            period, batch = task
            return fetch_batch(period, batch)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(fetch, task): task for task in tasks}
            for completed, future in enumerate(as_completed(futures), start=1):
                period, batch = futures[future]
                try:
                    records.extend(future.result())
                except Exception as exc:
                    errors.append(f"{period.key}:{batch[0]}.. ({type(exc).__name__}: {exc})")
                if progress and (completed % 5 == 0 or completed == len(tasks)):
                    progress(completed, len(tasks))
        return records, errors

    def full_accounts(
        self,
        corp_code: str,
        period: ReportPeriod,
        *,
        refresh: bool,
    ) -> list[dict[str, Any]]:
        for fs_div in ("CFS", "OFS"):
            payload = self.json(
                "fnlttSinglAcntAll.json",
                {
                    "corp_code": corp_code,
                    "bsns_year": str(period.year),
                    "reprt_code": period.report_code,
                    "fs_div": fs_div,
                },
                refresh=refresh,
            )
            if payload.get("status") == "000" and payload.get("list"):
                return [{**row, 'fs_div': row.get('fs_div', fs_div)} for row in payload['list']]
        return []

    def full_accounts_many(
        self,
        code_to_corp: dict[str, str],
        periods: list[ReportPeriod],
        *,
        workers: int,
        refresh_period_keys: set[str],
        progress: Callable[[int, int], None] | None = None,
    ) -> tuple[dict[tuple[str, str], list[dict[str, Any]]], list[str]]:
        tasks = [(code, corp_code, period) for code, corp_code in code_to_corp.items() for period in periods]
        results: dict[tuple[str, str], list[dict[str, Any]]] = {}
        errors: list[str] = []

        def fetch(task: tuple[str, str, ReportPeriod]) -> tuple[str, str, list[dict[str, Any]]]:
            code, corp_code, period = task
            records = self.full_accounts(corp_code, period, refresh=period.key in refresh_period_keys)
            return code, period.key, records

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(fetch, task): task for task in tasks}
            for completed, future in enumerate(as_completed(futures), start=1):
                code, _corp_code, period = futures[future]
                try:
                    result_code, period_key, records = future.result()
                    results[(result_code, period_key)] = records
                except Exception as exc:
                    errors.append(f"{code}:{period.key} ({type(exc).__name__}: {exc})")
                if progress and (completed % 25 == 0 or completed == len(tasks)):
                    progress(completed, len(tasks))
        return results, errors

    def disclosure_events(
        self,
        start: date,
        end: date,
        *,
        workers: int = 4,
        progress: Callable[[int, int, str], None] | None = None,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        # These are the only detail groups that can produce the Event Radar
        # categories currently supported by classify_event().
        disclosure_types = ("B001", "E001", "E002", "I001")
        windows: list[tuple[date, date]] = []
        window_start = start
        while window_start <= end:
            # DART limits market-wide disclosure searches without corp_code to three months.
            window_end = min(window_start + timedelta(days=80), end)
            windows.append((window_start, window_end))
            window_start = window_end + timedelta(days=1)

        tasks = [
            (index, window_start, window_end, corp_cls, disclosure_type)
            for index, (window_start, window_end, corp_cls, disclosure_type) in enumerate(
                (
                    (window_start, window_end, corp_cls, disclosure_type)
                    for window_start, window_end in windows
                    for corp_cls in ("Y", "K")
                    for disclosure_type in disclosure_types
                ),
                start=1,
            )
        ]
        records: list[dict[str, Any]] = []
        errors: list[str] = []

        def fetch(task: tuple[int, date, date, str, str]) -> tuple[list[dict[str, Any]], list[str]]:
            query_index, window_start, window_end, corp_cls, disclosure_type = task
            query_records: list[dict[str, Any]] = []
            query_errors: list[str] = []
            page = 1
            total_page = 1
            # Old fixed windows are immutable for this search. Corrections are
            # new filings and appear in the current window, which is always refreshed.
            refresh = window_end >= end - timedelta(days=7)
            while page <= total_page:
                try:
                    payload = self.json(
                        "list.json",
                        {
                            "bgn_de": window_start.strftime("%Y%m%d"),
                            "end_de": window_end.strftime("%Y%m%d"),
                            "last_reprt_at": "Y",
                            "corp_cls": corp_cls,
                            "pblntf_detail_ty": disclosure_type,
                            "page_no": page,
                            "page_count": 100,
                        },
                        refresh=refresh,
                    )
                except Exception as exc:
                    query_errors.append(
                        f"{window_start}:{window_end},corp_cls={corp_cls},"
                        f"type={disclosure_type},page={page}: {type(exc).__name__}: {exc}"
                    )
                    break
                if payload.get("status") == "013":
                    break
                query_records.extend(payload.get("list", []))
                total_page = int(payload.get("total_page") or 1)
                if progress and (page == 1 or page == total_page or page % 10 == 0):
                    progress(query_index, len(tasks), f"{corp_cls}/{disclosure_type} {page}/{total_page}")
                page += 1
            return query_records, query_errors

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(fetch, task) for task in tasks]
            for future in as_completed(futures):
                query_records, query_errors = future.result()
                records.extend(query_records)
                errors.extend(query_errors)
        unique = {record.get("rcept_no"): record for record in records if record.get("rcept_no")}
        return list(unique.values()), errors


ACCOUNT_IDS = {
    "rev": {
        "ifrs-full_Revenue",
        "ifrs_Revenue",
        "ifrs-full_RevenueFromContractsWithCustomers",
    },
    "op": {"dart_OperatingIncomeLoss"},
    "ni_parent": {"ifrs-full_ProfitLossAttributableToOwnersOfParent"},
    "ni": {"ifrs-full_ProfitLoss", "ifrs_ProfitLoss"},
    "equity_parent": {"ifrs-full_EquityAttributableToOwnersOfParent"},
    "equity": {"ifrs-full_Equity"},
    "debt": {"ifrs-full_Liabilities"},
    "ocf": {"ifrs-full_CashFlowsFromUsedInOperatingActivities"},
    "interest": {"ifrs-full_InterestExpense", "dart_InterestExpense"},
    "cash": {"ifrs-full_CashAndCashEquivalents"},
    "short_debt": {"ifrs-full_ShorttermBorrowings"},
    "current_long_debt": {"ifrs-full_CurrentPortionOfLongtermBorrowings"},
    "bonds": {"ifrs-full_BondsIssued", "ifrs-full_Bonds"},
    "long_debt": {"ifrs-full_LongtermBorrowings"},
}

ACCOUNT_NAMES = {
    "rev": {"매출액", "수익(매출액)", "영업수익", "수익"},
    "op": {"영업이익", "영업이익(손실)"},
    "ni_parent": {"지배기업의 소유주에게 귀속되는 당기순이익(손실)", "지배기업 소유주지분 순이익"},
    "ni": {"당기순이익", "당기순이익(손실)"},
    "equity_parent": {"지배기업의 소유주에게 귀속되는 자본", "지배기업 소유주지분"},
    "equity": {"자본총계"},
    "debt": {"부채총계"},
    "ocf": {"영업활동현금흐름", "영업활동으로 인한 현금흐름"},
    "interest": {"이자비용"},
    "cash": {"현금및현금성자산"},
    "short_debt": {"단기차입금"},
    "current_long_debt": {"유동성장기부채", "유동성장기차입금"},
    "bonds": {"사채"},
    "long_debt": {"장기차입금"},
}


def preferred_statement_rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cfs = [record for record in records if record.get("fs_div") == "CFS"]
    return cfs or [record for record in records if record.get("fs_div") == "OFS"] or records


def find_record(records: list[dict[str, Any]], metric: str, statement: set[str] | None = None) -> dict[str, Any] | None:
    candidates = [record for record in records if statement is None or record.get("sj_div") in statement]
    for key in (metric,):
        ids = ACCOUNT_IDS.get(key, set())
        for account_id in ids:
            match = next((record for record in candidates if record.get("account_id") == account_id), None)
            if match:
                return match
        names = ACCOUNT_NAMES.get(key, set())
        for account_name in names:
            match = next((record for record in candidates if str(record.get("account_nm", "")).strip() == account_name), None)
            if match:
                return match
    return None


def metric_value(records: list[dict[str, Any]], metric: str, field: str, statement: set[str] | None = None) -> float | None:
    candidates = [r for r in records if statement is None or r.get('sj_div') in statement]
    matches = [r for r in candidates if r.get('account_id') in ACCOUNT_IDS.get(metric, set())]
    if not matches:
        matches = [r for r in candidates if str(r.get('account_nm', '')).strip() in ACCOUNT_NAMES.get(metric, set())]
    if not matches or any(r.get('currency') not in ('KRW', '원') for r in matches):
        return None
    values = [finite_number(r.get(field)) for r in matches]
    return values[0] if all(v is not None for v in values) and len(set(values)) == 1 else None


def parse_major_quarters(
    records: list[dict[str, Any]],
    periods: list[ReportPeriod],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[tuple[str, int, str], list[dict[str, Any]]] = {}
    period_by_pair = {(period.year, period.report_code): period for period in periods}
    for record in records:
        code = str(record.get("stock_code", "")).zfill(6)
        try:
            pair = (int(record.get("bsns_year")), str(record.get("reprt_code")))
        except (TypeError, ValueError):
            continue
        if len(code) != 6 or pair not in period_by_pair:
            continue
        grouped.setdefault((code, pair[0], pair[1]), []).append(record)

    raw_quarters: dict[str, dict[tuple[int, str], dict[str, Any]]] = {}
    for (code, year, report_code), period_records in grouped.items():
        period = period_by_pair[(year, report_code)]
        rows = preferred_statement_rows(period_records)
        revenue = metric_value(rows, "rev", "thstrm_amount", {"IS", "CIS"})
        operating_profit = metric_value(rows, "op", "thstrm_amount", {"IS", "CIS"})
        # Keep numerator/denominator on a consistent total-company basis.
        # Parent-attributable financials are separately verified by the research collector.
        net_income = metric_value(rows, "ni", "thstrm_amount", {"IS", "CIS"})
        equity = metric_value(rows, "equity", "thstrm_amount", {"BS"})
        debt = metric_value(rows, "debt", "thstrm_amount", {"BS"})
        raw_quarters.setdefault(code, {})[(year, period.quarter)] = {
            "year": year,
            "quarter": period.quarter,
            "report_code": report_code,
            "statement_basis": rows[0].get("fs_div") if rows else None,
            "rev": revenue,
            "op": operating_profit,
            "ni": net_income,
            "equity": equity,
            "debt": debt,
            "_reported_ytd": {metric: metric_value(rows, metric, 'thstrm_amount' if period.quarter == '4Q' else 'thstrm_add_amount', {'IS','CIS'}) for metric in ('rev','op','ni')},
            "data_quality": "ok" if revenue is not None and operating_profit is not None else "partial",
        }

    result: dict[str, list[dict[str, Any]]] = {}
    quarter_order = {"1Q": 1, "2Q": 2, "3Q": 3, "4Q": 4}
    for code, quarter_map in raw_quarters.items():
        quarters = sorted(quarter_map.values(), key=lambda row: (row["year"], quarter_order[row["quarter"]]))
        for quarter in quarters:
            if quarter["quarter"] != "4Q":
                continue
            previous = [
                item
                for item in quarters
                if item["year"] == quarter["year"] and quarter_order[item["quarter"]] < 4 and item.get("statement_basis") == quarter.get("statement_basis")
            ]
            for metric in ("rev", "op", "ni"):
                annual = quarter.get(metric)
                prior_values = [item.get(metric) for item in previous]
                prior_ytd = next((q['_reported_ytd'][metric] for q in previous if q['quarter'] == '3Q'), None)
                if annual is not None and prior_ytd is not None:
                    quarter[metric] = annual - prior_ytd
                elif annual is not None and len(prior_values) == 3 and all(value is not None for value in prior_values):
                    quarter[metric] = annual - sum(float(value) for value in prior_values if value is not None)
                else:
                    quarter[metric] = None
                    quarter["data_quality"] = "partial"
        for quarter in quarters:
            group = [q for q in quarters if q['year']==quarter['year'] and quarter_order[q['quarter']]<=quarter_order[quarter['quarter']] and q.get('statement_basis')==quarter.get('statement_basis')]
            if len(group)!=quarter_order[quarter['quarter']]:continue
            for metric in ('rev','op','ni'):
                cumulative=quarter['_reported_ytd'].get(metric)
                if cumulative is not None and all(q.get(metric) is not None for q in group) and sum(q[metric] for q in group)!=cumulative:
                    for q in group:
                        if metric not in q.setdefault('noncomparable_metrics',[]):q['noncomparable_metrics'].append(metric)
                        q['data_quality']='partial'
        for quarter in quarters:quarter.pop('_reported_ytd',None)
        result[code] = quarters
    return result


def parse_full_enrichment(
    responses: dict[tuple[str, str], list[dict[str, Any]]],
    periods: list[ReportPeriod],
) -> dict[str, dict[tuple[int, str], dict[str, float | None]]]:
    result: dict[str, dict[tuple[int, str], dict[str, float | None]]] = {}
    period_by_key = {period.key: period for period in periods}
    quarter_order = {"1Q": 1, "2Q": 2, "3Q": 3, "4Q": 4}
    for (code, period_key), records in responses.items():
        period = period_by_key[period_key]
        rows = preferred_statement_rows(records)
        ocf_cumulative = metric_value(rows, "ocf", "thstrm_amount", {"CF"})
        interest = metric_value(rows, "interest", "thstrm_amount", {"IS", "CIS"})
        cash = metric_value(rows, "cash", "thstrm_amount", {"BS"})
        debt_parts = [
            metric_value(rows, metric, "thstrm_amount", {"BS"})
            for metric in ("short_debt", "current_long_debt", "bonds", "long_debt")
        ]
        # Missing components and overlapping current/long-term disclosures do not
        # establish total financial debt. Do not infer EV from an incomplete sum.
        financial_debt = None
        result.setdefault(code, {})[(period.year, period.quarter)] = {
            "ocf_cumulative": ocf_cumulative,
            "interest": interest,
            "cash": cash,
            "fin_debt": financial_debt,
            "statement_basis": rows[0].get("fs_div") if rows else None,
        }

    for code, quarter_map in result.items():
        ordered = sorted(quarter_map.items(), key=lambda item: (item[0][0], quarter_order[item[0][1]]))
        for index, ((year, quarter), values) in enumerate(ordered):
            cumulative = values.pop("ocf_cumulative", None)
            prior_cumulative = 0 if quarter == "1Q" else None
            if index > 0:
                (prior_year, prior_quarter), prior_values = ordered[index - 1]
                if prior_year == year and quarter_order[prior_quarter] == quarter_order[quarter] - 1 and prior_values.get("statement_basis") == values.get("statement_basis"):
                    prior_cumulative = prior_values.get("ocf_ytd")
            values["ocf"] = cumulative - prior_cumulative if cumulative is not None and prior_cumulative is not None else None
            values["ocf_ytd"] = cumulative
            if quarter == "4Q" and values.get("interest") is not None:
                previous_interest = [
                    prior_values.get("interest")
                    for (prior_year, prior_quarter), prior_values in ordered
                    if prior_year == year and quarter_order[prior_quarter] < 4 and prior_values.get("statement_basis") == values.get("statement_basis")
                ]
                if len(previous_interest) == 3 and all(value is not None for value in previous_interest):
                    values["interest"] = values["interest"] - sum(float(value) for value in previous_interest if value is not None)
                else:
                    values["interest"] = None
    return result


def classify_event(report_name: str) -> str | None:
    compact = report_name.replace(" ", "")
    if any(token in compact for token in ("단일판매", "공급계약체결")):
        return "positive_contract"
    if any(token in compact for token in ("자기주식취득", "자기주식소각", "주식소각")):
        return "buyback"
    if any(token in compact for token in ("유상증자결정", "전환사채권발행결정", "신주인수권부사채권발행결정", "교환사채권발행결정")):
        return "dilution_risk"
    return None


def event_source_payload(disclosures: list[dict[str, Any]], warnings: list[str], generated_at: str) -> dict[str, Any]:
    items = []
    for record in disclosures:
        importance = classify_event(str(record.get("report_nm", "")))
        if not importance:
            continue
        receipt_number = str(record.get("rcept_no", ""))
        code = str(record.get("stock_code", "")).zfill(6)
        items.append(
            {
                "id": f"dart:{receipt_number}",
                "source": "dart_filings",
                "source_type": "filing",
                "date": str(record.get("rcept_dt", "")),
                "title": str(record.get("report_nm", "")),
                "code": code,
                "name": str(record.get("corp_name", "")),
                "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt_number}",
                "summary": "",
                "category": "filing",
                "themes": [],
                "raw_text": "",
                "verified": True,
                "metadata": {
                    "corp_code": record.get("corp_code"),
                    "report_nm": record.get("report_nm"),
                    "rcept_no": receipt_number,
                    "importance_hint": importance,
                    "direction_hint": "risk" if importance == "dilution_risk" else "review",
                    "action_hint": "risk_check" if importance == "dilution_risk" else "review",
                },
            }
        )
    return {
        "generated_at": generated_at,
        "sources": {"dart_filings": {"status": "partial" if warnings else "ok", "record_count": len(disclosures)}},
        "items": items,
        "warnings": warnings,
    }
