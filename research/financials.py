from __future__ import annotations
from typing import Any
from research.financial_accounts import METRICS,FLOW,account
ORDER={'1Q':1,'2Q':2,'3Q':3,'4Q':4}
PARSER_VERSION='dart-audited-v2'
LABELS={'rev':'매출','op':'영업이익','ni':'순이익','ni_parent':'지배주주 순이익','equity':'자본총계','equity_parent':'지배주주 자본','debt':'부채총계','cash':'현금','ocf':'영업현금흐름','inventories':'재고자산','receivables':'매출채권','ppe_purchase':'유형자산 취득','short_debt':'단기차입금','long_debt':'장기차입금','bonds':'사채','current_long_debt':'유동성 장기차입금'}
ISSUES={'conflicting_accounts':'원계정 금액 상충','currency_unverified':'통화 미확인','invalid_basis':'연결·별도 기준 미확인','not_comparable':'비교할 직전 누적 자료 부족 또는 기준 불일치'}

def _base(doc):
    receipt=doc.get('receipt_no')
    return {'year':doc['year'],'quarter':doc['quarter'],'label':f"{doc['year']} {doc['quarter']}",
            'statement_basis':doc.get('basis'),'receipt_no':receipt,
            'source_url':f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt}' if receipt else None,
            'collected_at':doc.get('collected_at'),'parser_version':PARSER_VERSION,'currency':'KRW','metric_sources':{},'warnings':[]}

def _ratios(row):
    row['op_margin_pct']=row['op']/row['rev']*100 if row.get('rev') and row.get('op') is not None else None
    row['debt_ratio_pct']=row['debt']/row['equity']*100 if row.get('equity') and row['equity']>0 and row.get('debt') is not None else None
    capex=row.get('ppe_purchase')
    row['ocf_less_ppe']=row['ocf']-capex if row.get('ocf') is not None and capex is not None and capex>=0 else None
    for metric,formula,operands in [('op_margin_pct','영업이익 ÷ 매출 × 100',('op','rev')),('debt_ratio_pct','부채총계 ÷ 자본총계 × 100',('debt','equity')),('ocf_less_ppe','영업현금흐름 - 유형자산 취득',('ocf','ppe_purchase'))]:
        row['metric_sources'][metric]={'status':'derived' if row[metric] is not None else 'not_comparable','formula':formula,'inputs':[row['metric_sources'].get(k) for k in operands]}

def annual_financials(documents):
    annual=[]
    for doc in sorted(documents,key=lambda d:d['year']):
        if doc['quarter']!='4Q': continue
        row=_base(doc);row['label']=f"{doc['year']} 연간"
        for metric in METRICS: row[metric],row['metric_sources'][metric]=account(doc,metric)
        _ratios(row);annual.append(row)
    return annual

