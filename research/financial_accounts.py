"""Conservative DART account mapping; no fuzzy match and no missing-as-zero."""
import re
from decimal import Decimal, InvalidOperation
from radar_pipeline.dart import ACCOUNT_IDS, ACCOUNT_NAMES

EXTRA = {
 'inventories': ({'ifrs-full_Inventories'}, {'재고자산'}, {'BS'}),
 'receivables': ({'ifrs-full_TradeReceivables'}, {'매출채권'}, {'BS'}),
 'ppe_purchase': ({'ifrs-full_PurchaseOfPropertyPlantAndEquipment','ifrs-full_PaymentsToAcquirePropertyPlantAndEquipment'}, {'유형자산의 취득','유형자산 취득'}, {'CF'}),
 'short_debt': (ACCOUNT_IDS['short_debt'], ACCOUNT_NAMES['short_debt'], {'BS'}),
 'long_debt': (ACCOUNT_IDS['long_debt'], ACCOUNT_NAMES['long_debt'], {'BS'}),
 'bonds': (ACCOUNT_IDS['bonds'], ACCOUNT_NAMES['bonds'], {'BS'}),
 'current_long_debt': (ACCOUNT_IDS['current_long_debt'], ACCOUNT_NAMES['current_long_debt'], {'BS'}),
}
METRICS = {key:(ids,ACCOUNT_NAMES.get(key,set()), {'IS','CIS'} if key in ('rev','op','ni','ni_parent') else {'CF'} if key=='ocf' else {'BS'}) for key,ids in ACCOUNT_IDS.items() if key in ('rev','op','ni','ni_parent','equity','equity_parent','debt','cash','ocf')}
METRICS.update(EXTRA)
FLOW = {'rev','op','ni','ni_parent','ocf','ppe_purchase'}

def amount(value):
    if value is None: return None
    text=str(value).strip().replace(',','').replace('−','-')
    if re.fullmatch(r'\([\d.]+\)',text): text='-'+text[1:-1]
    if not re.fullmatch(r'-?\d+(?:\.\d+)?',text): return None
    try:
        number=Decimal(text)
        if not number.is_finite(): return None
        return int(number) if number==number.to_integral_value() else float(number)
    except InvalidOperation: return None

def account(doc, metric, field='thstrm_amount'):
    ids,names,statements=METRICS[metric]
    evidence={'status':'missing','field':field,'currency':'KRW','basis':doc.get('basis'),
              'year':doc['year'],'quarter':doc['quarter'],'receipt_no':doc.get('receipt_no'),
              'collected_at':doc.get('collected_at'),'accounts':[]}
    if doc.get('basis') not in ('CFS','OFS'):
        return None,{**evidence,'status':'invalid_basis'}
    report_code={'1Q':'11013','2Q':'11012','3Q':'11014','4Q':'11011'}[doc['quarter']]
    rows=[r for r in doc.get('rows',[]) if r.get('sj_div') in statements and r.get('fs_div',doc['basis'])==doc['basis']
          and str(r.get('bsns_year',doc['year']))==str(doc['year']) and r.get('reprt_code',report_code)==report_code
          and (not doc.get('receipt_no') or r.get('rcept_no',doc['receipt_no'])==doc['receipt_no'])]
    matches=[r for r in rows if r.get('account_id') in ids]
    if not matches: matches=[r for r in rows if str(r.get('account_nm','')).strip() in names]
    if not matches: return None,evidence
    evidence['accounts']=[{key:r.get(key) for key in ('account_id','account_nm','sj_div','account_detail','currency',field)} for r in matches]
    if any(r.get('currency') not in ('KRW','원') for r in matches):
        return None,{**evidence,'status':'currency_unverified'}
    values=[amount(r.get(field)) for r in matches]
    if any(v is None for v in values): return None,{**evidence,'status':'missing_amount'}
    if len(set(values))!=1: return None,{**evidence,'status':'conflicting_accounts'}
    return values[0],{**evidence,'status':'reported'}
