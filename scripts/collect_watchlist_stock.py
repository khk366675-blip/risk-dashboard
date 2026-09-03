from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from radar_pipeline import config
from radar_pipeline.dart import DartClient, classify_event
from radar_pipeline.market import completed_market_date, fetch_price_history
from research.financials import normalize_financials, research_valuation
from scripts.export_stock_details import write_json, finite

SETTINGS = json.loads((config.ROOT / 'research/config.json').read_text(encoding='utf-8'))


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


class Collector:
    def __init__(self, code: str, job_id: str, directory: Path):
        self.code, self.job_id, self.directory = code, job_id, directory
        self.db = sqlite3.connect(directory / SETTINGS['database_name'], timeout=5)
        self.db.row_factory = sqlite3.Row
        self.job = self.db.execute('SELECT * FROM research_jobs WHERE code=? AND job_id=?', (code, job_id)).fetchone()
        row = self.db.execute('SELECT * FROM watchlist WHERE code=?', (code,)).fetchone()
        if not self.job or not row:
            raise ValueError('등록된 수집 작업이 없습니다.')
        self.payload = json.loads(row['detail_json'])
        self.original = copy.deepcopy(self.payload)
        self.dart: DartClient | None = None
        self.corp_code: str | None = None

    def save(self, step: str, state='running', error=None):
        self.payload.update(generated_at=now(), research_run_id=self.job_id, data_level='research')
        self.payload['warnings'] = list(dict.fromkeys(
            [source['warning'] for source in self.payload.get('source_status', {}).values() if source.get('warning')]
        ))
        with self.db:
            updated = self.db.execute("UPDATE research_jobs SET step=?,state=?,error=?,updated_at=? WHERE code=? AND job_id=? AND state='running'",
                                      (step, state, error, now(), self.code, self.job_id)).rowcount
            if not updated:
                raise RuntimeError('다른 실행으로 교체된 작업입니다.')
            self.db.execute('UPDATE watchlist SET detail_json=? WHERE code=?',
                            (json.dumps(self.payload, ensure_ascii=False, allow_nan=False), self.code))

    def client(self):
        if self.dart is None:
            self.dart = DartClient(os.environ.get('DART_API_KEY', ''), config.CACHE_DIR / 'watchlist-dart' / self.code)
            corporations = self.dart.corporation_codes(refresh=False)
            if self.code not in corporations:
                corporations = self.dart.corporation_codes(refresh=True)
            self.corp_code = corporations[self.code]['corp_code']
        return self.dart

    def prices(self):
        market_date = completed_market_date()
        _, prices, error = fetch_price_history(self.code, market_date - timedelta(days=config.PRICE_LOOKBACK_CALENDAR_DAYS), market_date)
        if error or not prices or prices[-1]['date'] != market_date.isoformat():
            raise RuntimeError('최신 완료 거래일 가격을 확인하지 못했습니다.')
        close = prices[-1]['close']
        previous = prices[-2]['close'] if len(prices) > 1 else None
        high = max(row['high'] for row in prices[-252:])
        low = min(row['low'] for row in prices[-252:])
        # Do not carry an old market cap into apparently current valuation ratios.
        market_cap = None
        warning = None
        try:
            import FinanceDataReader as fdr
            listing = fdr.StockListing('KRX')
            row = listing[listing['Code'].astype(str).str.zfill(6) == self.code].iloc[0]
            shares = finite(row.get('Stocks'))
            market_cap = shares * close if shares and shares > 0 else None
        except Exception:
            warning = '최신 주식 수를 확인하지 못해 시가총액과 관련 배율을 표시하지 않습니다.'
        self.payload['prices'] = prices
        self.payload['summary'] = {'latest_price': close, 'change_1d_pct': (close / previous - 1) * 100 if previous else None,
            'price_as_of': market_date.isoformat(), 'market_cap_krw': market_cap, 'high_52w': high, 'low_52w': low,
            'drawdown_52w_pct': (close / high - 1) * 100 if high else None,
            'price_position_52w_pct': (close-low)/(high-low)*100 if high > low else None}
        self.payload['source_status']['prices'] = {'status': 'ok' if market_cap is not None else 'partial', 'source': '네이버 금융 일별 시세 · KRX 상장주식 수',
            'as_of': market_date.isoformat(), 'collected_at': now(), 'run_id': self.job_id, 'record_count': len(prices), 'warning': warning}
        if self.payload.get('quarters'):
            self.payload['valuation'] = research_valuation(self.payload['quarters'], market_cap)
        else:
            # The old preview's ratios use an older market cap. Keep no mixed-date ratios.
            self.payload['valuation'].update(per=None, pbr=None, ev_operating_profit=None)

    def financials(self):
        client = self.client()
        periods = config.recent_report_periods(datetime.now().date(), SETTINGS['financial_quarters'])
        oldest_year = min(period.year for period in periods)
        latest_serial = periods[0].year * 4 + int(periods[0].quarter[0])
        periods = [config.ReportPeriod(year, report, quarter) for year in range(oldest_year, periods[0].year + 1)
                   for quarter, report in config.REPORT_SEQUENCE if year * 4 + int(quarter[0]) <= latest_serial]
        documents = []
        states = []
        raw_dir = self.directory / 'raw' / self.code
        prior_states = {doc['period']: doc for doc in self.original.get('financial_documents', [])}
        for index, period in enumerate(periods):
            self.save(f'재무 원자료 확인 {index + 1}/{len(periods)} · {period.year} {period.quarter}')
            raw_path = raw_dir / f'{period.key}.json'
            document = None
            if self.job['mode'] == 'retry' and prior_states.get(period.key, {}).get('status') == 'ok' and raw_path.exists():
                try:
                    document = json.loads(raw_path.read_text(encoding='utf-8'))
                except (ValueError, OSError):
                    document = None
            if document is None:
                try:
                    rows, basis = [], None
                    for fs_div in ('CFS', 'OFS'):
                        result = client.json('fnlttSinglAcntAll.json', {'corp_code': self.corp_code, 'bsns_year': str(period.year), 'reprt_code': period.report_code, 'fs_div': fs_div}, refresh=True)
                        if result.get('list'):
                            rows, basis = result['list'], fs_div
                            break
                    if not rows:
                        raise ValueError('재무 보고서 미제공')
                    receipt = next((row.get('rcept_no') for row in rows if re.fullmatch(r'\d{14}', str(row.get('rcept_no', '')))), None)
                    document = {'year': period.year, 'quarter': period.quarter, 'basis': basis, 'rows': rows, 'receipt_no': receipt, 'collected_at': now()}
                    write_json(raw_path, document)
                except Exception:
                    states.append({'period': period.key, 'status': 'error', 'warning': f'{period.year} {period.quarter} 원자료를 확인하지 못했습니다.'})
                    # Keep the previous complete source rather than replacing it
                    # with failed values. New successful raw reports remain retryable.
                    continue
            documents.append(document)
            states.append({'period': period.key, 'status': 'ok', 'collected_at': document['collected_at'], 'receipt_no': document.get('receipt_no'), 'basis': document['basis']})
        self.payload['financial_documents'] = states
        if any(state['status'] != 'ok' for state in states):
            raise RuntimeError('일부 재무 보고서 수집 실패')
        quarters = normalize_financials(documents, SETTINGS['financial_quarters'])
        if not quarters:
            raise RuntimeError('재무자료 없음')
        self.payload['quarters'] = quarters
        self.payload['valuation'] = research_valuation(quarters, self.payload['summary'].get('market_cap_krw'))
        missing = sum(1 for row in quarters for key in ('rev', 'op', 'ni', 'ocf', 'equity', 'debt') if row.get(key) is None)
        mixed = len({row['statement_basis'] for row in quarters[-4:]}) > 1
        self.payload['source_status']['financials'] = {'status': 'partial' if missing or mixed else 'ok', 'source': 'DART 단일회사 전체 재무제표',
            'as_of': f"{quarters[-1]['year']} {quarters[-1]['quarter']}", 'collected_at': now(), 'run_id': self.job_id, 'quarter_count': len(quarters),
            'warning': f'{missing}개 재무 항목 미확인. 연결/별도 기준이 달라지는 구간은 합산하지 않습니다.' if missing or mixed else None}

    def filings(self):
        client = self.client()
        end = datetime.now().date()
        start = end - timedelta(days=SETTINGS['filing_lookback_days'])
        events = []
        page = 1
        while True:
            self.save(f'회사 공시 확인 · {page}페이지')
            result = client.json('list.json', {'corp_code': self.corp_code, 'bgn_de': start.strftime('%Y%m%d'), 'end_de': end.strftime('%Y%m%d'),
                'last_reprt_at': 'N', 'page_no': page, 'page_count': 100, 'sort': 'date', 'sort_mth': 'desc'}, refresh=True)
            for row in result.get('list', []):
                receipt = str(row.get('rcept_no', ''))
                title = str(row.get('report_nm', ''))
                events.append({'id': f'dart:{receipt}', 'date': row.get('rcept_dt'), 'title': title,
                    'url': f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt}' if re.fullmatch(r'\d{14}', receipt) else None,
                    'importance': classify_event(title), 'direction': 'review'})
            if result.get('status') == '013' or page >= int(result.get('total_page') or 1):
                break
            if page >= SETTINGS['filing_page_limit']:
                raise RuntimeError('공시 페이지 한도 초과')
            page += 1
        self.payload['events'] = list({event['id']: event for event in events}.values())
        self.payload['event_scope'] = f'{start.isoformat()} — {end.isoformat()} · DART 전체 공시 유형 · 정정 포함'
        self.payload['source_status']['dart_events'] = {'status': 'ok', 'source': 'DART 회사별 공시검색', 'as_of': end.isoformat(),
            'collected_at': now(), 'run_id': self.job_id, 'record_count': len(self.payload['events']), 'warning': '조회 기간 내 공시입니다. 향후 일정이나 회사의 모든 변수를 포괄하지는 않습니다.'}

    def run(self):
        with self.db:
            claimed = self.db.execute("UPDATE research_jobs SET state='running',pid=?,updated_at=? WHERE code=? AND job_id=? AND state='queued'",
                                      (os.getpid(), now(), self.code, self.job_id)).rowcount
        if not claimed:
            return
        successful = 0
        for key, label, collect in [('prices', '가격', self.prices), ('financials', '재무', self.financials), ('dart_events', '공시', self.filings)]:
            old = self.original.get('source_status', {}).get(key, {})
            if self.job['mode'] == 'retry' and old.get('status') == 'ok' and old.get('run_id'):
                successful += 1
                continue
            self.save(f'{label} 자료를 보강합니다.')
            try:
                collect()
                successful += 1
            except Exception as exc:
                previous = self.payload['source_status'].get(key, {})
                self.payload['source_status'][key] = {**previous, 'status': 'error', 'attempted_at': now(),
                    'warning': f'{label} 수집 실패({type(exc).__name__}). 기존 자료가 있으면 이전 기준일로 유지합니다.'}
            self.save(f'{label} 자료 확인 완료')
        states = [self.payload['source_status'].get(key, {}).get('status') for key in ('prices', 'financials', 'dart_events')]
        state = 'ready' if all(value == 'ok' for value in states) else 'partial' if successful else 'error'
        self.save('자료 보강 완료' if state == 'ready' else '일부 자료를 확인하지 못했습니다. 필요한 자료만 재시도할 수 있습니다.', state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--code', required=True)
    parser.add_argument('--job-id', required=True)
    parser.add_argument('--env-file', type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'\d{6}', args.code) or not re.fullmatch(r'[a-f0-9-]{36}', args.job_id):
        return 2
    if args.env_file:
        load_dotenv(args.env_file, override=False)
    directory = Path(os.environ.get('RESEARCH_STORAGE_DIR') or config.ROOT / SETTINGS['storage_dir'])
    collector = Collector(args.code, args.job_id, directory)
    try:
        collector.run()
    except Exception:
        with collector.db:
            collector.db.execute("UPDATE research_jobs SET state='error',step='수집이 중단되었습니다. 기존 자료는 유지됩니다.',error='자료 보강 재시도가 필요합니다.',updated_at=? WHERE code=? AND job_id=? AND state='running'", (now(), args.code, args.job_id))
        return 1
    finally:
        collector.db.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
