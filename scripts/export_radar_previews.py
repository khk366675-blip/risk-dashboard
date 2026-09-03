"""Export only the basic data needed to inspect unselected Radar candidates."""
import json
import sqlite3
from datetime import datetime
from radar_pipeline import config
from scripts.export_stock_details import finite, price_rows, ratio_percent, write_json

SETTINGS = json.loads((config.ROOT / 'research/config.json').read_text(encoding='utf-8'))


def export_radar_previews(radar_payload=None, database_path=config.DATABASE_PATH, output_dir=None):
    if radar_payload is None:
        radar_payload = json.loads(config.PUBLIC_RADAR_PATH.read_text(encoding='utf-8'))
    output_dir = output_dir or config.ROOT / SETTINGS['preview_dir']
    connection = sqlite3.connect(f'{database_path.as_uri()}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    try:
        for candidate in radar_payload['candidates']:
            code = candidate['code']
            row = connection.execute('SELECT * FROM stocks WHERE code=?', (code,)).fetchone()
            values = connection.execute('SELECT * FROM valuations WHERE code=?', (code,)).fetchone()
            values = dict(values) if values else {}
            prices = price_rows(connection, code)[-65:]
            latest = prices[-1] if prices else {}
            prior = prices[-2].get('close') if len(prices) > 1 else None
            report = connection.execute('SELECT year,report_code FROM financials WHERE code=? ORDER BY year DESC, report_code DESC LIMIT 1', (code,)).fetchone()
            payload = {'schema_version': 'stock-preview.v1', 'data_level': 'preview', 'code': code, 'name': candidate['name'], 'market': candidate['market'],
                'sector': candidate.get('sector', ''), 'industry': row['industry'] if row else None, 'listing_date': row['listing_date'] if row else None,
                'run_id': radar_payload['run_id'], 'generated_at': datetime.now().astimezone().isoformat(), 'collected_at': radar_payload['generated_at'],
                'summary': {'latest_price': latest.get('close'), 'price_as_of': latest.get('date'), 'market_cap_krw': candidate.get('market_cap_krw'),
                    'change_1d_pct': (latest['close']/prior-1)*100 if prior else None, 'high_52w': None, 'low_52w': None, 'drawdown_52w_pct': None, 'price_position_52w_pct': None},
                'valuation': {'per': finite(values.get('per')), 'pbr': finite(values.get('pbr')), 'ev_ebitda': None, 'ev_operating_profit': None,
                    'ttm_roe_pct': ratio_percent(values.get('ttm_roe')), 'debt_ratio_pct': ratio_percent(values.get('debt_ratio')), 'interest_coverage': None,
                    'ttm_revenue': finite(values.get('ttm_rev')), 'ttm_operating_profit': finite(values.get('ttm_op')), 'ttm_net_income': finite(values.get('ttm_ni')), 'ttm_operating_cash_flow': None},
                'prices': prices, 'quarters': [], 'events': [], 'radar': candidate,
                'source_status': {'prices': {'status': 'ok' if prices else 'missing', 'source': '네이버 금융 일별 시세', 'as_of': latest.get('date'), 'record_count': len(prices), 'collected_at': radar_payload['generated_at']},
                                  'financials': {'status': 'partial', 'source': 'Radar 기본 재무', 'as_of': f"{report['year']} {report['report_code']}" if report else None, 'warning': '상세 재무는 관심종목 등록 후 수집합니다.'}}, 'warnings': []}
            write_json(output_dir / f'{code}.json', payload)
    finally:
        connection.close()
    # No deletion or writes to interest-list data, even when a candidate drops out.
    return len(radar_payload['candidates'])


if __name__ == '__main__':
    print(f'Exported {export_radar_previews()} Radar previews')