def normalize_financials(documents:list[dict[str,Any]],count:int)->list[dict[str,Any]]:
    mapped={}
    for doc in documents:
        key=(doc['year'],doc['quarter'])
        if key in mapped: raise ValueError('동일 사업연도·보고서가 중복되었습니다. 정정 버전을 확인해 주세요.')
        mapped[key]=doc
    quarters=[]
    for (year,quarter),doc in sorted(mapped.items(),key=lambda x:(x[0][0],ORDER[x[0][1]])):
        row=_base(doc)
        for metric in METRICS:
            value,source=account(doc,metric)
            inputs=[source]
            if metric in FLOW and ((metric in ('ocf','ppe_purchase') and quarter!='1Q') or quarter=='4Q'):
                previous=None
                prior=mapped.get((year,f'{ORDER[quarter]-1}Q'))
                if prior and prior.get('basis')==doc.get('basis') and doc.get('basis') in ('CFS','OFS'):
                    field='thstrm_add_amount' if metric not in ('ocf','ppe_purchase') else 'thstrm_amount'
                    previous,previous_source=account(prior,metric,field)
                    inputs.append(previous_source)
                    if quarter=='4Q' and metric not in ('ocf','ppe_purchase') and previous is None and previous_source['status'] in ('missing','missing_amount'):
                        preceding=[q for q in quarters if q['year']==year]
                        if len(preceding)==3 and all(q['statement_basis']==doc['basis'] and q.get(metric) is not None for q in preceding):
                            previous=sum(q[metric] for q in preceding)
                            inputs=[source]+[q['metric_sources'][metric] for q in preceding]
                value=value-previous if value is not None and previous is not None else None
                source={**source,'status':'derived' if value is not None else 'not_comparable','formula':'당기 누적 - 직전 동년 누적','inputs':inputs}
            row[metric]=value;row['metric_sources'][metric]=source
            if source['status'] in ('conflicting_accounts','currency_unverified','invalid_basis','not_comparable'):
                row['warnings'].append(f'{LABELS[metric]}: {ISSUES[source["status"]]}')
        _ratios(row);quarters.append(row)
    # Later filings may restate earlier quarters. Keep each reported standalone
    # amount, but do not silently mix those vintages in TTM or ratio calculations.
    for row in quarters:
        quarter=row['quarter'];year=row['year']
        if quarter=='1Q':continue
        doc=mapped[(year,quarter)]
        group=[q for q in quarters if q['year']==year and ORDER[q['quarter']]<=ORDER[quarter]]
        if len(group)!=ORDER[quarter] or any(q['statement_basis']!=row['statement_basis'] for q in group):continue
        for metric in ('rev','op','ni','ni_parent'):
            ytd,_=account(doc,metric,'thstrm_amount' if quarter=='4Q' else 'thstrm_add_amount')
            if ytd is None or any(q.get(metric) is None for q in group):continue
            disclosed=sum(q[metric] for q in group)
            if disclosed==ytd:continue
            warning=f'{year} {quarter} {LABELS[metric]}: 공시 누적액과 분기 합계 차이 {disclosed-ytd:,}원. 정정·재작성 여부 확인 필요.'
            for q in group:
                q['metric_sources'][metric]['comparison_status']='reported_cumulative_mismatch'
                q['metric_sources'][metric]['reconciliation']={'reported_ytd':ytd,'sum_disclosed_quarters':disclosed,'difference_krw':disclosed-ytd,'receipt_no':doc.get('receipt_no')}
                if warning not in q['warnings']:q['warnings'].append(warning)
    return quarters[-count:]

def research_valuation(quarters:list[dict[str,Any]],market_cap:float|None)->dict[str,Any]:
    recent=quarters[-4:]
    serials=[q['year']*4+ORDER[q['quarter']] for q in recent]
    basis=recent[-1].get('statement_basis') if recent else None
    comparable=len(recent)==4 and basis in ('CFS','OFS') and all(q.get('statement_basis')==basis for q in recent) and serials==list(range(serials[0],serials[0]+4))
    def total(metric):return sum(q[metric] for q in recent) if comparable and all(q.get(metric) is not None and not q.get('metric_sources',{}).get(metric,{}).get('comparison_status') for q in recent) else None
    rev,op,ni,ocf=[total(m) for m in ('rev','op','ni','ocf')]
    latest=recent[-1] if recent else {}
    # Common-share ratios must use parent-attributable earnings/equity for CFS.
    attributable=total('ni_parent') if basis=='CFS' else ni
    equity=latest.get('equity_parent') if basis=='CFS' else latest.get('equity')
    opening=next((q for q in quarters if q['year']*4+ORDER[q['quarter']]==(serials[-1]-4 if serials else -1) and q.get('statement_basis')==basis),{})
    opening_equity=opening.get('equity_parent') if basis=='CFS' else opening.get('equity')
    avg=(equity+opening_equity)/2 if equity is not None and opening_equity is not None and equity>0 and opening_equity>0 else None
    return {'roe_basis':'average','attribution_basis':'parent' if basis=='CFS' else 'total','interest_basis':'interest',
            'per':market_cap/attributable if market_cap and attributable and attributable>0 else None,
            'pbr':market_cap/equity if market_cap and equity and equity>0 else None,
            'ev_ebitda':None,'ev_operating_profit':None,'interest_coverage':None,
            'ttm_roe_pct':attributable/avg*100 if attributable is not None and avg else None,
            'debt_ratio_pct':latest.get('debt_ratio_pct'),'ttm_revenue':rev,'ttm_operating_profit':op,'ttm_net_income':ni,'ttm_operating_cash_flow':ocf,
            'method':'CFS는 지배주주 순이익·자본, ROE는 기초·기말 평균자본. 미확인 시 미표시.'}
