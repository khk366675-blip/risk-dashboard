import json
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from radar_pipeline import config
from radar_pipeline.storage import SCHEMA
from research.financials import normalize_financials, research_valuation
from scripts.collect_watchlist_stock import Collector
from scripts.export_radar_previews import export_radar_previews


def document(year, quarter, cumulative, basis='CFS', currency='KRW'):
    rows = [{'account_id': 'ifrs-full_CashFlowsFromUsedInOperatingActivities', 'sj_div': 'CF', 'thstrm_amount': str(cumulative), 'currency': currency},
            {'account_id': 'ifrs-full_Revenue', 'sj_div': 'IS', 'thstrm_amount': '400' if quarter == '4Q' else '100', 'currency': currency},
            {'account_id': 'dart_OperatingIncomeLoss', 'sj_div': 'IS', 'thstrm_amount': '40' if quarter == '4Q' else '10', 'currency': currency},
            {'account_id': 'ifrs-full_ProfitLoss', 'sj_div': 'IS', 'thstrm_amount': '20' if quarter == '4Q' else '5', 'currency': currency},
            {'account_id': 'ifrs-full_Equity', 'sj_div': 'BS', 'thstrm_amount': '100', 'currency': currency},
            {'account_id': 'ifrs-full_Liabilities', 'sj_div': 'BS', 'thstrm_amount': '50', 'currency': currency}]
    return {'year': year, 'quarter': quarter, 'basis': basis, 'receipt_no': '20260903000001', 'collected_at': '2026-09-03', 'rows': rows}


class WatchlistFinancialTests(unittest.TestCase):
    def test_annual_and_ytd_become_standalone_and_complete_ttm(self):
        documents = [document(2025, q, amount) for q, amount in [('1Q', 10), ('2Q', 18), ('3Q', 25), ('4Q', 40)]]
        rows = normalize_financials(documents, 8)
        self.assertEqual([row['ocf'] for row in rows], [10, 8, 7, 15])
        self.assertEqual(rows[-1]['rev'], 100)
        self.assertEqual(research_valuation(rows, 1000)['ttm_operating_cash_flow'], 40)
        self.assertTrue(rows[0]['source_url'].endswith('20260903000001'))

    def test_missing_preceding_cumulative_is_not_zero(self):
        rows = normalize_financials([document(2025, '3Q', 25), document(2025, '4Q', 40)], 8)
        self.assertIsNone(rows[0]['ocf'])
        self.assertEqual(rows[1]['ocf'], 15)
        self.assertIsNone(rows[1]['rev'])
        self.assertIsNone(research_valuation(rows, 1000)['ttm_operating_cash_flow'])

    def test_zero_cumulative_is_present(self):
        rows = normalize_financials([document(2025, '1Q', 0), document(2025, '2Q', 10)], 8)
        self.assertEqual(rows[1]['ocf'], 10)

    def test_mixed_statements_and_foreign_currency_are_not_summed_as_won(self):
        rows = normalize_financials([document(2025, '1Q', 10), document(2025, '2Q', 20, 'OFS')], 8)
        self.assertIsNone(rows[1]['ocf'])
        rows = normalize_financials([document(2025, '1Q', 10, currency='USD')], 8)
        self.assertIsNone(rows[0]['rev'])
        self.assertTrue(rows[0]['warnings'])

    def test_preview_export_never_changes_interest_data_or_exports_quarters(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / 'radar.sqlite'
            db = sqlite3.connect(database)
            for sql in SCHEMA:
                db.execute(sql)
            db.execute("INSERT INTO stocks(code,name,market) VALUES('000001','테스트','KOSPI')")
            db.execute("INSERT INTO prices(code,date,close) VALUES('000001','2026-09-02',1000)")
            db.commit(); db.close()
            saved = root / 'user-state.json'
            saved.write_text('{"saved": true}', encoding='utf-8')
            radar = {'run_id': 'test', 'generated_at': '2026-09-03', 'candidates': [{'code': '000001', 'name': '테스트', 'market': 'KOSPI'}]}
            export_radar_previews(radar, database, root / 'previews')
            payload = json.loads((root / 'previews/000001.json').read_text(encoding='utf-8'))
            self.assertEqual(payload['quarters'], [])
            self.assertEqual(payload['events'], [])
            self.assertEqual(payload['data_level'], 'preview')
            radar['candidates'] = []
            export_radar_previews(radar, database, root / 'previews')
            self.assertEqual(saved.read_text(encoding='utf-8'), '{"saved": true}')


class WatchlistJobTests(unittest.TestCase):
    def test_source_failure_keeps_registration_and_prior_data_retry_skips_success(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            db = sqlite3.connect(root / 'watchlist.sqlite')
            db.executescript((config.ROOT / 'research/schema.sql').read_text(encoding='utf-8'))
            payload = {'source_status': {'prices': {'status': 'ok', 'run_id': 'old'}, 'financials': {'status': 'error'}, 'dart_events': {'status': 'ok', 'run_id': 'old'}},
                       'quarters': [{'label': 'preserved'}], 'events': [{'id': 'preserved'}], 'prices': [{'close': 1000}]}
            db.execute('INSERT INTO watchlist VALUES(?,?,?,?,?,?,?,?)', ('000001', '테스트', '{}', 'radar', '2026-09-03', '2026-09-03', 1, json.dumps(payload)))
            db.execute('INSERT INTO research_jobs(code,job_id,state,mode,step,updated_at) VALUES(?,?,?,?,?,?)', ('000001', 'job', 'queued', 'retry', 'queued', '2026-09-03'))
            db.commit()
            collector = Collector('000001', 'job', root)
            with patch.object(collector, 'prices') as prices, patch.object(collector, 'filings') as filings, patch.object(collector, 'financials', side_effect=RuntimeError('source failure')):
                collector.run()
                prices.assert_not_called(); filings.assert_not_called()
            row = db.execute('SELECT active,detail_json FROM watchlist').fetchone()
            self.assertEqual(row[0], 1)
            self.assertEqual(json.loads(row[1])['quarters'], payload['quarters'])
            self.assertEqual(db.execute('SELECT state FROM research_jobs').fetchone()[0], 'partial')
            collector.db.close(); db.close()


if __name__ == '__main__':
    unittest.main()
