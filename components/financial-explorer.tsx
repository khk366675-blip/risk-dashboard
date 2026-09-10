'use client';
import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type { StockDetail, StockQuarter } from '@/lib/stock-detail';
import { formatWon } from '@/lib/stock-detail';
import { FinancialObservationLinker } from '@/components/stock-research-panels';
import {
  financialMetrics,
  quarterSeries,
  type FinancialMetric,
} from '@/lib/stock-research';
import {
  financeLabels,
  periodRows,
  type FinancialPeriodMode,
} from '@/lib/financial-analysis';
const groups: Record<string, string[]> = {
  손익·현금흐름: ['ni', 'ocf'],
  매출·운전자본: ['rev', 'receivables', 'inventories'],
  설비투자: ['ocf', 'ppe_purchase'],
  현금·차입금: [
    'cash',
    'short_debt',
    'long_debt',
    'current_long_debt',
    'bonds',
  ],
  '기본 재무': [
    'rev',
    'op',
    'op_margin_pct',
    'equity',
    'debt',
    'debt_ratio_pct',
  ],
};
const colors = ['#2563eb', '#0d9488', '#d97706', '#7c3aed', '#64748b'];
function display(metric: string, value: unknown, compact = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return metric.endsWith('_pct')
    ? `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`
    : formatWon(value, compact);
}
export function FinancialExplorer({ stock }: { stock: StockDetail }) {
  const [mode, setMode] = useState<FinancialPeriodMode>('quarter'),
    [group, setGroup] = useState('손익·현금흐름'),
    [selection, setSelection] = useState<{
      row: StockQuarter;
      metric: string;
    } | null>(null);
  const rows = periodRows(stock, mode),
    metrics = groups[group];
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-white">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">재무 분석</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            사업연도 기준 · 원화 · 연결 실선 / 별도 점선 · 잔액은 기말
          </p>
        </div>
        <div className="flex gap-2">
          <a
            className="self-center text-xs text-primary underline"
            href={`/api/stocks/${stock.code}/export?format=csv&period=${mode}`}
            download
          >
            CSV 저장
          </a>
          <select
            aria-label="재무 분석 항목"
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setSelection(null);
            }}
            className="rounded-lg border p-2 text-xs"
          >
            {Object.keys(groups).map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select
            aria-label="재무 기간"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as FinancialPeriodMode);
              setSelection(null);
            }}
            className="rounded-lg border p-2 text-xs"
          >
            <option value="quarter">분기</option>
            <option value="annual">연간</option>
            <option value="ttm">TTM</option>
          </select>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-h-0 overflow-auto p-4">
          {!stock.financial_parser_version && (
            <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              기존 수집본입니다. 자료 갱신 후 계정별 검증과 연간 자료가
              반영됩니다.
            </p>
          )}
          {stock.source_status.financials?.status !== 'ok' && (
            <p className="mb-3 text-xs text-muted-foreground">
              {stock.source_status.financials?.warning ||
                '재무 자료 일부 미확인'}
            </p>
          )}
          {!rows.length ? (
            <p className="p-8 text-sm text-muted-foreground">
              이 기간의 수집 자료가 없습니다. 종목 자료를 갱신해 주세요.
            </p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {metrics.map((metric, i) => (
                  <div key={metric} className="rounded-xl border p-3">
                    <div className="flex justify-between text-xs">
                      <strong>{financeLabels[metric]}</strong>
                      <span className="text-muted-foreground">
                        {metric.endsWith('_pct') ? '%' : '억원'}
                      </span>
                    </div>
                    <div className="mt-3 h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={rows.map((q) => ({
                            label:
                              mode === 'annual'
                                ? String(q.year)
                                : `${q.year} ${q.quarter}`,
                            cfs:
                              q.statement_basis === 'CFS' &&
                              typeof q[metric] === 'number'
                                ? (q[metric] as number) /
                                  (metric.endsWith('_pct') ? 1 : 1e8)
                                : null,
                            ofs:
                              q.statement_basis === 'OFS' &&
                              typeof q[metric] === 'number'
                                ? (q[metric] as number) /
                                  (metric.endsWith('_pct') ? 1 : 1e8)
                                : null,
                          }))}
                        >
                          <CartesianGrid vertical={false} stroke="#e2e8f0" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 9 }}
                            minTickGap={35}
                          />
                          <YAxis tick={{ fontSize: 9 }} width={50} />
                          <Tooltip
                            formatter={(v) => [
                              `${Number(v).toLocaleString('ko-KR')}${metric.endsWith('_pct') ? '%' : '억원'}`,
                              financeLabels[metric],
                            ]}
                          />
                          <Line
                            dataKey="cfs"
                            name="연결"
                            stroke={colors[i % colors.length]}
                            dot={{ r: 2 }}
                            connectNulls={false}
                            strokeWidth={2}
                            isAnimationActive={false}
                          />
                          <Line
                            dataKey="ofs"
                            name="별도"
                            stroke={colors[i % colors.length]}
                            dot={{ r: 2 }}
                            strokeDasharray="4 3"
                            connectNulls={false}
                            strokeWidth={2}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
              <p className="my-3 text-[11px] text-muted-foreground">
                수치를 누르면 원계정과 계산 근거를 확인합니다. 차입금 항목은
                서로 더하지 않습니다. 유형자산 취득은 전체 CAPEX와 다릅니다.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap text-right text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 text-left">기간 · 기준</th>
                      {metrics.map((m) => (
                        <th key={m} className="p-2">
                          {financeLabels[m]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows].reverse().map((row) => (
                      <tr
                        key={`${row.year}${row.quarter}`}
                        className="border-b"
                      >
                        <td className="p-2 text-left">
                          {mode === 'annual'
                            ? `${row.year} 연간`
                            : `${row.year} ${row.quarter}`}
                          <small className="ml-2 text-muted-foreground">
                            {row.statement_basis === 'CFS'
                              ? '연결'
                              : row.statement_basis === 'OFS'
                                ? '별도'
                                : '기준 미확인'}
                          </small>
                        </td>
                        {metrics.map((metric) => (
                          <td key={metric} className="p-2">
                            <button
                              className="text-primary underline decoration-primary/20 underline-offset-4"
                              onClick={() => setSelection({ row, metric })}
                            >
                              {display(metric, row[metric], true)}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <aside className="min-h-0 overflow-y-auto border-l bg-slate-50/50 p-4">
          <h3 className="text-sm font-semibold">수치의 근거</h3>
          {selection ? (
            <>
              <p className="mt-3 text-xs">
                {selection.row.year}{' '}
                {mode === 'annual' ? '연간' : selection.row.quarter} ·{' '}
                {financeLabels[selection.metric]}
              </p>
              <p className="mt-2 text-lg font-semibold">
                {display(selection.metric, selection.row[selection.metric])}
              </p>
              <SourceEvidence
                source={selection.row.metric_sources?.[selection.metric]}
              />
              {mode === 'quarter' &&
                Object.hasOwn(financialMetrics, selection.metric) && (
                  <FinancialObservationLinker
                    key={`${selection.row.year}-${selection.row.quarter}-${selection.metric}`}
                    stock={stock}
                    metric={selection.metric as FinancialMetric}
                    rows={quarterSeries([selection.row])}
                  />
                )}
              {selection.row.source_url && (
                <a
                  className="mt-4 block text-xs text-primary underline"
                  href={selection.row.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  DART 공시 원문
                </a>
              )}
            </>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              표에서 확인할 수치를 선택하세요.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
function SourceEvidence({ source }: { source: unknown }) {
  if (!source || typeof source !== 'object')
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        계정별 검증 자료가 없습니다. 재수집이 필요합니다.
      </p>
    );
  const s = source as Record<string, unknown>,
    reported = s.status === 'reported',
    derived = s.status === 'derived';
  return (
    <div className="mt-3 space-y-2 text-[11px]">
      <p>
        {reported
          ? '원공시 금액'
          : derived
            ? '원공시 기반 계산'
            : '미확인 · 기준 불일치 또는 계정 부족'}
      </p>
      {typeof s.formula === 'string' && <p>{s.formula}</p>}
      {s.comparison_status === 'reported_cumulative_mismatch' && (
        <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
          공시 누적액과 분기 합계가 다릅니다. 원금액은 유지하며 이 구간의 TTM은
          계산하지 않습니다.
        </p>
      )}
      {s.reconciliation && typeof s.reconciliation === 'object' ? (
        <p className="text-muted-foreground">
          누적액{' '}
          {Number(
            (s.reconciliation as Record<string, unknown>).reported_ytd,
          ).toLocaleString('ko-KR')}
          원 · 분기 합계{' '}
          {Number(
            (s.reconciliation as Record<string, unknown>)
              .sum_disclosed_quarters,
          ).toLocaleString('ko-KR')}
          원
        </p>
      ) : null}
      {typeof s.receipt_no === 'string' && (
        <a
          href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${s.receipt_no}`}
          target="_blank"
          rel="noreferrer"
          className="block text-primary underline"
        >
          {String(s.year)} {String(s.quarter)} 공시
        </a>
      )}
      {!derived &&
        Array.isArray(s.accounts) &&
        s.accounts.map((account, i) => {
          const a = account as Record<string, unknown>;
          return (
            <div className="rounded-lg border bg-white p-2" key={i}>
              <p>{String(a.account_nm || a.account_id)}</p>
              <p className="mt-1 break-all text-[10px] text-muted-foreground">
                {String(a.account_id)}
              </p>
              <p className="mt-1">
                {s.field === 'thstrm_add_amount' || a.sj_div === 'CF'
                  ? '당기 누적'
                  : '당기 금액'}
                :{' '}
                {a[String(s.field)] === null || a[String(s.field)] === undefined
                  ? '미제공'
                  : String(a[String(s.field)])}{' '}
                {a.currency === 'KRW'
                  ? '원'
                  : typeof a.currency === 'string'
                    ? a.currency
                    : '단위 미확인'}
              </p>
            </div>
          );
        })}
      {Array.isArray(s.inputs) &&
        s.inputs.map((input, i) => (
          <div className="border-l pl-2" key={i}>
            <SourceEvidence source={input} />
          </div>
        ))}
      {reported && typeof s.collected_at === 'string' && (
        <p className="text-muted-foreground">
          수집 {new Date(s.collected_at).toLocaleDateString('ko-KR')}
        </p>
      )}
    </div>
  );
}
