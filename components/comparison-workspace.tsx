'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Check, ChevronRight, Search } from 'lucide-react';
import { AppNav } from '@/components/learning-library';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { ResearchKpi } from '@/lib/research-system';
import {
  formatMultiple,
  formatPercent,
  formatWon,
  type StockDetail,
} from '@/lib/stock-detail';

export type ComparisonStock = {
  stock: StockDetail;
  kpis: ResearchKpi[];
  thesis_count: number;
};
export function ComparisonWorkspace({ items }: { items: ComparisonStock[] }) {
  const [codes, setCodes] = useState(
      items.slice(0, 3).map((item) => item.stock.code),
    ),
    [query, setQuery] = useState('');
  const selected = items.filter((item) => codes.includes(item.stock.code));
  const toggle = (code: string) =>
    setCodes((prior) =>
      prior.includes(code)
        ? prior.filter((item) => item !== code)
        : prior.length < 5
          ? [...prior, code]
          : prior,
    );
  const kpiNames = useMemo(
    () => [
      ...new Set(selected.flatMap((item) => item.kpis.map((kpi) => kpi.name))),
    ],
    [selected],
  );
  const rows = [
    {
      label: '현재가',
      read: (x: ComparisonStock) => formatWon(x.stock.summary.latest_price),
    },
    {
      label: '시가총액',
      read: (x: ComparisonStock) =>
        formatWon(x.stock.summary.market_cap_krw, true),
    },
    {
      label: 'PER',
      read: (x: ComparisonStock) => formatMultiple(x.stock.valuation.per),
    },
    {
      label: 'PBR',
      read: (x: ComparisonStock) => formatMultiple(x.stock.valuation.pbr),
    },
    {
      label: 'TTM ROE',
      read: (x: ComparisonStock) =>
        formatPercent(x.stock.valuation.ttm_roe_pct),
    },
    {
      label: 'TTM 매출',
      read: (x: ComparisonStock) =>
        formatWon(x.stock.valuation.ttm_revenue, true),
    },
    {
      label: 'TTM 영업이익',
      read: (x: ComparisonStock) =>
        formatWon(x.stock.valuation.ttm_operating_profit, true),
    },
    {
      label: 'TTM 순이익',
      read: (x: ComparisonStock) =>
        formatWon(x.stock.valuation.ttm_net_income, true),
    },
    {
      label: 'TTM 영업현금흐름',
      read: (x: ComparisonStock) =>
        formatWon(x.stock.valuation.ttm_operating_cash_flow, true),
    },
    {
      label: '부채비율',
      read: (x: ComparisonStock) =>
        formatPercent(x.stock.valuation.debt_ratio_pct),
    },
    {
      label: '투자포인트',
      read: (x: ComparisonStock) => `${x.thesis_count}개`,
    },
  ];
  const filtered = items.filter((item) =>
    `${item.stock.name} ${item.stock.code}`
      .toLocaleLowerCase('ko-KR')
      .includes(query.toLocaleLowerCase('ko-KR')),
  );
  return (
    <div className="h-dvh overflow-hidden bg-background">
      <div className="grid h-full grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
        <AppNav active="compare" />
        <main className="flex min-w-0 flex-col overflow-hidden">
          <header className="shrink-0 border-b bg-white px-5 py-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Link href="/markets" className="hover:text-foreground">Markets</Link>{' '}
                  <ChevronRight className="size-3" /> 기업 비교
                </div>
                <h1 className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">
                  기업 비교
                </h1>
                <p className="mt-1 text-[9px] text-muted-foreground">
                  실제 재무값 · 사업 KPI
                </p>
              </div>
              <Badge variant="secondary">{selected.length}/5 선택</Badge>
            </div>
          </header>
          <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r bg-slate-50/60">
              <div className="relative border-b p-3">
                <Search className="absolute left-6 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="관심종목 검색"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {filtered.map((item) => {
                  const active = codes.includes(item.stock.code);
                  return (
                    <button
                      key={item.stock.code}
                      onClick={() => toggle(item.stock.code)}
                      className={`mb-1 flex w-full items-center gap-2 rounded-xl border p-3 text-left ${active ? 'border-primary/20 bg-white shadow-sm' : 'border-transparent hover:bg-white'}`}
                    >
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-md border ${active ? 'border-primary bg-primary text-white' : 'bg-white'}`}
                      >
                        {active && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-[10px]">
                          {item.stock.name}
                        </strong>
                        <small className="text-[8px] text-muted-foreground">
                          {item.stock.code} ·{' '}
                          {item.stock.industry ||
                            item.stock.sector ||
                            '업종 미확인'}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="border-t p-3 text-[8px] leading-4 text-muted-foreground">
                기업별 회계 기준과 결산 시점이 다를 수 있으므로 원자료 기준일을
                함께 확인하세요.
              </p>
            </aside>
            <section className="min-h-0 overflow-auto p-3 sm:p-4">
              {selected.length < 2 && (
                <div className="mb-3 flex min-w-0 items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/[0.035] px-3 py-2.5 text-[10px] text-slate-600">
                  <span>
                    {items.length < 2
                      ? '비교할 관심종목이 1개입니다. 종목을 더 등록하면 차이를 나란히 볼 수 있습니다.'
                      : '비교하려면 관심종목을 한 개 이상 더 선택하세요.'}
                  </span>
                  {items.length < 2 && (
                    <Link href="/watchlist" className="shrink-0 font-semibold text-primary">
                      종목 추가
                    </Link>
                  )}
                </div>
              )}
              <div
                className={`overflow-hidden rounded-2xl border bg-white ${selected.length <= 1 ? 'max-w-[620px]' : 'w-full'}`}
                style={{
                  minWidth: `${170 * (Math.max(selected.length, 1) + 1)}px`,
                }}
              >
                <div
                  className="grid border-b bg-slate-50/70"
                  style={{
                    gridTemplateColumns: `170px repeat(${Math.max(selected.length, 1)}, minmax(170px, 1fr))`,
                  }}
                >
                  <div className="p-4 text-[9px] font-medium text-muted-foreground">
                    비교 항목
                  </div>
                  {selected.map((item) => (
                    <Link
                      key={item.stock.code}
                      href={`/stocks/${item.stock.code}?tab=research`}
                      className="border-l p-4 hover:bg-white"
                    >
                      <strong className="block text-[11px]">
                        {item.stock.name}
                      </strong>
                      <span className="mt-1 block text-[8px] text-muted-foreground">
                        {item.stock.code} ·{' '}
                        {item.stock.summary.price_as_of ?? '가격 시점 미확인'}
                      </span>
                    </Link>
                  ))}
                </div>
                {rows.map((row) => (
                  <CompareRow
                    key={row.label}
                    label={row.label}
                    values={selected.map(row.read)}
                  />
                ))}
                {kpiNames.length > 0 && (
                  <div className="border-y bg-primary/[0.035] px-4 py-2 text-[9px] font-semibold text-primary">
                    직접 기록한 사업 KPI · 최신 관측값
                  </div>
                )}
                {kpiNames.map((name) => (
                  <CompareRow
                    key={name}
                    label={name}
                    values={selected.map((item) => {
                      const kpi = item.kpis.find(
                          (candidate) => candidate.name === name,
                        ),
                        latest = kpi?.observations.at(-1);
                      return latest?.actual === null ||
                        latest?.actual === undefined
                        ? '—'
                        : `${latest.actual.toLocaleString('ko-KR')} ${kpi?.unit ?? ''}`;
                    })}
                    notes={selected.map((item) => {
                      const latest = item.kpis
                        .find((kpi) => kpi.name === name)
                        ?.observations.at(-1);
                      return latest
                        ? `${latest.period} · ${latest.source_label}`
                        : '관측 없음';
                    })}
                  />
                ))}
                {selected.length === 0 && (
                  <div className="grid h-64 place-items-center text-xs text-muted-foreground">
                    왼쪽에서 비교할 관심종목을 선택하세요.
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
function CompareRow({
  label,
  values,
  notes,
}: {
  label: string;
  values: string[];
  notes?: string[];
}) {
  return (
    <div
      className="grid border-b last:border-b-0"
      style={{
        gridTemplateColumns: `170px repeat(${Math.max(values.length, 1)}, minmax(170px, 1fr))`,
      }}
    >
      <div className="bg-slate-50/40 px-4 py-3 text-[9px] font-medium text-slate-600">
        {label}
      </div>
      {values.map((value, index) => (
        <div key={index} className="border-l px-4 py-3">
          <strong className="text-[11px] tabular-nums">{value}</strong>
          {notes?.[index] && (
            <span className="mt-1 block text-[8px] text-muted-foreground">
              {notes[index]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
