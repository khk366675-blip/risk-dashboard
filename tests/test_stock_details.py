import sqlite3
import unittest

from radar_pipeline.storage import SCHEMA
from scripts.export_stock_details import quarter_rows, ratio_percent, stock_payload


class StockDetailTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        for statement in SCHEMA:
            self.db.execute(statement)
        self.db.execute("INSERT INTO stocks (code,name,market) VALUES ('000001','테스트','KOSPI')")

    def tearDown(self):
        self.db.close()

    def add_metric(self, year, quarter, metric, value):
        self.db.execute("INSERT INTO financials (code,year,report_code,account_nm,thstrm_amount) VALUES (?,?,?,?,?)", ('000001', year, quarter, metric, str(value)))

    def test_ratios_never_guess_units_from_magnitude(self):
        self.assertEqual(ratio_percent(12), 1200)
        self.assertEqual(ratio_percent(0.5), 50)
        self.assertIsNone(ratio_percent(float('nan')))

    def test_cash_flow_without_prior_ytd_is_not_a_standalone_quarter(self):
        self.add_metric(2025, '3Q', 'ocf', 25)
        self.add_metric(2025, '4Q', 'ocf', 15)
        rows = quarter_rows(self.db, '000001')
        self.assertIsNone(rows[0]['ocf'])
        self.assertTrue(rows[0]['warnings'])
        self.assertEqual(rows[1]['ocf'], 15)

    def test_zero_cash_flow_is_present_not_missing(self):
        self.add_metric(2026, '1Q', 'ocf', 0)
        self.add_metric(2026, '2Q', 'ocf', -10)
        self.assertEqual(quarter_rows(self.db, '000001')[1]['ocf'], -10)

    def test_export_units_provenance_event_scope_and_missing_ttm(self):
        self.add_metric(2025, '3Q', 'ocf', 25)
        self.add_metric(2025, '4Q', 'ocf', 15)
        self.add_metric(2026, '1Q', 'ocf', 10)
        self.add_metric(2026, '2Q', 'ocf', 20)
        self.db.execute("INSERT INTO valuations (code,ev_ebitda,debt_ratio) VALUES ('000001',5,12)")
        self.db.execute("INSERT INTO prices (code,date,close) VALUES ('000001','2026-09-02',16580)")
        events = [{'id': str(i)} for i in range(45)]
        payload = stock_payload(self.db, {'code': '000001'}, events, '2026-09-03')
        self.assertEqual(payload['valuation']['ev_operating_profit'], 5)
        self.assertIsNone(payload['valuation']['ev_ebitda'])
        self.assertIsNone(payload['valuation']['ttm_operating_cash_flow'])
        self.assertEqual(payload['valuation']['debt_ratio_pct'], 1200)
        self.assertEqual(payload['prices'][0]['close'], 16580)
        self.assertNotIn('indexed_100', payload['prices'][0])
        self.assertEqual(len(payload['events']), 45)
        self.assertEqual(payload['source_status']['dart_events']['status'], 'partial')
        self.assertEqual(payload['source_status']['prices']['source'], '네이버 금융 일별 시세')

    def test_complete_year_can_sum_cash_flow(self):
        for quarter in ('1Q', '2Q', '3Q', '4Q'):
            self.add_metric(2025, quarter, 'ocf', 10)
        payload = stock_payload(self.db, {'code': '000001'}, [], '2026-09-03')
        self.assertEqual(payload['valuation']['ttm_operating_cash_flow'], 40)


if __name__ == '__main__':
    unittest.main()
