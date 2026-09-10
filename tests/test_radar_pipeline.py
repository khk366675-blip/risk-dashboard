import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from radar_pipeline.config import ReportPeriod, recent_report_periods
from radar_pipeline.dart import DartClient, parse_full_enrichment, parse_major_quarters
from radar_pipeline.market import load_price_checkpoint, save_price_checkpoint


class RadarPipelineTests(unittest.TestCase):
    def test_missing_or_mixed_basis_prior_quarter_does_not_become_zero_cashflow(self):
        periods = [ReportPeriod(2026, '11013', '1Q'), ReportPeriod(2026, '11012', '2Q')]
        def row(amount, basis='CFS'):
            return {'currency':'KRW', 'fs_div': basis, 'sj_div': 'CF', 'account_id': 'ifrs-full_CashFlowsFromUsedInOperatingActivities', 'thstrm_amount': str(amount)}
        missing = parse_full_enrichment({('000001', periods[1].key): [row(30)]}, periods)
        self.assertIsNone(missing['000001'][(2026, '2Q')]['ocf'])
        mixed = parse_full_enrichment({('000001', periods[0].key): [row(10, 'OFS')], ('000001', periods[1].key): [row(30)]}, periods)
        self.assertIsNone(mixed['000001'][(2026, '2Q')]['ocf'])
        zero = parse_full_enrichment({('000001', periods[0].key): [row(0)], ('000001', periods[1].key): [row(30)]}, periods)
        self.assertEqual(zero['000001'][(2026, '2Q')]['ocf'], 30)

    def test_price_checkpoint_is_scoped_to_completed_market_date(self):
        codes = ["000001"]
        market_date = date(2026, 9, 1)
        histories = {
            "000001": [
                {"date": "2026-09-01", "open": 1, "high": 2, "low": 1, "close": 2, "volume": 3}
            ]
        }
        with TemporaryDirectory() as directory:
            path = Path(directory)
            save_price_checkpoint(path, codes, market_date, histories)
            self.assertEqual(load_price_checkpoint(path, codes, market_date), histories)
            self.assertIsNone(load_price_checkpoint(path, codes, date(2026, 9, 2)))

    @patch("radar_pipeline.dart.time.sleep", return_value=None)
    def test_dart_json_retries_an_empty_success_response(self, _sleep):
        invalid = Mock()
        invalid.json.side_effect = ValueError("empty response")
        valid = Mock()
        valid.json.return_value = {"status": "000", "list": []}
        with TemporaryDirectory() as directory:
            client = DartClient("test-key", Path(directory))
            with patch.object(client, "_request", side_effect=[invalid, valid]) as request:
                payload = client.json("sample.json", {"corp_code": "001"}, refresh=True)
        self.assertEqual(payload["status"], "000")
        self.assertEqual(request.call_count, 2)

    def test_recent_periods_start_with_latest_available_filing(self):
        periods = recent_report_periods(date(2026, 9, 2), 4)
        self.assertEqual(
            [(period.year, period.quarter, period.report_code) for period in periods],
            [
                (2026, "2Q", "11012"),
                (2026, "1Q", "11013"),
                (2025, "4Q", "11011"),
                (2025, "3Q", "11014"),
            ],
        )

    def test_annual_income_is_converted_to_standalone_fourth_quarter(self):
        periods = [
            ReportPeriod(2025, "11011", "4Q"),
            ReportPeriod(2025, "11014", "3Q"),
            ReportPeriod(2025, "11012", "2Q"),
            ReportPeriod(2025, "11013", "1Q"),
        ]
        values = {"1Q": 20, "2Q": 25, "3Q": 30, "4Q": 100}
        records = []
        for period in periods:
            records.extend(
                [
                    {
                        "stock_code": "000001",
                        "bsns_year": "2025",
                        "reprt_code": period.report_code,
                        "fs_div": "CFS",
                        "sj_div": "IS",
                        "account_id": "ifrs-full_Revenue",
                        "account_nm": "매출액",
                        "thstrm_amount": str(values[period.quarter]),
                    },
                    {
                        "stock_code": "000001",
                        "bsns_year": "2025",
                        "reprt_code": period.report_code,
                        "fs_div": "CFS",
                        "sj_div": "IS",
                        "account_id": "dart_OperatingIncomeLoss",
                        "account_nm": "영업이익",
                        "thstrm_amount": str(values[period.quarter] / 10),
                    },
                ]
            )
        for record in records: record['currency'] = 'KRW'
        quarters = parse_major_quarters(records, periods)["000001"]
        fourth = next(quarter for quarter in quarters if quarter["quarter"] == "4Q")
        self.assertEqual(fourth["rev"], 25)
        self.assertEqual(fourth["op"], 2.5)

    def test_cumulative_cash_flow_is_converted_to_quarter_values(self):
        periods = [
            ReportPeriod(2025, "11011", "4Q"),
            ReportPeriod(2025, "11014", "3Q"),
            ReportPeriod(2025, "11012", "2Q"),
            ReportPeriod(2025, "11013", "1Q"),
        ]
        ocf = {"1Q": 10, "2Q": 18, "3Q": 25, "4Q": 40}
        interest = {"1Q": 1, "2Q": 2, "3Q": 3, "4Q": 10}
        responses = {}
        for period in periods:
            responses[("000001", period.key)] = [
                {
                    "fs_div": "CFS",
                    "sj_div": "CF",
                    "account_id": "ifrs-full_CashFlowsFromUsedInOperatingActivities",
                    "account_nm": "영업활동현금흐름",
                    "thstrm_amount": str(ocf[period.quarter]),
                },
                {
                    "fs_div": "CFS",
                    "sj_div": "IS",
                    "account_id": "ifrs-full_InterestExpense",
                    "account_nm": "이자비용",
                    "thstrm_amount": str(interest[period.quarter]),
                },
            ]
        for rows in responses.values():
            for record in rows: record['currency'] = 'KRW'
        result = parse_full_enrichment(responses, periods)["000001"]

        self.assertEqual(result[(2025, "1Q")]["ocf"], 10)
        self.assertEqual(result[(2025, "2Q")]["ocf"], 8)
        self.assertEqual(result[(2025, "3Q")]["ocf"], 7)
        self.assertEqual(result[(2025, "4Q")]["ocf"], 15)
        self.assertEqual(result[(2025, "4Q")]["interest"], 4)


if __name__ == "__main__":
    unittest.main()
