import unittest
from research.financial_accounts import amount,account
from research.financials import normalize_financials,annual_financials,research_valuation

def doc(year,quarter,rows,basis='CFS'):
    return {'year':year,'quarter':quarter,'basis':basis,'receipt_no':'20260909000001','rows':rows}
def row(metric,value,statement='IS',**extra):
    ids={'rev':'ifrs-full_Revenue','op':'dart_OperatingIncomeLoss','ni':'ifrs-full_ProfitLoss','ni_parent':'ifrs-full_ProfitLossAttributableToOwnersOfParent','equity':'ifrs-full_Equity','equity_parent':'ifrs-full_EquityAttributableToOwnersOfParent','ocf':'ifrs-full_CashFlowsFromUsedInOperatingActivities','ppe':'ifrs-full_PurchaseOfPropertyPlantAndEquipment'}
    return {'account_id':ids[metric],'sj_div':statement,'thstrm_amount':value,'currency':'KRW',**extra}
class AccuracyTests(unittest.TestCase):
    def test_restatement_mismatch_preserves_reported_quarter_but_blocks_ttm(self):
        docs=[doc(2025,'1Q',[row('rev','10')]),doc(2025,'2Q',[row('rev','20',thstrm_add_amount='35')]),doc(2025,'3Q',[row('rev','30',thstrm_add_amount='65')]),doc(2025,'4Q',[row('rev','100')])]
        quarters=normalize_financials(docs,8)
        self.assertEqual(quarters[1]['rev'],20)
        self.assertEqual(quarters[-1]['rev'],35)
        self.assertEqual(annual_financials(docs)[0]['rev'],100)
        self.assertTrue(all(q['metric_sources']['rev'].get('comparison_status') for q in quarters))
        self.assertIsNone(research_valuation(quarters,1000)['ttm_revenue'])
    def test_radar_finance_costs_and_partial_debt_are_not_interest_or_total_debt(self):
        from radar_pipeline.dart import parse_full_enrichment, metric_value
        from radar_pipeline.config import ReportPeriod
        rows=[{'currency':'KRW','fs_div':'CFS','sj_div':'IS','account_id':'ifrs-full_FinanceCosts','account_nm':'금융비용','thstrm_amount':'100'}, {'currency':'KRW','fs_div':'CFS','sj_div':'BS','account_id':'ifrs-full_ShorttermBorrowings','thstrm_amount':'10'}]
        period=ReportPeriod(2026,'11013','1Q')
        result=parse_full_enrichment({('000001',period.key):rows},[period])['000001'][(2026,'1Q')]
        self.assertIsNone(result['interest']);self.assertIsNone(result['fin_debt'])
        self.assertIsNone(metric_value([row('rev','10',currency='USD')],'rev','thstrm_amount',{'IS'}))
        self.assertIsNone(metric_value([row('rev','10'),row('rev','20')],'rev','thstrm_amount',{'IS'}))
    def test_amount_does_not_turn_missing_into_zero(self):
        for value in (None,'','-','NaN','Infinity','1억원'):
            self.assertIsNone(amount(value))
        self.assertEqual(amount('0'),0)
        self.assertEqual(amount('(1,230)'),-1230)
        self.assertEqual(amount('999,999,999,999,999'),999999999999999)
    def test_ambiguous_duplicates_rejected_independent_of_row_order(self):
        a,b=row('rev','100'),row('rev','200')
        for rows in ([a,b],[b,a]):
            value,source=account(doc(2026,'2Q',rows),'rev')
            self.assertIsNone(value);self.assertEqual(source['status'],'conflicting_accounts')
    def test_wrong_currency_period_or_basis_never_passes(self):
        for extra in ({'currency':'USD'},{'currency':None},{'fs_div':'OFS'},{'bsns_year':'2025'},{'reprt_code':'11011'},{'rcept_no':'20260909000002'}):
            self.assertIsNone(account(doc(2026,'2Q',[row('rev','100',**extra)]),'rev')[0])
        self.assertIsNone(account(doc(2026,'2Q',[row('rev','100')],None),'rev')[0])
    def test_three_month_income_is_not_differenced_in_half_year(self):
        docs=[doc(2026,'1Q',[row('rev','80')]),doc(2026,'2Q',[row('rev','100',thstrm_add_amount='180')])]
        self.assertEqual(normalize_financials(docs,8)[1]['rev'],100)
    def test_q4_uses_ytd_same_basis_and_retains_all_operand_sources(self):
        docs=[doc(2025,'3Q',[row('rev','120',thstrm_add_amount='300')]),doc(2025,'4Q',[row('rev','440')])]
        q=normalize_financials(docs,8)[-1]
        self.assertEqual(q['rev'],140);self.assertEqual(q['metric_sources']['rev']['status'],'derived');self.assertEqual(len(q['metric_sources']['rev']['inputs']),2)
        self.assertEqual(annual_financials(docs)[0]['rev'],440)
        docs[0]['basis']='OFS';self.assertIsNone(normalize_financials(docs,8)[-1]['rev'])
    def test_cashflow_and_ppe_purchase_are_cumulative(self):
        docs=[doc(2026,'1Q',[row('ocf','10','CF'),row('ppe','4','CF')]),doc(2026,'2Q',[row('ocf','18','CF'),row('ppe','10','CF')])]
        q=normalize_financials(docs,8)[-1]
        self.assertEqual(q['ocf'],8);self.assertEqual(q['ppe_purchase'],6);self.assertEqual(q['ocf_less_ppe'],2)
    def test_missing_cf_prior_cannot_be_substituted_with_zero(self):
        q=normalize_financials([doc(2026,'2Q',[row('ocf','18','CF')])],8)[0]
        self.assertIsNone(q['ocf'])
    def test_ttm_requires_contiguity_and_known_basis(self):
        rows=[{'year':2026,'quarter':f'{i}Q','statement_basis':None,'rev':100} for i in range(1,5)]
        self.assertIsNone(research_valuation(rows,1000)['ttm_revenue'])
        for r in rows:r['statement_basis']='CFS'
        rows[-1]['year']=2027;self.assertIsNone(research_valuation(rows,1000)['ttm_revenue'])
    def test_parent_ratios_and_average_equity_not_total_ni_or_closing_equity(self):
        rows=[{'year':2025,'quarter':'4Q','statement_basis':'CFS','equity_parent':100}]+[{'year':2026,'quarter':f'{i}Q','statement_basis':'CFS','ni':50,'ni_parent':10,'equity_parent':200} for i in range(1,5)]
        values=research_valuation(rows,1000)
        self.assertEqual(values['per'],25);self.assertEqual(values['pbr'],5);self.assertAlmostEqual(values['ttm_roe_pct'],40/150*100)
        rows[-1]['ni_parent']=None;self.assertIsNone(research_valuation(rows,1000)['per'])
    def test_duplicate_report_is_not_silently_overwritten(self):
        d=doc(2026,'1Q',[row('rev','100')])
        with self.assertRaises(ValueError):normalize_financials([d,d],8)
if __name__=='__main__':unittest.main()
