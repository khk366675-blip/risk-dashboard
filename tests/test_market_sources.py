from __future__ import annotations

import json
import subprocess
import unittest
from datetime import date
from unittest.mock import Mock, patch

import pandas as pd
import requests

from radar_pipeline import config
from radar_pipeline.market import collect_universe
from radar_pipeline.market_sources import bounded_price_frame, cached_listing, current_listing, listing_descriptions, naver_listing
from scripts.collect_markets import collect, collect_asset, stale_asset


class MarketSourceTests(unittest.TestCase):
    def test_exact_date_cache_has_timeout_and_preserves_codes(self):
        response = Mock(content=b'Code,Name,Close,Marcap,Stocks,Market\n005930,test,100,1000,10,KOSPI\n')
        with patch('radar_pipeline.market_sources.requests.get', return_value=response) as get:
            frame = cached_listing('krx', date(2026, 9, 8))
        self.assertEqual(frame.Code.iloc[0], '005930')
        self.assertEqual(frame.attrs['as_of'], '2026-09-08')
        self.assertIn('/krx/2026-09-08.csv', get.call_args.args[0])
        self.assertEqual(get.call_args.kwargs['timeout'], config.LISTING_HTTP_TIMEOUT_SECONDS)

    def test_missing_krx_file_uses_fresh_secondary_not_old_listing(self):
        secondary = pd.DataFrame([{'Code': '005930'}])
        secondary.attrs = {'source': 'Naver', 'as_of': '2026-09-08'}
        with patch('radar_pipeline.market_sources.cached_listing', side_effect=requests.HTTPError('404')), patch('radar_pipeline.market_sources.naver_listing', return_value=secondary):
            result = current_listing(date(2026, 9, 8))
        self.assertEqual(result.attrs['source'], 'Naver')
        self.assertTrue(result.attrs['warnings'])

    def test_secondary_older_than_completed_date_is_rejected(self):
        secondary = pd.DataFrame([{'Code': '005930'}])
        secondary.attrs['as_of'] = '2026-09-07'
        with patch('radar_pipeline.market_sources.cached_listing', side_effect=requests.HTTPError('404')), patch('radar_pipeline.market_sources.naver_listing', return_value=secondary):
            with self.assertRaisesRegex(ValueError, '최신 종목 목록'):
                current_listing(date(2026, 9, 8))

    def test_optional_description_failure_does_not_stop_universe(self):
        listing = pd.DataFrame([{'Code': '005930', 'Name': 'test'}])
        listing.attrs = {'source': 'Naver', 'as_of': '2026-09-08'}
        with patch('radar_pipeline.market.current_listing', return_value=listing), patch('radar_pipeline.market.listing_descriptions', side_effect=requests.Timeout()):
            result = collect_universe(date(2026, 9, 8))
        self.assertEqual(len(result), 1)
        self.assertEqual(result.attrs['source'], 'Naver')
        self.assertTrue(result.attrs['warnings'])

    def test_old_descriptions_keep_original_date(self):
        error = requests.HTTPError(response=Mock(status_code=404))
        old = pd.DataFrame([{'Code': '005930'}])
        old.attrs['as_of'] = '2026-09-07'
        with patch('radar_pipeline.market_sources.cached_listing', side_effect=[error, old]) as fetch:
            result = listing_descriptions(date(2026, 9, 8))
        self.assertEqual(result.attrs['as_of'], '2026-09-07')
        self.assertEqual(fetch.call_args.args, ('desc', date(2026, 9, 7)))

    @staticmethod
    def stock(code='005930', kind='stock'):
        return {'itemCode': code, 'stockEndType': kind, 'stockName': 'test',
                'closePriceRaw': '100', 'marketValueRaw': '1000',
                'localTradedAt': '2026-09-08T15:30:00+09:00',
                'accumulatedTradingVolumeRaw': '123', 'accumulatedTradingValueRaw': '12300'}

    def test_naver_krw_units_and_etf_exclusion(self):
        kospi = {'totalCount': 2, 'stocks': [self.stock(), self.stock('069500', 'etf')]}
        kosdaq = {'totalCount': 1, 'stocks': [self.stock('196170')]}
        def response(*args, **kwargs):
            return Mock(json=Mock(return_value=kospi if args[0].endswith('KOSPI') else kosdaq))
        with patch('radar_pipeline.market_sources.requests.get', side_effect=response):
            result = naver_listing()
        self.assertEqual(list(result.Code), ['005930', '196170'])
        self.assertEqual(result.Marcap.iloc[0], 1000)
        self.assertEqual(result.Amount.iloc[0], 12300)
        self.assertEqual(result.Stocks.iloc[0], 10)
        self.assertEqual(result.QuoteDate.iloc[0], '2026-09-08')

    def test_duplicate_or_truncated_naver_pages_fail_closed(self):
        for stocks in ([self.stock(), self.stock()], [self.stock()]):
            with self.subTest(rows=len(stocks)), patch('radar_pipeline.market_sources.requests.get', return_value=Mock(json=Mock(return_value={'totalCount': 2, 'stocks': stocks}))):
                with self.assertRaisesRegex(ValueError, '누락/중복'):
                    naver_listing()

    def test_price_reader_includes_today_and_bounds_process(self):
        payload = {'data': [[100], [101]], 'columns': ['Close'], 'index': ['2026-09-08T00:00:00', '2026-09-09T00:00:00']}
        with patch('radar_pipeline.market_sources.subprocess.run', return_value=Mock(returncode=0, stdout=json.dumps(payload))) as run:
            frame = bounded_price_frame('US500', date(2026, 8, 1), date(2026, 9, 8))
        self.assertEqual(run.call_args.args[0][-1], '2026-09-09')
        self.assertEqual(run.call_args.kwargs['timeout'], config.MARKET_SOURCE_TIMEOUT_SECONDS)
        self.assertEqual(len(frame), 1)  # Never retain a future date.

    def test_timeout_uses_explicit_stale_asset_without_changing_observed_date(self):
        spec = {'key': 'sp500'}
        previous = {'assets': [{'key': 'sp500', 'as_of': '2026-09-07', 'value': 100}]}
        result = stale_asset(spec, previous, subprocess.TimeoutExpired('reader', 25), date(2026, 9, 8))
        self.assertEqual(result['as_of'], '2026-09-07')
        self.assertEqual(result['freshness'], 'stale')
        self.assertIn('TimeoutExpired', result['collection_error'])

    def test_newer_korean_index_fallback_is_labeled_and_keeps_real_values(self):
        dates = pd.date_range('2026-06-01', periods=100)
        primary = pd.DataFrame({'Close': range(7000, 7098)}, index=dates[:98])
        secondary = pd.DataFrame({'Close': range(7000, 7100)}, index=dates)
        with patch('scripts.collect_markets.bounded_price_frame', side_effect=[primary, secondary]):
            result = collect_asset({'key': 'kospi', 'symbol': 'KS11'}, date(2026, 6, 1), dates[-1].date())
        self.assertEqual(result['value'], 7099)
        self.assertIn('Yahoo', result['source'])
        self.assertTrue(result['warning'])

    def test_breadth_failure_does_not_discard_collected_assets(self):
        asset = {'key': 'sp500', 'freshness': 'latest', 'as_of': '2026-09-08'}
        with patch('scripts.collect_markets.previous_payload', return_value={}), patch('scripts.collect_markets.config.MARKET_ASSETS', ({'key': 'sp500'},)), patch('scripts.collect_markets.collect_asset', return_value=asset), patch('scripts.collect_markets.korea_breadth', side_effect=RuntimeError('database locked')):
            result = collect()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['assets'], [asset])
        self.assertEqual(result['breadth']['status'], 'missing')
        self.assertIn('database locked', result['warnings'][0])


if __name__ == '__main__':
    unittest.main()
