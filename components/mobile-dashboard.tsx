'use client';

import { useMemo, useState } from 'react';
import { generalMobileNoteCode } from '@/lib/mobile-note-target';
import { useLocalDraft } from '@/components/draft-recovery';
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ExternalLink,
  FileText,
  Gauge,
  ListChecks,
  MessageSquareText,
  Plus,
  Radar as RadarIcon,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  mobileReviewStateLabels,
  type MobileEvidenceItem,
  type MobileNote,
  type MobileSnapshot,
  type MobileStock,
  type MobileThesis,
} from '@/lib/mobile-dashboard';
import {
  journalKindLabels,
  kpiCategoryLabels,
  learningKindLabels,
  learningStatusLabels,
} from '@/lib/research-system';
import {
  formatMarketCap,
  lensColor,
  lensLabel,
  lenses,
  type Lens,
} from '@/lib/radar-run';
import { questionKinds } from '@/lib/thesis-ai';
import { formatMultiple, formatPercent, formatWon } from '@/lib/stock-detail';

type MobileTab = 'market' | 'radar' | 'watchlist' | 'learning' | 'notes';
type StockTab = 'thesis' | 'financials' | 'events' | 'records';
type MarketHorizon = '1d' | '20d';

const relationLabels = {
  supports: '뒷받침',
  challenges: '약화',
  context: '미확인',
};

const relationTone = {
  supports: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  challenges: 'border-rose-200 bg-rose-50 text-rose-700',
  context: 'border-slate-200 bg-slate-50 text-slate-600',
};

const formatAsset = (value: number | null, unit: string) => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === '%') return `${value.toLocaleString('ko-KR')}%`;
  if (unit === 'KRW') return `₩${value.toLocaleString('ko-KR')}`;
  if (unit === 'USD') return `$${value.toLocaleString('ko-KR')}`;
  return value.toLocaleString('ko-KR');
};

const change = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;

const changeTone = (value: number | null | undefined) =>
  value === null || value === undefined || value === 0
    ? 'text-slate-500'
    : value > 0
      ? 'text-rose-500'
      : 'text-blue-600';

const dateTime = (value: string) =>
  new Date(value).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const numberValue = (value: number | string | null) =>
  typeof value === 'number'
    ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
    : (value ?? '—');

