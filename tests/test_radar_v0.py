import unittest
from datetime import date, timedelta
from pathlib import Path

from scripts.radar_v0 import (
    StockSnapshot,
    dislocation_lens,
    finite_number,
    load_rules,
    percentile_cutoff,
    quality_lens,
    ratio_as_pct,
)


RULES = load_rules(Path("radar/rules.v1.json"))


def snapshot(*, valuation=None, quarters=None, prices=None) -> StockSnapshot:
    return StockSnapshot(
        code="000001",
        name="테스트기업",
        market="KOSPI",
        sector="테스트업종",
        market_cap=100_000_000_000,
        valuation=valuation or {},
        prices=prices or [],
        quarters=quarters or [],
        median_traded_value_20d=1_000_000_000,
        valuation_updated_at=date(2026, 9, 1),
    )


class RadarV0Tests(unittest.TestCase):
    def test_non_finite_values_are_missing(self):
        self.assertIsNone(finite_number(float("nan")))
        self.assertIsNone(finite_number(float("inf")))
        self.assertIsNone(finite_number("not-a-number"))

    def test_legacy_ratios_are_exposed_as_percentages(self):
        self.assertEqual(ratio_as_pct(0.125), 12.5)
        self.assertEqual(ratio_as_pct(1.8), 180.0)

    def test_percentile_cutoff_ignores_invalid_and_non_positive_values(self):
        self.assertEqual(percentile_cutoff([None, -1, 0, 5, 10, 20], 30), 5)

    def test_quality_matches_with_core_and_supporting_evidence(self):
        quarters = [
            {"year": 2025, "quarter": quarter, "op": 10, "rev": 100, "ocf": 10, "equity": 100, "debt": 80}
            for quarter in ("1Q", "2Q", "3Q", "4Q")
        ]
        result = quality_lens(
            snapshot(
                valuation={
                    "ttm_ocf": 90,
                    "ttm_op": 60,
                    "ttm_rev": 400,
                    "ttm_roe": 0.2,
                    "ttm_icr": 10,
                    "debt_ratio": 0.5,
                },
                quarters=quarters,
            ),
            RULES,
        )
        self.assertTrue(result["matched"])
        self.assertGreaterEqual(result["evidence_count"], 6)
        self.assertEqual(result["coverage_pct"], 100)

    def test_dislocation_is_withheld_when_price_series_is_stale(self):
        end = date(2026, 4, 28)
        prices = []
        for index in range(130):
            day = end - timedelta(days=129 - index)
            close = 100 if index < 10 else 50
            prices.append({"date": day.isoformat(), "open": close, "high": 100, "low": 45, "close": close, "volume": 100_000})
        result = dislocation_lens(
            snapshot(valuation={"per": 5, "pbr": 0.5, "ev_ebitda": 3}, prices=prices),
            RULES,
            {"per": 10, "pbr": 1, "ev_ebitda": 5},
            20,
            True,
            date(2026, 9, 2),
        )
        self.assertFalse(result["matched"])
        self.assertTrue(any("오래되어" in item for item in result["contradictions"]))


if __name__ == "__main__":
    unittest.main()
