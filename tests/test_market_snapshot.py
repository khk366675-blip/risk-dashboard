from __future__ import annotations

import unittest
from datetime import date, timedelta
from pathlib import Path
import sqlite3
import tempfile
from unittest.mock import patch

import pandas as pd

from scripts.collect_markets import absolute_change, build_summary, korea_breadth, percentage_change


class MarketSnapshotTests(unittest.TestCase):
    def test_percentage_change_uses_trading_period_offset(self) -> None:
        self.assertEqual(percentage_change([100, 101, 102, 110], 1), 7.84)
        self.assertEqual(percentage_change([100, 101, 102, 110], 3), 10.0)
        self.assertEqual(absolute_change([4.2, 4.3, 4.5], 2), 0.3)
        self.assertIsNone(percentage_change([100], 1))

    def test_rule_summary_is_bounded_and_labeled(self) -> None:
        assets = [
            {"key": "sp500", "change_20d_pct": 8},
            {"key": "nasdaq", "change_20d_pct": 12},
            {"key": "vix", "value": 14},
            {"key": "kospi", "change_20d_pct": 7},
            {"key": "kosdaq", "change_20d_pct": 5},
            {"key": "usdkrw", "change_20d_pct": -3},
            {"key": "dxy", "change_20d_pct": -2},
        ]
        breadth = {"above_20d_pct": 70, "above_60d_pct": 65, "advancers_pct": 60}
        summary = build_summary(assets, breadth)
        self.assertNotIn("global_risk_score", summary)
        self.assertNotIn("korea_meter", summary)
        self.assertEqual(summary["global_risk_label"], "위험선호 우호")
        self.assertEqual(summary["fx_pressure_label"], "압력 완화")
        self.assertEqual(summary["method"], "rule_based_raw_metrics")
        self.assertEqual(summary["signals"]["vix_level"], 14)

    def test_korea_breadth_appends_latest_krx_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "market.db"
            connection = sqlite3.connect(database)
            connection.execute("CREATE TABLE prices (code TEXT, date TEXT, close REAL)")
            start = date(2026, 7, 4)
            rows = []
            for index in range(60):
                observed = (start + timedelta(days=index)).isoformat()
                rows.extend([("000001", observed, 100 + index), ("000002", observed, 200 - index)])
            connection.executemany("INSERT INTO prices VALUES (?,?,?)", rows)
            connection.commit()
            connection.close()

            listing = pd.DataFrame([{"Code": "000001", "Close": 170}, {"Code": "000002", "Close": 130}])
            listing.attrs["as_of"] = "2026-09-02"
            with patch("scripts.collect_markets.completed_market_date", return_value=date(2026, 9, 2)), patch("scripts.collect_markets.current_listing", return_value=listing):
                result = korea_breadth(database)
            # Never stamp an intraday quote with the previous completed date.
            listing["QuoteDate"] = "2026-09-03"
            with patch("scripts.collect_markets.completed_market_date", return_value=date(2026, 9, 2)), patch("scripts.collect_markets.current_listing", return_value=listing):
                intraday = korea_breadth(database)
            self.assertEqual(intraday["status"], "stale")
            self.assertNotEqual(intraday["as_of"], "2026-09-02")
            with patch("scripts.collect_markets.completed_market_date", return_value=date(2026, 9, 3)), patch("scripts.collect_markets.current_listing") as fetch:
                gap = korea_breadth(database, ["2026-09-02", "2026-09-03"])
            self.assertEqual(gap["status"], "stale")
            self.assertIn("중간 거래일", gap["warning"])
            fetch.assert_not_called()

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["as_of"], "2026-09-02")
        self.assertEqual(result["coverage_count"], 2)
        self.assertEqual(result["advancers_pct"], 50.0)
        self.assertIn("FinanceDataReader KRX latest", result["source"])


if __name__ == "__main__":
    unittest.main()