function MiniSparkline({
  points,
}: {
  points?: Array<{ date: string; value: number }>;
}) {
  if (!points || points.length < 2) return <div className="mt-2 h-8" />;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const polyline = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 120;
      const y = 30 - ((point.value - min) / range) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const rising = values.at(-1)! >= values[0];
  return (
    <svg
      viewBox="0 0 120 34"
      className="mt-2 h-8 w-full overflow-visible"
      aria-label="최근 60거래일 흐름"
    >
      <polyline
        fill="none"
        points={polyline}
        stroke={rising ? '#e11d48' : '#2563eb'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EvidenceRow({ item }: { item: MobileEvidenceItem }) {
  return (
    <article className="rounded-2xl border bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          className={`text-[9px] ${relationTone[item.relation]}`}
        >
          {relationLabels[item.relation]}
        </Badge>
        <span className="truncate text-[9px] text-slate-400">
          {item.source}
        </span>
      </div>
      <h4 className="mt-2 text-xs font-semibold leading-5">{item.label}</h4>
      {item.summary && (
        <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">
          {item.summary}
        </p>
      )}
      {item.note && (
        <p className="mt-2 rounded-xl bg-slate-50 p-2 text-[10px] leading-5 text-slate-600">
          {item.note}
        </p>
      )}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary"
        >
          원문 열기 <ExternalLink className="size-3" />
        </a>
      )}
    </article>
  );
}

function ThesisCard({ thesis }: { thesis: MobileThesis }) {
  const counts = thesis.evidence.reduce(
    (result, item) => ({
      ...result,
      [item.relation]: result[item.relation] + 1,
    }),
    { supports: 0, challenges: 0, context: 0 },
  );
  return (
    <section className="rounded-3xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium text-primary">투자포인트</p>
        <Badge variant="secondary" className="text-[9px]">
          {mobileReviewStateLabels[thesis.review.state]}
        </Badge>
      </div>
      <h3 className="mt-2 text-sm font-semibold leading-6">{thesis.title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-700">
        {thesis.body}
      </p>
      {(thesis.timing || thesis.weakens) && (
        <div className="mt-3 grid gap-2 text-[10px] leading-5 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-slate-400">확인 시기</p>
            <p>{thesis.timing || '미정'}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-slate-400">약화 조건</p>
            <p>{thesis.weakens || '미작성'}</p>
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {(
          [
            ['supports', '뒷받침'],
            ['challenges', '약화'],
            ['context', '미확인'],
          ] as const
        ).map(([key, label]) => (
          <div
            key={key}
            className={`rounded-xl border p-2 text-center ${relationTone[key]}`}
          >
            <p className="text-[8px]">{label}</p>
            <p className="mt-0.5 text-xs font-semibold">{counts[key]}</p>
          </div>
        ))}
      </div>
      {thesis.checks.length > 0 && (
        <details className="mt-3 rounded-2xl border p-3">
          <summary className="cursor-pointer text-[11px] font-semibold">
            검증 항목 {thesis.checks.length}개
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-[11px] leading-5 text-slate-600">
            {thesis.checks.map((item, index) => (
              <li key={index}>
                {item}
                {thesis.check_reviews?.[index]?.answer && (
                  <p className="mt-1 whitespace-pre-wrap text-slate-800">
                    확인한 내용: {thesis.check_reviews[index].answer}
                  </p>
                )}
                {thesis.check_reviews?.[index]?.unresolved && (
                  <p className="mt-1 whitespace-pre-wrap">
                    남은 질문: {thesis.check_reviews[index].unresolved}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      {thesis.ai_review && (
        <details className="mt-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-3">
          <summary className="cursor-pointer text-[11px] font-semibold text-violet-950">
            최근 AI 검증 질문 {thesis.ai_review.questions.length}개
          </summary>
          <p className="mt-2 text-[9px] text-violet-700/60">
            {dateTime(thesis.ai_review.created_at)} · 저장 버전{' '}
            {thesis.ai_review.thesis_revision}
          </p>
          <div className="mt-3 space-y-3">
            {thesis.ai_review.questions.map((item, index) => (
              <article key={index} className="rounded-xl bg-white p-3">
                <p className="text-[9px] font-medium text-violet-700">
                  {questionKinds[item.kind]}
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-5">
                  {item.question}
                </p>
                <p className="mt-2 text-[10px] leading-5 text-slate-600">
                  {item.why}
                </p>
                <details className="mt-2 text-[10px] leading-5 text-slate-600">
                  <summary className="cursor-pointer font-medium">
                    확인할 자료·약화 신호
                  </summary>
                  <p className="mt-2">{item.look_for}</p>
                  <p className="mt-1 text-rose-700">{item.weakening_signal}</p>
                </details>
              </article>
            ))}
          </div>
        </details>
      )}
      <details className="mt-3" open={thesis.evidence.length <= 3}>
        <summary className="cursor-pointer text-[11px] font-semibold">
          연결 자료 {thesis.evidence.length}개
        </summary>
        <div className="mt-2 space-y-2">
          {thesis.evidence.map((item) => (
            <EvidenceRow key={`${item.kind}:${item.id}`} item={item} />
          ))}
          {!thesis.evidence.length && (
            <p className="rounded-xl bg-slate-50 p-3 text-[10px] text-slate-500">
              연결 자료가 없습니다.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

function FinancialsView({ stock }: { stock: MobileStock }) {
  const data = stock.quarters.map((quarter) => ({
    label: `${String(quarter.year).slice(-2)}.${quarter.quarter.replace('Q', '')}Q`,
    revenue: quarter.rev ?? null,
    operatingProfit: quarter.op ?? null,
  }));
  const metrics = [
    ['PER', formatMultiple(stock.valuation.per)],
    ['PBR', formatMultiple(stock.valuation.pbr)],
    ['ROE', formatPercent(stock.valuation.ttm_roe_pct)],
    ['부채비율', formatPercent(stock.valuation.debt_ratio_pct)],
    ['TTM 매출', formatWon(stock.valuation.ttm_revenue, true)],
    ['TTM 영업이익', formatWon(stock.valuation.ttm_operating_profit, true)],
  ];
  return (
    <div className="space-y-3">
      <section className="rounded-3xl border bg-white p-4 shadow-sm">
        <h3 className="text-xs font-semibold">주요 지표</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-slate-50 p-3">
              <p className="text-[9px] text-slate-400">{label}</p>
              <p className="mt-1 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">분기 실적</h3>
          <span className="text-[9px] text-slate-400">
            최근 {data.length}개 분기
          </span>
        </div>
        {data.length > 0 ? (
          <>
            <div className="mt-3 h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  margin={{ top: 10, right: 4, left: -18, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 4" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    fontSize={9}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={8}
                    tickFormatter={(value) =>
                      `${Math.round(Number(value) / 100_000_000)}억`
                    }
                  />
                  <RechartsTooltip
                    formatter={(value, name) => [
                      formatWon(Number(value), true),
                      name === 'revenue' ? '매출' : '영업이익',
                    ]}
                    labelStyle={{ fontSize: 11 }}
                    contentStyle={{ borderRadius: 12, fontSize: 10 }}
                  />
                  <Bar dataKey="revenue" fill="#93b4ff" radius={[4, 4, 0, 0]} />
                  <Bar
                    dataKey="operatingProfit"
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex justify-center gap-4 text-[9px] text-slate-500">
              <span className="flex items-center gap-1">
                <i className="size-2 rounded-sm bg-[#93b4ff]" />
                매출
              </span>
              <span className="flex items-center gap-1">
                <i className="size-2 rounded-sm bg-[#2563eb]" />
                영업이익
              </span>
            </div>
          </>
        ) : (
          <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-[10px] text-slate-500">
            게시된 분기 재무가 없습니다.
          </p>
        )}
      </section>
    </div>
  );
}

function EventsView({ stock }: { stock: MobileStock }) {
  return (
    <section className="rounded-3xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <CalendarDays className="size-4 text-primary" /> 공시·일정
        </h3>
        <span className="text-[9px] text-slate-400">
          {stock.events.length}개
        </span>
      </div>
      <div className="mt-3 divide-y">
        {stock.events.map((event, index) => (
          <article
            key={`${event.id ?? event.title}:${index}`}
            className="py-3 first:pt-0 last:pb-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] text-slate-400">
                {event.date ?? '날짜 미확인'}
              </span>
              {event.importance && (
                <Badge variant="outline" className="text-[8px]">
                  {event.importance}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-[11px] font-semibold leading-5">
              {event.title ?? '제목 미확인 공시'}
            </p>
            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[9px] text-primary"
              >
                원문 <ExternalLink className="size-3" />
              </a>
            )}
          </article>
        ))}
        {!stock.events.length && (
          <p className="rounded-2xl bg-slate-50 p-4 text-[10px] text-slate-500">
            게시된 공시·일정이 없습니다.
          </p>
        )}
      </div>
    </section>
  );
}

function RecordsView({ stock }: { stock: MobileStock }) {
  return (
    <div className="space-y-3">
      <section className="rounded-3xl border bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <Gauge className="size-4 text-primary" /> 사업 KPI
        </h3>
        <div className="mt-3 space-y-2">
          {stock.kpis.map((kpi) => {
            const latest = kpi.observations.at(-1);
            return (
              <div key={kpi.id} className="rounded-2xl bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium">{kpi.name}</p>
                    <p className="mt-1 text-[9px] text-slate-400">
                      {kpiCategoryLabels[kpi.category]} ·{' '}
                      {latest?.period ?? '관측 전'}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">
                    {latest?.actual ?? '—'} {kpi.unit}
                  </p>
                </div>
                {latest?.estimate !== null &&
                  latest?.estimate !== undefined && (
                    <p className="mt-2 text-[9px] text-slate-500">
                      기존 예상 {latest.estimate.toLocaleString('ko-KR')}{' '}
                      {kpi.unit}
                    </p>
                  )}
              </div>
            );
          })}
          {!stock.kpis.length && (
            <p className="text-[10px] text-slate-500">등록된 KPI가 없습니다.</p>
          )}
        </div>
      </section>
      <section className="rounded-3xl border bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <ListChecks className="size-4 text-primary" /> 리서치 기록
        </h3>
        <div className="mt-3 space-y-3">
          {stock.journal.slice(0, 10).map((item) => (
            <article
              key={item.id}
              className="border-l-2 border-primary/30 pl-3"
            >
              <div className="flex items-center gap-2 text-[9px] text-slate-400">
                <span>{item.occurred_at}</span>
                <span>·</span>
                <span>{journalKindLabels[item.kind]}</span>
              </div>
              <p className="mt-1 text-[11px] font-semibold">{item.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-slate-600">
                {item.body}
              </p>
              {item.source_url && (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[9px] text-primary"
                >
                  자료 열기 <ExternalLink className="size-3" />
                </a>
              )}
            </article>
          ))}
          {!stock.journal.length && (
            <p className="text-[10px] text-slate-500">
              저장된 기록이 없습니다.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function StockView({
  stock,
  onBack,
}: {
  stock: MobileStock;
  onBack: () => void;
}) {
  const [stockTab, setStockTab] = useState<StockTab>('thesis');
  const tabs = [
    ['thesis', '투자포인트'],
    ['financials', '실적'],
    ['events', '공시·일정'],
    ['records', 'KPI·기록'],
  ] as const;
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-slate-500"
      >
        <ChevronLeft className="size-4" /> 관심종목
      </button>
      <section className="rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 text-slate-950 shadow-[0_12px_32px_rgba(37,99,235,0.10)]">
        <p className="text-[10px] text-slate-500">
          {stock.market} · {stock.sector}
        </p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{stock.name}</h2>
            <p className="mt-1 text-xs text-slate-500">{stock.code}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">
              {formatWon(stock.summary.latest_price)}
            </p>
            <p
              className={`mt-1 text-xs ${changeTone(stock.summary.change_1d_pct)}`}
            >
              {change(stock.summary.change_1d_pct)} ·{' '}
              {stock.summary.price_as_of}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/75 p-2">
            <p className="text-[8px] text-slate-400">PER</p>
            <p className="mt-1 text-xs font-semibold">
              {formatMultiple(stock.valuation.per)}
            </p>
          </div>
          <div className="rounded-xl bg-white/75 p-2">
            <p className="text-[8px] text-slate-400">ROE</p>
            <p className="mt-1 text-xs font-semibold">
              {formatPercent(stock.valuation.ttm_roe_pct)}
            </p>
          </div>
          <div className="rounded-xl bg-white/75 p-2">
            <p className="text-[8px] text-slate-400">52주 위치</p>
            <p className="mt-1 text-xs font-semibold">
              {stock.summary.price_position_52w_pct === null
                ? '—'
                : `${stock.summary.price_position_52w_pct.toFixed(0)}%`}
            </p>
          </div>
        </div>
      </section>
      <nav
        className="grid grid-cols-4 rounded-2xl border bg-white p-1 shadow-sm"
        aria-label="종목 상세 구분"
      >
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStockTab(value)}
            className={`rounded-xl px-1 py-2 text-[9px] ${stockTab === value ? 'bg-primary text-white' : 'text-slate-500'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {stockTab === 'thesis' && (
        <div className="space-y-3">
          {stock.theses.map((thesis) => (
            <ThesisCard key={thesis.id} thesis={thesis} />
          ))}
          {!stock.theses.length && (
            <p className="rounded-3xl border bg-white p-5 text-xs text-slate-500">
              저장된 투자포인트가 없습니다.
            </p>
          )}
        </div>
      )}
      {stockTab === 'financials' && <FinancialsView stock={stock} />}
      {stockTab === 'events' && <EventsView stock={stock} />}
      {stockTab === 'records' && <RecordsView stock={stock} />}
    </div>
  );
}

function MarketView({ snapshot }: { snapshot: MobileSnapshot }) {
  const [horizon, setHorizon] = useState<MarketHorizon>('1d');
  const breadth = snapshot.market.breadth;
  const breadthItems = [
    ['상승 종목', breadth.advancers_pct],
    ['20일선 상회', breadth.above_20d_pct],
    ['60일선 상회', breadth.above_60d_pct],
    ['관측 종목', breadth.coverage_count],
  ] as const;
  return (
    <div className="space-y-3">
      <section className="rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 text-slate-950 shadow-[0_12px_32px_rgba(37,99,235,0.10)]">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-500">
            시장 기준 {snapshot.market.as_of}
          </p>
          <Badge
            variant="outline"
            className="border-blue-200 bg-white/75 text-[9px] text-primary"
          >
            {snapshot.market.status}
          </Badge>
        </div>
        <h2 className="mt-3 text-xl font-semibold">
          {snapshot.market.summary.global_risk_label ?? '시장 상태'}
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm">
            <p className="text-[9px] text-slate-500">한국 시장</p>
            <p className="mt-1 font-semibold">
              {snapshot.market.summary.korea_label ?? '—'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm">
            <p className="text-[9px] text-slate-500">환율·금리</p>
            <p className="mt-1 font-semibold">
              {snapshot.market.summary.fx_pressure_label ?? '—'}
            </p>
          </div>
        </div>
      </section>
      <section className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold">
            <Activity className="size-4 text-primary" /> 한국 시장 내부
          </h2>
          <span className="text-[9px] text-slate-400">실제 비율</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {breadthItems.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-2 text-center">
              <p className="text-[8px] leading-4 text-slate-400">{label}</p>
              <p className="mt-1 text-[11px] font-semibold">
                {value === null || value === undefined
                  ? '—'
                  : label === '관측 종목'
                    ? Number(value).toLocaleString('ko-KR')
                    : `${Number(value).toFixed(1)}%`}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold">
            <BarChart3 className="size-4 text-primary" /> 주요 지표
          </h2>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {(['1d', '20d'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setHorizon(value)}
                className={`rounded-md px-2 py-1 text-[8px] ${horizon === value ? 'bg-white font-semibold text-primary shadow-sm' : 'text-slate-500'}`}
              >
                {value === '1d' ? '1일' : '20일'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {snapshot.market.assets.map((asset) => {
            const movement =
              horizon === '1d' ? asset.change_1d_pct : asset.change_20d_pct;
            return (
              <article key={asset.key} className="rounded-2xl bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[9px] text-slate-500">{asset.label}</p>
                    <p className="mt-1 text-sm font-semibold">
                      {formatAsset(asset.value, asset.unit)}
                    </p>
                  </div>
                  <span
                    className={`mt-0.5 size-1.5 rounded-full ${asset.freshness === 'latest' ? 'bg-emerald-500' : asset.freshness === 'stale' ? 'bg-amber-500' : 'bg-rose-500'}`}
                    title={asset.freshness}
                  />
                </div>
                <p className={`mt-1 text-[10px] ${changeTone(movement)}`}>
                  {change(movement)} · {horizon === '1d' ? '1D' : '20D'}
                </p>
                <MiniSparkline points={asset.sparkline} />
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                  <span
                    className="block h-full rounded-full bg-slate-500"
                    style={{ width: `${asset.position_252d_pct ?? 0}%` }}
                  />
                </div>
                <p className="mt-1 text-[8px] text-slate-400">
                  52주 위치{' '}
                  {asset.position_252d_pct === null ||
                  asset.position_252d_pct === undefined
                    ? '—'
                    : `${asset.position_252d_pct.toFixed(0)}%`}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RadarView({
  snapshot,
  onOpenStock,
}: {
  snapshot: MobileSnapshot;
  onOpenStock: (code: string) => void;
}) {
  const [lens, setLens] = useState<Lens | 'all'>('all');
  const [query, setQuery] = useState('');
  const candidates = snapshot.radar.candidates ?? [];
  const stocks = new Set(snapshot.stocks.map((stock) => stock.code));
  const filtered = candidates.filter(
    (candidate) =>
      (lens === 'all' || candidate.matched_lenses.includes(lens)) &&
      (!query.trim() ||
        `${candidate.name} ${candidate.code} ${candidate.sector}`
          .toLocaleLowerCase('ko-KR')
          .includes(query.trim().toLocaleLowerCase('ko-KR'))),
  );
  return (
    <div className="space-y-3">
      <section className="rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 shadow-[0_12px_32px_rgba(37,99,235,0.10)]">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-500">
            최근 실행 {snapshot.radar.as_of}
          </p>
          <Badge variant="outline" className="bg-white/70 text-[9px]">
            {snapshot.radar.status}
          </Badge>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-2xl font-semibold">
              {snapshot.radar.candidate_count}개
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              평가 {snapshot.radar.universe_count.toLocaleString('ko-KR')}개
            </p>
          </div>
          <RadarIcon className="size-8 text-primary/70" />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          {lenses.map((item) => (
            <div
              key={item.key}
              className="rounded-xl bg-white/75 p-2 text-center"
            >
              <p className="text-[8px] text-slate-400">{item.shortLabel}</p>
              <p className="mt-1 text-xs font-semibold">
                {snapshot.radar.lens_counts[item.key] ?? 0}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-3xl border bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="종목명·코드 검색"
            className="h-9 pl-9 text-[11px]"
          />
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setLens('all')}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[9px] ${lens === 'all' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}
          >
            전체 {candidates.length}
          </button>
          {lenses.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setLens(item.key)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[9px] ${lens === item.key ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}
            >
              {item.label} {snapshot.radar.lens_counts[item.key] ?? 0}
            </button>
          ))}
        </div>
      </section>
      <div className="space-y-2">
        {filtered.map((candidate) => (
          <details
            key={candidate.code}
            className="group rounded-3xl border bg-white p-4 shadow-sm"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{
                        backgroundColor: lensColor[candidate.primary_lens],
                      }}
                    />
                    <p className="text-sm font-semibold">{candidate.name}</p>
                  </div>
                  <p className="mt-1 text-[9px] text-slate-400">
                    {candidate.code} · {candidate.market} · {candidate.sector}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant="secondary" className="text-[8px]">
                    {lensLabel[candidate.primary_lens]}
                  </Badge>
                  <p className="mt-1 text-[9px] text-slate-400">
                    {formatMarketCap(candidate.market_cap_krw)}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {candidate.matched_lenses.map((item) => (
                  <span
                    key={item}
                    className="rounded-md border px-1.5 py-0.5 text-[8px]"
                    style={{ color: lensColor[item] }}
                  >
                    {lensLabel[item]}
                  </span>
                ))}
              </div>
            </summary>
            <div className="mt-4 border-t pt-3">
              <p className="text-[9px] font-medium text-slate-400">포착 근거</p>
              <div className="mt-2 space-y-2">
                {candidate.highlights.map((item, index) => (
                  <div key={index} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-medium">{item.label}</p>
                      <p className="text-[10px] font-semibold">
                        {numberValue(item.value)}
                      </p>
                    </div>
                    <p className="mt-1 text-[9px] leading-4 text-slate-500">
                      {item.comparison} · {item.period}
                    </p>
                  </div>
                ))}
              </div>
              {candidate.contradictions.length > 0 && (
                <details className="mt-2 rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                  <summary className="cursor-pointer text-[9px] font-medium text-amber-900">
                    반대 근거 {candidate.contradictions.length}개
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[9px] leading-4 text-amber-900/80">
                    {candidate.contradictions.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
              {stocks.has(candidate.code) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => onOpenStock(candidate.code)}
                >
                  <Star /> 관심종목 상세
                </Button>
              )}
            </div>
          </details>
        ))}
        {!filtered.length && (
          <p className="rounded-3xl border bg-white p-5 text-xs text-slate-500">
            표시할 Radar 후보가 없습니다. 새 스냅샷을 게시해 주세요.
          </p>
        )}
      </div>
    </div>
  );
}

export function MobileDashboard({
  snapshot,
  initialNotes,
  notesEnabled,
}: {
  snapshot: MobileSnapshot;
  initialNotes: MobileNote[];
  notesEnabled: boolean;
}) {
  const [tab, setTab] = useState<MobileTab>('market');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [notes, setNotes] = useState(initialNotes);
  const [noteCode, setNoteCode] = useState(generalMobileNoteCode);
  const [noteBody, setNoteBody] = useState('');
  const recovery = useLocalDraft(
    'mobile:note',
    { code: noteCode, body: noteBody },
    Boolean(noteBody.trim()),
    (value) => {
      setNoteCode(value.code);
      setNoteBody(value.body);
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(
    () => snapshot.stocks.find((stock) => stock.code === selectedCode) ?? null,
    [snapshot.stocks, selectedCode],
  );
  const submitNote = async () => {
    if (!notesEnabled || !noteCode || !noteBody.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/mobile/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: noteCode, body: noteBody }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || '메모를 저장하지 못했습니다.');
      setNotes((prior) => [result.note, ...prior]);
      recovery.clear();
      setNoteBody('');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openStock = (code: string) => {
    setSelectedCode(code);
    setTab('watchlist');
  };
  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-[#f6f7fb] pb-24 text-slate-950">
      <header className="sticky top-0 z-20 border-b bg-white/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[.18em] text-primary">
              Value Dashboard
            </p>
            <h1 className="mt-0.5 text-base font-semibold">Research Mobile</h1>
          </div>
          <div className="text-right text-[9px] text-slate-400">
            <p>동기화 {dateTime(snapshot.generated_at)}</p>
            <p>{snapshot.stocks.length}개 관심종목</p>
          </div>
        </div>
      </header>
      <div className="p-3">
        {tab === 'market' && <MarketView snapshot={snapshot} />}
        {tab === 'radar' && (
          <RadarView snapshot={snapshot} onOpenStock={openStock} />
        )}
        {tab === 'watchlist' &&
          (selected ? (
            <StockView stock={selected} onBack={() => setSelectedCode(null)} />
          ) : (
            <div className="space-y-2">
              <div className="px-1 py-2">
                <h2 className="text-lg font-semibold">관심종목</h2>
                <p className="mt-1 text-[10px] text-slate-500">
                  투자포인트·실적·공시·기록
                </p>
              </div>
              {snapshot.stocks.map((stock) => (
                <button
                  key={stock.code}
                  type="button"
                  onClick={() => setSelectedCode(stock.code)}
                  className="w-full rounded-3xl border bg-white p-4 text-left shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{stock.name}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {stock.code} · {stock.sector}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {formatWon(stock.summary.latest_price)}
                      </p>
                      <p
                        className={`mt-1 text-[10px] ${changeTone(stock.summary.change_1d_pct)}`}
                      >
                        {change(stock.summary.change_1d_pct)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
                    <Star className="size-3 text-primary" /> 투자포인트{' '}
                    {stock.theses.length} · 분기 {stock.quarters.length} · 공시{' '}
                    {stock.events.length}
                  </div>
                </button>
              ))}
              {!snapshot.stocks.length && (
                <p className="rounded-3xl border bg-white p-5 text-xs text-slate-500">
                  게시된 관심종목이 없습니다.
                </p>
              )}
            </div>
          ))}
        {tab === 'learning' && (
          <div className="space-y-2">
            <div className="px-1 py-2">
              <h2 className="text-lg font-semibold">Learning</h2>
              <p className="mt-1 text-[10px] text-slate-500">
                독서·특강·아티클 기록
              </p>
            </div>
            {snapshot.learning.map((item) => (
              <article
                key={item.id}
                className="rounded-3xl border bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-[9px]">
                    {learningKindLabels[item.kind]}
                  </Badge>
                  <span className="text-[9px] text-slate-400">
                    {learningStatusLabels[item.status]}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
                <p className="mt-1 text-[10px] text-slate-400">{item.author}</p>
                {item.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[8px] text-slate-500"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                {item.summary && (
                  <p className="mt-3 text-[11px] leading-5 text-slate-700">
                    {item.summary}
                  </p>
                )}
                <details
                  className="mt-3 rounded-2xl border p-3"
                  open={item.status === 'reading'}
                >
                  <summary className="cursor-pointer text-[10px] font-semibold">
                    학습 기록 자세히
                  </summary>
                  <div className="mt-3 space-y-2 text-[10px] leading-5">
                    {item.lessons && (
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[9px] text-slate-400">배운 점</p>
                        <p className="mt-1">{item.lessons}</p>
                      </div>
                    )}
                    {item.changed_view && (
                      <div className="rounded-xl bg-blue-50/60 p-3">
                        <p className="text-[9px] text-blue-500">바뀐 관점</p>
                        <p className="mt-1">{item.changed_view}</p>
                      </div>
                    )}
                    {item.applications && (
                      <div className="rounded-xl bg-emerald-50/60 p-3">
                        <p className="text-[9px] text-emerald-600">적용할 점</p>
                        <p className="mt-1">{item.applications}</p>
                      </div>
                    )}
                    {item.disagreements && (
                      <div className="rounded-xl bg-amber-50/60 p-3">
                        <p className="text-[9px] text-amber-600">
                          동의하지 않는 부분
                        </p>
                        <p className="mt-1">{item.disagreements}</p>
                      </div>
                    )}
                    {item.linked_stocks.length > 0 && (
                      <p className="text-slate-500">
                        연결 종목 ·{' '}
                        {item.linked_stocks
                          .map((stock) => stock.name)
                          .join(', ')}
                      </p>
                    )}
                    {item.source_url && (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary"
                      >
                        원문 열기 <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </details>
              </article>
            ))}
            {!snapshot.learning.length && (
              <p className="rounded-3xl border bg-white p-5 text-xs text-slate-500">
                저장된 학습 기록이 없습니다.
              </p>
            )}
          </div>
        )}
        {tab === 'notes' && (
          <div className="space-y-3">
            <section className="rounded-3xl border bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquareText className="size-4 text-primary" /> 메모 ·
                자료 저장
              </h2>
              <p className="mt-1 text-[10px] leading-5 text-slate-500">
                종목 미지정 자료는 Learning에, 종목 메모는 리서치 로그에
                동기화됩니다.
              </p>
              {recovery.banner}
              <select
                value={noteCode}
                onChange={(event) => setNoteCode(event.target.value)}
                className="mt-4 h-10 w-full rounded-xl border bg-white px-3 text-xs"
              >
                <option value={generalMobileNoteCode}>
                  종목 미지정 · Learning에 저장
                </option>
                {snapshot.stocks.map((stock) => (
                  <option key={stock.code} value={stock.code}>
                    {stock.name} · {stock.code}
                  </option>
                ))}
              </select>
              <Textarea
                value={noteBody}
                maxLength={2000}
                onChange={(event) => setNoteBody(event.target.value)}
                className="mt-2 min-h-28"
                placeholder="기사·리포트 링크와 메모를 붙여넣으세요."
              />
              <Button
                className="mt-2 w-full"
                disabled={
                  !notesEnabled || busy || !noteCode || !noteBody.trim()
                }
                onClick={() => void submitNote()}
              >
                {busy ? <RefreshCw className="animate-spin" /> : <Plus />} 메모
                저장
              </Button>
              {!notesEnabled && (
                <p className="mt-2 text-[9px] text-slate-400">
                  로컬 미리보기에서는 원격 메모 저장을 사용하지 않습니다.
                </p>
              )}
              {error && (
                <p className="mt-2 text-[10px] text-destructive">{error}</p>
              )}
            </section>
            <section className="space-y-2">
              {notes.map((note) => {
                const stock = snapshot.stocks.find(
                  (item) => item.code === note.code,
                );
                return (
                  <article
                    key={note.id}
                    className="rounded-2xl border bg-white p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold">
                        {note.code === generalMobileNoteCode
                          ? '저장 자료'
                          : (stock?.name ?? note.code)}
                      </p>
                      <span className="text-[9px] text-slate-400">
                        {dateTime(note.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-700">
                      {note.body}
                    </p>
                    {note.consumed_at && (
                      <p className="mt-2 text-[9px] text-emerald-600">
                        PC 반영 완료
                      </p>
                    )}
                  </article>
                );
              })}
              {!notes.length && (
                <p className="rounded-2xl border bg-white p-4 text-[11px] text-slate-500">
                  아직 모바일 메모가 없습니다.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-lg grid-cols-5 border-t bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),.5rem)] pt-2 backdrop-blur">
        {(
          [
            ['market', 'Markets', BarChart3],
            ['radar', 'Radar', RadarIcon],
            ['watchlist', '관심종목', Star],
            ['learning', 'Learning', BookOpen],
            ['notes', '메모', FileText],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value);
              if (value !== 'watchlist') setSelectedCode(null);
            }}
            className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-[8px] ${tab === value ? 'font-semibold text-primary' : 'text-slate-400'}`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
    </main>
  );
}
