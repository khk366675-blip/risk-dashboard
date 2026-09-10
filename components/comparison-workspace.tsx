'use client';
import { useEffect, useState } from 'react';
import { AppNav } from '@/components/learning-library';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActionConfirmation } from '@/components/use-action-confirmation';
import { formatWon, type StockDetail } from '@/lib/stock-detail';
import type { ResearchKpi } from '@/lib/research-system';
import {
  financeLabels,
  periodRows,
  type FinancialPeriodMode,
} from '@/lib/financial-analysis';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
export type ComparisonStock = {
  stock: StockDetail;
  kpis: ResearchKpi[];
  thesis_count: number;
  peer?: boolean;
  job?: { state: string; step: string } | null;
};
type SavedSet = { id: string; title: string; reason: string; codes: string[] };
export function ComparisonWorkspace({
  items: initial,
}: {
  items: ComparisonStock[];
}) {
  const [items, setItems] = useState(initial),
    [sets, setSets] = useState<SavedSet[]>([]),
    [codes, setCodes] = useState(initial.slice(0, 3).map((x) => x.stock.code)),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<{ code: string; name: string }[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [id, setId] = useState<string>(),
    [title, setTitle] = useState(''),
    [reason, setReason] = useState(''),
    [mode, setMode] = useState<FinancialPeriodMode>('quarter'),
    [period, setPeriod] = useState('');
  const { confirmAction, confirmationDialog } = useActionConfirmation();
  async function refresh() {
    const r = await fetch('/api/compare', { cache: 'no-store' }),
      b = await r.json();
    if (!r.ok) throw new Error(b.error);
    setItems(b.items);
    setSets(b.sets);
    setError('');
  }
  useEffect(() => {
    let active = true;
    const tick = () => {
      if (active) void refresh().catch((e) => setError(e.message));
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const selected = codes
    .map((c) => items.find((x) => x.stock.code === c))
    .filter((x): x is ComparisonStock => !!x);
  const periods = [
    ...new Set(
      selected.flatMap((x) =>
        periodRows(x.stock, mode).map((q) =>
          mode === 'annual' ? String(q.year) : `${q.year} ${q.quarter}`,
        ),
      ),
    ),
  ]
    .sort()
    .reverse();
  const current = periods.includes(period) ? period : (periods[0] ?? '');
  const rowFor = (item: ComparisonStock) =>
    periodRows(item.stock, mode).find(
      (q) =>
        (mode === 'annual' ? String(q.year) : `${q.year} ${q.quarter}`) ===
        current,
    );
  async function search() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(
          `/api/stocks/search?q=${encodeURIComponent(query)}`,
        ),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setResults(b.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '검색 실패');
    } finally {
      setBusy(false);
    }
  }
  async function add(code: string, retry = false, refresh = false) {
    if (
      !(await confirmAction({
        title:
          retry || refresh
            ? '비교 자료를 재수집할까요?'
            : '비교 기업으로 추가할까요?',
        description:
          '관심종목에는 등록하지 않습니다. 비교용 가격·DART 재무를 별도 수집하며 AI는 실행하지 않습니다.',
        actionLabel: retry || refresh ? '재수집' : '비교 기업 추가',
      }))
    )
      return;
    setBusy(true);
    try {
      const r = await fetch('/api/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, retry, refresh }),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setItems(b.items);
      setCodes((c) => (c.includes(code) ? c : c.length < 5 ? [...c, code] : c));
      setResults([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '추가 실패');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/compare', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, title, reason, codes }),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setSets(b.sets);
      setId(b.sets.find((x: SavedSet) => x.title === title)?.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="h-dvh overflow-hidden bg-background">
      {confirmationDialog}
      <div className="grid h-full md:grid-cols-[210px_minmax(0,1fr)]">
        <AppNav active="compare" />
        <main className="flex min-w-0 flex-col overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white p-4">
            <h1 className="text-lg font-semibold">기업 비교</h1>
            <div className="flex gap-2">
              <select
                value={mode}
                aria-label="비교 기간 단위"
                onChange={(e) => setMode(e.target.value as FinancialPeriodMode)}
                className="rounded-lg border p-2 text-xs"
              >
                <option value="quarter">분기</option>
                <option value="annual">연간</option>
                <option value="ttm">TTM</option>
              </select>
              <select
                value={current}
                aria-label="비교 사업연도 기간"
                onChange={(e) => setPeriod(e.target.value)}
                className="rounded-lg border p-2 text-xs"
              >
                {periods.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </header>
          <div className="grid min-h-0 flex-1 md:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="space-y-3 overflow-y-auto border-r bg-slate-50/50 p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
                className="flex gap-1"
              >
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="비교 기업 검색"
                />
                <Button size="sm" disabled={busy || !query.trim()}>
                  검색
                </Button>
              </form>
              {results.map((r) => (
                <button
                  className="block w-full rounded-lg border bg-white p-2 text-left text-xs"
                  key={r.code}
                  onClick={() => void add(r.code)}
                  disabled={busy}
                >
                  {r.name} · {r.code} ＋
                </button>
              ))}
              <p className="text-[11px] text-muted-foreground">
                최대 5개 · 비교 기업은 관심종목과 별도 관리
              </p>
              {items.map((item) => (
                <div
                  key={item.stock.code}
                  className="rounded-xl border bg-white p-3"
                >
                  <label className="flex gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={codes.includes(item.stock.code)}
                      disabled={
                        !codes.includes(item.stock.code) && codes.length >= 5
                      }
                      onChange={() =>
                        setCodes((c) =>
                          c.includes(item.stock.code)
                            ? c.filter((x) => x !== item.stock.code)
                            : [...c, item.stock.code],
                        )
                      }
                    />
                    <strong>{item.stock.name}</strong>
                    <small className="ml-auto text-muted-foreground">
                      {item.peer ? '비교 기업' : '관심종목'}
                    </small>
                  </label>
                  {item.job &&
                    ['queued', 'running', 'error', 'partial'].includes(
                      item.job.state,
                    ) && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        {item.job.step}
                      </p>
                    )}
                  {item.peer && (
                    <button
                      disabled={
                        busy ||
                        ['queued', 'running'].includes(item.job?.state ?? '')
                      }
                      className="mt-2 text-[10px] text-primary underline"
                      onClick={() => void add(item.stock.code, false, true)}
                    >
                      자료 최신화
                    </button>
                  )}
                </div>
              ))}
              <div className="space-y-2 border-t pt-4">
                <select
                  aria-label="저장된 비교 조합"
                  className="w-full rounded-lg border p-2 text-xs"
                  value={id ?? ''}
                  onChange={(e) => {
                    const s = sets.find((x) => x.id === e.target.value);
                    setId(s?.id);
                    setTitle(s?.title ?? '');
                    setReason(s?.reason ?? '');
                    if (s) setCodes(s.codes);
                  }}
                >
                  <option value="">새 비교 조합</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="조합 이름"
                  maxLength={100}
                />
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="이 기업들을 비교하는 이유"
                  maxLength={4000}
                  className="min-h-20 w-full rounded-lg border p-2 text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || codes.length < 2 || !title.trim()}
                  onClick={() => void save()}
                >
                  조합 저장
                </Button>
              </div>
            </aside>
            <section className="min-w-0 overflow-auto p-4">
              {error && (
                <p role="alert" className="mb-3 text-xs text-destructive">
                  {error}
                </p>
              )}
              <p className="mb-3 text-xs text-muted-foreground">
                동일 사업연도·보고서 기간의 실제 값입니다. 연결/별도 기준을
                확인하세요. 자료 없는 기간은 비워둡니다.
              </p>
              <table className="w-full min-w-[600px] rounded-xl border bg-white text-right text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-left">
                      {current || '기간 미확인'}
                    </th>
                    {selected.map((item) => (
                      <th className="border-l p-3" key={item.stock.code}>
                        {item.stock.name}
                        <small className="mt-1 block font-normal text-muted-foreground">
                          {rowFor(item)?.statement_basis === 'CFS'
                            ? '연결'
                            : rowFor(item)?.statement_basis === 'OFS'
                              ? '별도'
                              : '기준 미확인'}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    'rev',
                    'op',
                    'ni',
                    'ocf',
                    'receivables',
                    'inventories',
                    'cash',
                    'equity',
                    'debt',
                  ].map((m) => (
                    <tr className="border-b" key={m}>
                      <th className="p-3 text-left font-medium">
                        {financeLabels[m]}
                      </th>
                      {selected.map((item) => {
                        const row = rowFor(item),
                          v = row?.[m];
                        return (
                          <td className="border-l p-3" key={item.stock.code}>
                            {row?.source_url ? (
                              <a
                                href={row.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline decoration-primary/20"
                              >
                                {formatWon(
                                  typeof v === 'number' ? v : null,
                                  true,
                                )}
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {['rev', 'op', 'ocf'].map((m) => (
                  <section className="rounded-xl border bg-white p-3" key={m}>
                    <h3 className="text-xs font-semibold">
                      {financeLabels[m]} · 억원
                    </h3>
                    <div className="mt-3 h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={[...periods].reverse().map((p) => {
                            const row: Record<string, string | number | null> =
                              { period: p };
                            for (const item of selected) {
                              const q = periodRows(item.stock, mode).find(
                                (q) =>
                                  (mode === 'annual'
                                    ? String(q.year)
                                    : `${q.year} ${q.quarter}`) === p,
                              );
                              for (const basis of ['CFS', 'OFS'])
                                row[`${item.stock.code}-${basis}`] =
                                  q?.statement_basis === basis &&
                                  typeof q?.[m] === 'number'
                                    ? (q[m] as number) / 1e8
                                    : null;
                            }
                            return row;
                          })}
                        >
                          <XAxis
                            dataKey="period"
                            tick={{ fontSize: 9 }}
                            minTickGap={50}
                          />
                          <YAxis tick={{ fontSize: 9 }} width={45} />
                          <Tooltip />
                          {selected.flatMap((item, i) =>
                            ['CFS', 'OFS'].map((basis) => (
                              <Line
                                key={`${item.stock.code}-${basis}`}
                                dataKey={`${item.stock.code}-${basis}`}
                                name={`${item.stock.name} · ${basis === 'CFS' ? '연결' : '별도'}`}
                                stroke={
                                  [
                                    '#2563eb',
                                    '#0d9488',
                                    '#d97706',
                                    '#7c3aed',
                                    '#64748b',
                                  ][i]
                                }
                                dot={false}
                                strokeDasharray={
                                  basis === 'OFS' ? '4 3' : undefined
                                }
                                connectNulls={false}
                                isAnimationActive={false}
                              />
                            )),
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </section>
                ))}
              </div>
              <details className="mt-4 rounded-xl border bg-white p-4 text-xs">
                <summary className="cursor-pointer font-semibold">
                  현재 시점 참고 지표 · 시가총액 / PER / PBR / ROE
                </summary>
                <p className="my-3 text-muted-foreground">
                  선택한 과거 기간의 배수가 아닙니다. 각 기업의 최근 시가총액과
                  재무를 사용합니다.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-right">
                    <thead>
                      <tr>
                        <th className="p-2 text-left">기업 · 가격 기준일</th>
                        <th className="p-2">시가총액</th>
                        <th className="p-2">PER</th>
                        <th className="p-2">PBR</th>
                        <th className="p-2">ROE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.map(({ stock }) => (
                        <tr className="border-t" key={stock.code}>
                          <th className="p-2 text-left font-normal">
                            {stock.name}
                            <small className="block text-muted-foreground">
                              {stock.prices.at(-1)?.date || '미확인'}
                              {!stock.financial_parser_version
                                ? ' · 재무 재검증 필요'
                                : ''}
                            </small>
                          </th>
                          <td className="p-2">
                            {formatWon(stock.summary.market_cap_krw, true)}
                          </td>
                          {(['per', 'pbr', 'ttm_roe_pct'] as const).map(
                            (key) => (
                              <td className="p-2" key={key}>
                                {stock.financial_parser_version &&
                                typeof stock.valuation[key] === 'number'
                                  ? `${stock.valuation[key]!.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${key === 'ttm_roe_pct' ? '%' : '배'}`
                                  : '—'}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-muted-foreground">
                  연결 재무의 PER·PBR은 지배주주 순이익·자본 기준, ROE는
                  기초·기말 평균자본 기준입니다. 계정이나 비교 기간이 미확인되면
                  표시하지 않습니다.
                </p>
              </details>
              <section className="mt-5 rounded-xl border bg-white p-4">
                <h2 className="text-sm font-semibold">사업 KPI</h2>
                <p className="my-2 text-xs text-muted-foreground">
                  사용자 입력 최근 관측값 · 단위와 관측 기간은 개별 확인
                </p>
                <div className="overflow-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr>
                        <th className="p-2 text-left">지표</th>
                        {selected.map((item) => (
                          <th key={item.stock.code} className="p-2">
                            {item.stock.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...new Set(
                          selected.flatMap((item) =>
                            item.kpis.map((k) =>
                              JSON.stringify([k.name, k.unit]),
                            ),
                          ),
                        ),
                      ].map((key) => {
                        const [name, unit] = JSON.parse(key);
                        return (
                          <tr key={key} className="border-t">
                            <th className="p-2 text-left">
                              {name} · {unit}
                            </th>
                            {selected.map((item) => {
                              const observation = item.kpis
                                .find((k) => k.name === name && k.unit === unit)
                                ?.observations.at(-1);
                              return (
                                <td className="p-2" key={item.stock.code}>
                                  {observation?.actual?.toLocaleString(
                                    'ko-KR',
                                  ) ?? '—'}
                                  <small className="block text-muted-foreground">
                                    {observation?.period} ·{' '}
                                    {observation?.source_label}
                                  </small>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
