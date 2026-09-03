'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight, FileText, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  formatWon,
  formatMultiple,
  formatPercent,
  type StockDetail,
  type StockEvent,
} from '@/lib/stock-detail';
import {
  displayNumber,
  classifyFiling,
  filterFilings,
  eventCategories,
  eventDate,
  financialMetrics,
  metricValue,
  numberOrNull,
  priceWindow,
  quarterSeries,
  type FinancialMetric,
  type PricePeriod,
  type EventCategory,
  type FilingScope,
} from '@/lib/stock-research';

export function Choices<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-xl bg-muted/70 p-1"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={value === option.value ? 'outline' : 'ghost'}
          aria-pressed={value === option.value}
          className={`text-[11px] ${value === option.value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </fieldset>
  );
}

export function EmptyData({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-40 flex-1 place-items-center rounded-xl border border-dashed p-6 text-center text-xs leading-6 text-muted-foreground">
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {detail && (
        <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}

const priceConfig = {
  close: { label: '종가', color: 'var(--chart-1)' },
  volume: { label: '거래량', color: 'var(--chart-5)' },
};
export function PricePlot({
  stock,
  period,
  volume = false,
}: {
  stock: StockDetail;
  period: PricePeriod;
  volume?: boolean;
}) {
  const prices = priceWindow(stock.prices, period);
  if (!prices.length)
    return <EmptyData>수집된 가격 이력이 없습니다.</EmptyData>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ChartContainer
        config={priceConfig}
        className="min-h-[160px] w-full flex-1 aspect-auto"
        aria-label="원 단위 실제 종가 추이"
      >
        <LineChart
          accessibilityLayer
          data={prices}
          margin={{ top: 14, right: 12, left: 2, bottom: 2 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 5" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => String(value).slice(2)}
            minTickGap={45}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={['auto', 'auto']}
            width={76}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => displayNumber(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => (
                  <span className="font-mono">
                    종가 {displayNumber(value, '원')}
                  </span>
                )}
              />
            }
          />
          <Line
            type="linear"
            dataKey="close"
            stroke="var(--color-close)"
            strokeWidth={2}
            dot={prices.length === 1}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      {volume && (
        <div className="shrink-0 border-t pt-2">
          <p className="pl-3 text-[10px] text-muted-foreground">거래량 · 주</p>
          <ChartContainer
            config={priceConfig}
            className="h-[90px] w-full aspect-auto"
            aria-label="일별 거래량"
          >
            <BarChart
              accessibilityLayer
              data={prices}
              margin={{ top: 8, right: 12, left: 2, bottom: 0 }}
            >
              <XAxis dataKey="date" hide />
              <YAxis
                width={76}
                tickCount={2}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => displayNumber(value)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => (
                      <span>거래량 {displayNumber(value, '주')}</span>
                    )}
                  />
                }
              />
              <Bar
                dataKey="volume"
                fill="var(--color-volume)"
                opacity={0.45}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </div>
      )}
      <p className="shrink-0 px-2 text-[10px] leading-5 text-muted-foreground">
        {prices[0].date} — {prices.at(-1)!.date} · {prices.length}거래일 · 종가
        원 단위 · 일별 수집 자료, 실시간 시세 아님
      </p>
    </div>
  );
}

const periods: { value: PricePeriod; label: string }[] = [
  { value: '1m', label: '1개월' },
  { value: '3m', label: '3개월' },
  { value: '1y', label: '1년' },
  { value: 'all', label: '전체' },
];

export function OverviewPanel({
  stock,
  onFinancials,
}: {
  stock: StockDetail;
  onFinancials: () => void;
}) {
  const [period, setPeriod] = useState<PricePeriod>('3m');
  const v = stock.valuation;
  const last = stock.quarters.at(-1);
  return (
    <div className="flex h-full min-h-[480px] flex-col gap-4">
      <div className="grid shrink-0 grid-cols-2 divide-x rounded-2xl border bg-card sm:grid-cols-4">
        <Stat
          label="시가총액"
          value={formatWon(stock.summary.market_cap_krw, true)}
        />
        <Stat label="PER · 최근 4분기" value={formatMultiple(v.per)} />
        <Stat label="PBR · 최근 자본" value={formatMultiple(v.pbr)} />
        <Stat
          label="ROE · 기말 자본 기준"
          value={displayNumber(v.ttm_roe_pct, '%')}
        />
      </div>
      <section className="flex min-h-[260px] flex-1 flex-col rounded-2xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">가격 추이</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">
              실제 종가 · 원
            </p>
          </div>
          <Choices
            label="가격 조회 기간"
            value={period}
            options={periods}
            onChange={setPeriod}
          />
        </div>
        <PricePlot stock={stock} period={period} />
      </section>
      <section className="shrink-0 overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div>
            <h2 className="text-xs font-semibold">사업과 현금흐름</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">
              최근 4분기 합계 · 재무 기준{' '}
              {last
                ? `${last.year} ${last.quarter}`
                : (stock.source_status.financials?.as_of ?? '미확인')}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onFinancials}>
            {stock.data_level === 'preview'
              ? '등록하고 재무 보강'
              : '재무 펼치기'}{' '}
            <ArrowUpRight />
          </Button>
        </div>
        <div className="grid grid-cols-2 divide-x sm:grid-cols-4">
          <Stat label="매출액" value={formatWon(v.ttm_revenue, true)} />
          <Stat
            label="영업이익"
            value={formatWon(v.ttm_operating_profit, true)}
          />
          <Stat label="순이익" value={formatWon(v.ttm_net_income, true)} />
          <Stat
            label="영업현금흐름"
            value={formatWon(v.ttm_operating_cash_flow, true)}
            detail={
              v.ttm_operating_cash_flow === null
                ? '연속 4분기 확인 필요'
                : undefined
            }
          />
        </div>
      </section>
    </div>
  );
}

export function FinancialPanel({ stock }: { stock: StockDetail }) {
  const [metric, setMetric] = useState<FinancialMetric>('op');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = quarterSeries(stock.quarters).slice(-12);
  const definition = financialMetrics[metric];
  const data = rows.map((q) => ({
    label: `${q.year} ${q.quarter}`,
    value: metricValue(q, metric),
  }));
  const latest = data.at(-1);
  const missing = data.filter((row) => row.value === null).length;
  const config = {
    value: { label: definition.label, color: definition.color },
  };
  return (
    <section className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="shrink-0 border-b p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">재무 추이</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">
              DART · 손익·현금흐름은 단독 분기, 자본·부채는 기말 잔액
            </p>
          </div>
          <Choices
            label="재무 보기 방식"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: '차트' },
              { value: 'table', label: '수치표' },
            ]}
          />
        </div>
        <div className="mt-4">
          <Choices
            label="재무 지표"
            value={metric}
            onChange={setMetric}
            options={Object.entries(financialMetrics).map(([value, def]) => ({
              value: value as FinancialMetric,
              label: def.label,
            }))}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-end justify-between px-5 py-4">
        <div>
          <p className="text-[11px] text-muted-foreground">
            {definition.label} · {latest?.label ?? '기간 미확인'}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {displayNumber(latest?.value)}{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {definition.unit}
            </span>
          </p>
        </div>
        <p
          className={`text-[10px] ${missing ? 'text-amber-700' : 'text-muted-foreground'}`}
        >
          {data.length}분기 중 {missing}분기 미확인
        </p>
      </div>
      {view === 'chart' ? (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">
          {data.some((row) => row.value !== null) ? (
            <ChartContainer
              config={config}
              className="min-h-[160px] w-full flex-1 aspect-auto"
              aria-label={`${definition.label} ${definition.unit} 단위 분기 차트`}
            >
              <LineChart
                accessibilityLayer
                data={data}
                margin={{ top: 12, right: 18, left: 2, bottom: 2 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 5" />
                <ReferenceLine y={0} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tickFormatter={(v) => String(v).slice(2)}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={70}
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => displayNumber(v)}
                />
                <ChartTooltip
                  filterNull={false}
                  content={
                    <ChartTooltipContent
                      formatter={(v) => (
                        <span>
                          {definition.label}{' '}
                          {v == null
                            ? '미확인'
                            : displayNumber(v, definition.unit)}
                        </span>
                      )}
                    />
                  }
                />
                <Line
                  type="linear"
                  dataKey="value"
                  stroke="var(--color-value)"
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 2, fill: 'var(--card)' }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          ) : (
            <EmptyData>
              이 지표의 분기 자료가 없습니다.
              <br />
              미수집 값을 0으로 대체하지 않습니다.
            </EmptyData>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>분기</TableHead>
                {Object.entries(financialMetrics).map(([key, def]) => (
                  <TableHead
                    key={key}
                    className={`text-right text-[10px] ${metric === key ? 'text-primary' : ''}`}
                  >
                    {def.label}
                    <br />
                    {def.unit}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rows].reverse().map((q) => (
                <TableRow key={`${q.year}-${q.quarter}`}>
                  <TableCell className="text-xs font-medium">
                    {q.year} {q.quarter}
                  </TableCell>
                  {Object.keys(financialMetrics).map((key) => (
                    <TableCell
                      key={key}
                      className={`text-right text-xs tabular-nums ${key === metric ? 'bg-primary/5 font-semibold' : ''}`}
                    >
                      {displayNumber(metricValue(q, key as FinancialMetric))}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length && <EmptyData>수집된 재무 자료가 없습니다.</EmptyData>}
        </div>
      )}
      <div className="shrink-0 border-t bg-muted/30 px-5 py-3 text-[10px] leading-5 text-muted-foreground">
        <p>
          금액은 원 자료를 억원으로만 환산합니다. 결측은 — 또는 선의 끊김으로
          표시합니다.
        </p>
        <p>
          4분기 손익은 연간 − 1~3분기. 현금흐름은 누적 차감에 필요한 자료가
          없으면 표시하지 않습니다.
        </p>
      </div>
    </section>
  );
}

export function PricePanel({ stock }: { stock: StockDetail }) {
  const [period, setPeriod] = useState<PricePeriod>('3m');
  const latest = stock.prices.at(-1);
  return (
    <section className="flex h-full min-h-[480px] flex-col rounded-2xl border bg-card p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">가격과 거래량</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            최근 수집일 {latest?.date ?? '미확인'} · 일별 자료
          </p>
        </div>
        <Choices
          label="가격 조회 기간"
          value={period}
          options={periods}
          onChange={setPeriod}
        />
      </div>
      <div className="my-3 grid shrink-0 grid-cols-2 divide-x rounded-xl bg-muted/40 sm:grid-cols-4">
        {[
          ['시가', latest?.open],
          ['고가', latest?.high],
          ['저가', latest?.low],
          ['종가', latest?.close],
        ].map(([label, value]) => (
          <Stat
            key={String(label)}
            label={String(label)}
            value={formatWon(numberOrNull(value))}
          />
        ))}
      </div>
      <PricePlot stock={stock} period={period} volume />
      <div className="mt-3 flex shrink-0 flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-[10px] text-muted-foreground">
        <span>최근 252거래일 고가 {formatWon(stock.summary.high_52w)}</span>
        <span>저가 {formatWon(stock.summary.low_52w)}</span>
        <span>고가 대비 {formatPercent(stock.summary.drawdown_52w_pct)}</span>
      </div>
    </section>
  );
}

export function EventsPanel({
  stock,
  selected,
  onSelect,
  initialScope = 'focus',
}: {
  stock: StockDetail;
  selected: StockEvent | null;
  onSelect: (event: StockEvent) => void;
  initialScope?: 'focus' | 'all';
}) {
  const [category, setCategory] = useState<EventCategory | 'all'>('all');
  const [scope, setScope] = useState<FilingScope>(initialScope);
  const [query, setQuery] = useState('');
  const events = filterFilings(stock.events, scope, category, query);
  const scoped = filterFilings(stock.events, scope, 'all', query);
  const focusCount = filterFilings(stock.events, 'focus').length;
  const unclassifiedCount = filterFilings(stock.events, 'unclassified').length;
  const options = [
    { value: 'all' as const, label: `모든 유형 ${scoped.length}` },
    ...Object.entries(eventCategories)
      .filter(
        ([key]) =>
          key === category ||
          scoped.some((event) => classifyFiling(event).category === key),
      )
      .map(([key, label]) => ({
        value: key as EventCategory,
        label: `${label} ${scoped.filter((event) => classifyFiling(event).category === key).length}`,
      })),
  ];
  return (
    <section className="flex h-full min-h-[400px] flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="shrink-0 border-b p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">공시 살펴보기</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">
              결정·실적·주요 변경부터 · 선택하면 우측에 원문과 확인 사항
            </p>
          </div>
          <Choices
            label="공시 확인 범위"
            value={scope}
            options={[
              { value: 'focus', label: `우선 확인 ${focusCount}` },
              { value: 'all', label: `전체 공시 ${stock.events.length}` },
              ...(unclassifiedCount
                ? [
                    {
                      value: 'unclassified' as const,
                      label: `분류 미확인 ${unclassifiedCount}`,
                    },
                  ]
                : []),
            ]}
            onChange={(value) => {
              setScope(value);
              setCategory('all');
            }}
          />
        </div>
        <Input
          aria-label="공시 제목 검색"
          placeholder="공시 제목 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-3 h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <fieldset
          aria-label="공시 유형"
          className="mt-3 flex max-h-24 flex-wrap gap-1 overflow-y-auto"
        >
          {options.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant="ghost"
              aria-pressed={category === option.value}
              className={`rounded-full text-[11px] ${category === option.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
              onClick={() => setCategory(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </fieldset>
        <div className="mt-3 flex items-start gap-2 text-[10px] leading-5 text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" />
          <p>
            제목 기준 분류 · 원문 중요도 판단 아님. 지분 보고·절차 안내 등은
            전체 공시에서 확인할 수 있습니다.
          </p>
        </div>
      </div>
      <div
        className="flex shrink-0 justify-between border-b bg-muted/25 px-4 py-2 text-[10px] text-muted-foreground"
        aria-live="polite"
      >
        <span>{events.length}건 표시 · 최신순</span>
        <span>정정 포함 · 원문별 표시</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {events.map((event, index) => {
          const classification = classifyFiling(event);
          const isSelected =
            selected === event || !!(event.id && selected?.id === event.id);
          return (
            <Button
              key={event.id ?? `${event.date}-${index}`}
              variant="ghost"
              onClick={() => onSelect(event)}
              aria-pressed={isSelected}
              className={`mb-0.5 h-auto w-full justify-start gap-3 whitespace-normal rounded-xl border px-3 py-2.5 text-left ${isSelected ? 'border-primary/25 bg-primary/5' : 'border-transparent'}`}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <FileText className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                  <time>{eventDate(event.date)}</time>
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {eventCategories[classification.category]}
                  </span>
                  {classification.amendment && (
                    <span className="text-primary">
                      {classification.amendment}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs font-medium leading-5">
                  {event.title || '제목 미확인'}
                </span>
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          );
        })}
        {!events.length && (
          <EmptyData>
            <div>
              <p>
                {stock.events.length
                  ? '이 조건에 맞는 공시가 없습니다.'
                  : '수집 범위 내 공시가 없습니다. 공시가 없다는 뜻은 아닙니다.'}
              </p>
              {!!stock.events.length && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setScope('all');
                    setCategory('all');
                    setQuery('');
                  }}
                >
                  전체 공시 보기
                </Button>
              )}
            </div>
          </EmptyData>
        )}
      </div>
      <p className="shrink-0 border-t px-4 py-2 text-[10px] leading-5 text-muted-foreground">
        {stock.event_scope ?? 'Radar 수집 범위의 계약·자기주식·자금조달 공시'} ·
        수집된 공시이며 향후 일정이 아닙니다.
      </p>
    </section>
  );
}
