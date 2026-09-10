import type { StockDetail, StockQuarter } from './stock-detail';
import { quarterSeries } from './stock-research.ts';
export type FinancialPeriodMode = 'quarter' | 'annual' | 'ttm';
export const financeLabels: Record<string, string> = {
  rev: '매출',
  op: '영업이익',
  ni: '순이익(전체)',
  ocf: '영업현금흐름',
  receivables: '매출채권',
  inventories: '재고자산',
  cash: '현금·현금성자산',
  short_debt: '단기차입금',
  long_debt: '장기차입금',
  current_long_debt: '유동성 장기차입금',
  bonds: '사채',
  ppe_purchase: '유형자산 취득',
  equity: '자본총계',
  debt: '부채총계',
  op_margin_pct: '영업이익률',
  debt_ratio_pct: '부채비율',
};
const flows = ['rev', 'op', 'ni', 'ni_parent', 'ocf', 'ppe_purchase'];
export function periodRows(
  stock: StockDetail,
  mode: FinancialPeriodMode,
): StockQuarter[] {
  if (mode === 'annual') {
    const annual = stock.annual_financials ?? [];
    if (!annual.length) return [];
    const first = Math.min(...annual.map((q) => q.year)),
      last = Math.max(...annual.map((q) => q.year));
    return Array.from(
      { length: Math.min(last - first + 1, 20) },
      (_, i) =>
        annual.find((q) => q.year === first + i) ?? {
          year: first + i,
          quarter: '4Q',
          label: `${first + i} 연간`,
        },
    );
  }
  const quarters = quarterSeries(stock.quarters);
  if (mode === 'quarter') return quarters;
  return quarters.map((row, index) => {
    const group = quarters.slice(Math.max(0, index - 3), index + 1),
      serials = group.map((q) => q.year * 4 + Number(q.quarter[0]));
    const comparable =
      group.length === 4 &&
      ['CFS', 'OFS'].includes(row.statement_basis ?? '') &&
      group.every((q) => q.statement_basis === row.statement_basis) &&
      serials.every((n, i) => i === 0 || n === serials[i - 1] + 1);
    const result: StockQuarter = {
      ...row,
      label: `${row.year} ${row.quarter} TTM`,
      metric_sources: { ...row.metric_sources },
    };
    for (const metric of flows) {
      const values = group.map((q) => q[metric]);
      result[metric] =
        comparable &&
        group.every(
          (q) =>
            !(
              q.metric_sources?.[metric] as
                | { comparison_status?: string }
                | undefined
            )?.comparison_status,
        ) &&
        values.every((v) => typeof v === 'number' && Number.isFinite(v))
          ? values.reduce<number>((s, v) => s + (v as number), 0)
          : null;
      result.metric_sources![metric] = {
        status: result[metric] === null ? 'not_comparable' : 'derived',
        formula: '연속 4개 단독 분기 합계',
        inputs: group.map((q) => q.metric_sources?.[metric]),
      };
    }
    result.op_margin_pct =
      typeof result.op === 'number' &&
      typeof result.rev === 'number' &&
      result.rev !== 0
        ? (result.op / result.rev) * 100
        : null;
    result.metric_sources!.op_margin_pct = {
      status: result.op_margin_pct === null ? 'not_comparable' : 'derived',
      formula: '동일 기준 TTM 영업이익 ÷ 매출 × 100',
      inputs: [result.metric_sources!.op, result.metric_sources!.rev],
    };
    return result;
  });
}
