import type { StockDetail } from './stock-detail.ts';
import {
  periodRows,
  financeLabels,
  type FinancialPeriodMode,
} from './financial-analysis.ts';

export function csvCell(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  // Keep numeric negatives numeric; neutralize formulas in user/source text.
  if (typeof value !== 'number' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function financialCsv(
  stock: StockDetail,
  mode: FinancialPeriodMode = 'quarter',
): string {
  const metrics = Object.entries(financeLabels).map(([key, label]) => [
    key,
    label,
    key.endsWith('_pct') ? '%' : '원',
  ]);
  const source = stock.source_status.financials;
  const rows: (string | number | null | undefined)[][] = [
    [
      '종목코드',
      '종목명',
      '연도',
      '분기',
      '지표',
      '값',
      '단위',
      '재무기준',
      '대상',
      '원문',
      '수집일',
      '실행ID',
      '출처상태',
      '주의사항',
      '원계정·계산근거 JSON',
    ],
  ];
  for (const q of periodRows(stock, mode))
    for (const [key, label, unit] of metrics)
      rows.push([
        stock.code,
        stock.name,
        q.year,
        q.quarter,
        label,
        typeof q[key] === 'number' && Number.isFinite(q[key])
          ? (q[key] as number)
          : null,
        unit,
        q.statement_basis ?? '미확인',
        [
          'equity',
          'debt',
          'debt_ratio_pct',
          'cash',
          'receivables',
          'inventories',
          'short_debt',
          'long_debt',
          'current_long_debt',
          'bonds',
        ].includes(key)
          ? '기말 잔액'
          : mode === 'quarter'
            ? '단독 분기'
            : mode === 'annual'
              ? '사업연도 연간'
              : '연속 4개 분기 TTM',
        q.source_url ||
          (q.receipt_no
            ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${q.receipt_no}`
            : ''),
        (typeof q.collected_at === 'string' ? q.collected_at : undefined) ??
          source?.collected_at ??
          stock.collected_at ??
          stock.generated_at,
        source?.run_id ?? stock.research_run_id ?? stock.run_id,
        source?.status ?? 'missing',
        [...(q.warnings ?? []), source?.warning].filter(Boolean).join(' / '),
        JSON.stringify(q.metric_sources?.[key] ?? null),
      ]);
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
