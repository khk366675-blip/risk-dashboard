import unittest
from datetime import date, timedelta
from pathlib import Path

from scripts.radar_v0 import (
    StockSnapshot,
    dislocation_lens,
    event_lens,
    finite_number,
    load_rules,
    percentile_cutoff,
    quality_lens,
    comparable_quarters,
    improvement_lens,
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
    def test_missing_and_mixed_periods_are_not_comparable(self):
        quarters = [{'year':2025,'quarter':quarter,'statement_basis':'CFS'} for quarter in ('1Q','2Q','3Q','4Q')]
        self.assertTrue(comparable_quarters(quarters))
        self.assertFalse(comparable_quarters([quarters[0], quarters[2]]))
        self.assertFalse(comparable_quarters([quarters[0], {**quarters[1], 'statement_basis':'OFS'}]))
        self.assertFalse(comparable_quarters([{**quarters[0], 'statement_basis':None}]))
        result = improvement_lens(snapshot(quarters=[quarters[0], {'year':2026,'quarter':'1Q','statement_basis':'OFS'}]), RULES)
        self.assertFalse(result['matched'])
        self.assertTrue(result['contradictions'])

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
            {"year": 2025, "quarter": quarter, "statement_basis": "CFS", "op": 10, "rev": 100, "ocf": 10, "equity": 100, "debt": 80}
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

    def test_dislocation_uses_the_configured_valuation_percentile_label(self):
        end = date(2026, 9, 4)
        prices = []
        for index in range(252):
            day = end - timedelta(days=251 - index)
            close = 100 if index < 131 else 40
            prices.append({"date": day.isoformat(), "open": close, "high": 100, "low": 40, "close": close, "volume": 100_000})
        result = dislocation_lens(
            snapshot(valuation={"per": 1, "pbr": 1, "ev_ebitda": 1}, prices=prices),
            RULES,
            {"per": 2, "pbr": 2, "ev_ebitda": 2},
            0,
            True,
            end,
        )
        valuation = next(item for item in result["evidence"] if item["key"] == "valuation_percentile")
        self.assertIn(f"하위 {RULES['dislocation']['valuation_percentile_max_pct']}%", valuation["label"])

    def test_recent_dilution_event_does_not_turn_weak_attention_into_evidence(self):
        as_of = date(2026, 9, 4)
        prices = [
            {
                "date": (as_of - timedelta(days=20 - index)).isoformat(),
                "open": 100,
                "high": 100,
                "low": 100,
                "close": 100,
                "volume": 100_000,
            }
            for index in range(21)
        ]
        result = event_lens(
            snapshot(prices=prices),
            RULES,
            [
                {
                    "id": "dart:20260904000001",
                    "code": "000001",
                    "date": as_of.isoformat(),
                    "url": "https://dart.fss.or.kr/example",
                    "metadata": {"importance_hint": "dilution_risk"},
                }
            ],
            as_of,
        )
        self.assertTrue(result["matched"])
        self.assertEqual([item["key"] for item in result["evidence"]], ["filing:dart:20260904000001"])


if __name__ == "__main__":
    unittest.main()
