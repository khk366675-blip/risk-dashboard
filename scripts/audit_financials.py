"""Read-only check of cached DART source mapping and annual reconciliation.

No source refresh, writes, portfolio decisions or AI requests.
"""
import json
from collections import Counter
from pathlib import Path
from research.financials import normalize_financials,annual_financials
from research.financial_accounts import account

def audit(root=Path('data/research/raw')):
    reports=companies=checks=0;errors=[];states=Counter();samples=[];reconciliation=[]
    for directory in sorted(root.iterdir()):
        if not directory.is_dir():continue
        docs=[json.loads(file.read_text(encoding='utf-8')) for file in directory.glob('*.json')]
        if not docs:continue
        companies+=1;reports+=len(docs)
        quarters=normalize_financials(docs,80);annual=annual_financials(docs)
        for q in quarters:
            states.update(source['status'] for source in q['metric_sources'].values())
            doc=next(d for d in docs if (d['year'],d['quarter'])==(q['year'],q['quarter']))
            for metric in ('rev','op','ni'):
                if q['quarter']=='4Q':continue
                value,_=account(doc,metric)
                if value is not None:
                    checks+=1
                    if q[metric]!=value:errors.append([directory.name,q['year'],q['quarter'],metric,'direct amount mismatch'])
        for a in annual:
            group=[q for q in quarters if q['year']==a['year'] and q['statement_basis']==a['statement_basis']]
            for metric in ('rev','op','ni','ocf','ppe_purchase'):
                if len(group)==4 and a[metric] is not None and all(q.get(metric) is not None for q in group):
                    checks+=1
                    if sum(q[metric] for q in group)!=a[metric]:
                        target=reconciliation if all(q['metric_sources'][metric].get('comparison_status') for q in group) else errors
                        target.append([directory.name,a['year'],metric,'reported amounts differ; TTM blocked' if target is reconciliation else 'unflagged annual mismatch'])
        if directory.name in ('084110','196170','383220'):
            q=quarters[-1];samples.append({'code':directory.name,'year':q['year'],'quarter':q['quarter'],'receipt_no':q['receipt_no'],'basis':q['statement_basis'],'revenue_krw':q['rev'],'ocf_krw':q['ocf']})
    return {'companies':companies,'reports':reports,'checks':checks,'errors':errors,'reconciliation_warnings':reconciliation,'source_states':dict(states),'samples':samples}
if __name__=='__main__':
    result=audit();print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(bool(result['errors']))
