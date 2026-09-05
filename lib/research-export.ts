import type { StockDetail } from './stock-detail.ts';

export function csvCell(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  // Keep numeric negatives numeric; neutralize formulas in user/source text.
  if (typeof value !== 'number' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function financialCsv(stock: StockDetail): string {
  const metrics = [
    ['rev', '매출액', '원'],
    ['op', '영업이익', '원'],
    ['ni', '순이익', '원'],
    ['ocf', '영업현금흐름', '원'],
    ['equity', '자본', '원'],
    ['debt', '부채총계', '원'],
    ['op_margin_pct', '영업이익률', '%'],
    ['debt_ratio_pct', '부채비율', '%'],
  ] as const;
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
    ],
  ];
  for (const q of stock.quarters)
    for (const [key, label, unit] of metrics)
      rows.push([
        stock.code,
        stock.name,
        q.year,
        q.quarter,
        label,
        q[key] ?? null,
        unit,
        q.statement_basis ?? '미확인',
        key === 'equity' || key === 'debt' || key === 'debt_ratio_pct'
          ? '기말 잔액'
          : '단독 분기',
        q.source_url ||
          (q.receipt_no
            ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${q.receipt_no}`
            : ''),
        source?.collected_at ?? stock.collected_at ?? stock.generated_at,
        source?.run_id ?? stock.research_run_id ?? stock.run_id,
        source?.status ?? 'missing',
        [...(q.warnings ?? []), source?.warning].filter(Boolean).join(' / '),
      ]);
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
