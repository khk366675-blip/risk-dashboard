from __future__ import annotations

from typing import Any
from radar_pipeline.dart import metric_value

ORDER = {"1Q": 1, "2Q": 2, "3Q": 3, "4Q": 4}


def normalize_financials(documents: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    """Only subtract comparable, same-year cumulative reports; never fill gaps with zero."""
    mapped = {(doc['year'], doc['quarter']): doc for doc in documents}
    quarters = []
    for key, doc in sorted(mapped.items(), key=lambda pair: (pair[0][0], ORDER[pair[0][1]])):
        year, quarter = key
        rows = doc.get('rows', [])
        # DART reports currency alongside amounts. Foreign-currency statements
        # must not be silently rendered as KRW.
        rows = [row for row in rows if row.get('currency') in ('KRW', '원')]
        warnings = []
        if doc.get('rows') and not rows:
            warnings.append('원화 단위가 확인되지 않아 금액을 표시하지 않습니다.')
        result = {'year': year, 'quarter': quarter, 'label': f'{str(year)[2:]} {quarter}',
                  'statement_basis': doc.get('basis'), 'receipt_no': doc.get('receipt_no'),
                  'source_url': f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={doc['receipt_no']}" if doc.get('receipt_no') else None,
                  'collected_at': doc.get('collected_at')}
        for metric in ('rev', 'op', 'ni'):
            value = metric_value(rows, metric, 'thstrm_amount', {'IS', 'CIS'})
            if quarter == '4Q':
                preceding = [item for item in quarters if item['year'] == year and item['statement_basis'] == doc.get('basis')]
                if value is not None and len(preceding) == 3 and all(item.get(metric) is not None for item in preceding):
                    value -= sum(item[metric] for item in preceding)
                else:
                    value = None
            result[metric] = value
        for metric in ('equity', 'debt'):
            result[metric] = metric_value(rows, metric, 'thstrm_amount', {'BS'})
        cumulative = metric_value(rows, 'ocf', 'thstrm_amount', {'CF'})
        prior = mapped.get((year, f'{ORDER[quarter] - 1}Q'))
        previous = 0 if quarter == '1Q' else None
        if prior and prior.get('basis') == doc.get('basis'):
            prior_rows = [row for row in prior.get('rows', []) if row.get('currency') in ('KRW', '원')]
            previous = metric_value(prior_rows, 'ocf', 'thstrm_amount', {'CF'})
        result['ocf'] = cumulative - previous if cumulative is not None and previous is not None else None
        if result['ocf'] is None:
            warnings.append('단독 분기 현금흐름을 계산할 누적자료 또는 동일 재무제표 기준이 부족합니다.')
        result['op_margin_pct'] = result['op'] / result['rev'] * 100 if result['rev'] and result['op'] is not None else None
        result['debt_ratio_pct'] = result['debt'] / result['equity'] * 100 if result['equity'] and result['equity'] > 0 and result['debt'] is not None else None
        result['warnings'] = warnings
        quarters.append(result)
    return quarters[-count:]


def research_valuation(quarters: list[dict[str, Any]], market_cap: float | None) -> dict[str, Any]:
    recent = quarters[-4:]
    serials = [item['year'] * 4 + ORDER[item['quarter']] for item in recent]
    comparable = len(recent) == 4 and len({item.get('statement_basis') for item in recent}) == 1 and serials == list(range(serials[0], serials[0] + 4))
    def total(metric):
        return sum(item[metric] for item in recent) if comparable and all(item.get(metric) is not None for item in recent) else None
    rev, op, ni, ocf = [total(metric) for metric in ('rev', 'op', 'ni', 'ocf')]
    latest = recent[-1] if recent else {}
    equity = latest.get('equity')
    return {'per': market_cap / ni if market_cap and ni and ni > 0 else None,
            'pbr': market_cap / equity if market_cap and equity and equity > 0 else None,
            'ev_ebitda': None, 'ev_operating_profit': None, 'interest_coverage': None,
            'ttm_roe_pct': ni / equity * 100 if ni is not None and equity and equity > 0 else None,
            'debt_ratio_pct': latest.get('debt_ratio_pct'), 'ttm_revenue': rev, 'ttm_operating_profit': op,
            'ttm_net_income': ni, 'ttm_operating_cash_flow': ocf}
