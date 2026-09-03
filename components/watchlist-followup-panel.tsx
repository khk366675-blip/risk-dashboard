'use client';
import Link from 'next/link';
import { Line, LineChart, Bar, BarChart, XAxis, YAxis } from 'recharts';
import { Check, ExternalLink, RefreshCw, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { type FollowupItem, sourceStateLabels } from '@/lib/research-followup';
import {
  classifyFiling,
  eventCategories,
  eventDate,
  safeSourceUrl,
  displayNumber,
} from '@/lib/stock-research';
import { formatWon, formatPercent } from '@/lib/stock-detail';
import { researchStateLabel } from '@/lib/watchlist';

export function checkedDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value)))
    return '아직 확인하지 않음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
const priceConfig = {
  close: { label: '종가', color: 'var(--chart-1)' },
  volume: { label: '거래량', color: 'var(--chart-5)' },
};
export function WatchlistFollowupPanel({
  item,
  busy,
  onAction,
}: {
  item: FollowupItem;
  busy: boolean;
  onAction: (action: 'review' | 'refresh' | 'retry') => void;
}) {
  const running = ['queued', 'running'].includes(item.job?.state ?? '');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b p-5">
        <p className="text-[10px] font-medium tracking-wider text-primary">
          FOLLOW-UP
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{item.name}</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {item.code} · 마지막 확인 {checkedDate(item.checked_at)}
            </p>
          </div>
          <Link
            href={`/stocks/${item.code}`}
            className="rounded-lg border px-2.5 py-2 text-[11px] hover:bg-muted"
          >
            상세 검토 ↗
          </Link>
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={busy || !item.canReview}
            onClick={() => onAction('review')}
          >
            <Check />
            현재 자료 확인
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || running}
            onClick={() => onAction('refresh')}
          >
            <RefreshCw className={running ? 'animate-spin' : ''} />
            자료 갱신
          </Button>
        </div>
        <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
          확인 버튼을 누르면 지금 자료를 다음 비교 기준으로 저장합니다.
          열람만으로 확인 처리하지 않습니다.
        </p>
        {item.job && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            {running && <LoaderCircle className="size-3 animate-spin" />}
            <span>
              {researchStateLabel[item.job.state]} · {item.job.step}
            </span>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">실제 가격 · 거래량</h3>
            <Link
              href={`/stocks/${item.code}?tab=price`}
              className="text-[10px] text-primary"
            >
              차트 펼치기 ↗
            </Link>
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums">
            {formatWon(item.price.close)}{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {formatPercent(item.price.change1d)}
            </span>
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {item.price.date ?? '기준일 미확인'} · 전 거래일 대비 · 실시간 시세
            아님
          </p>
          {item.price.series.length ? (
            <>
              <ChartContainer
                config={priceConfig}
                className="mt-3 h-32 w-full aspect-auto"
                aria-label="최근 거래일 실제 종가, 원 단위"
              >
                <LineChart
                  accessibilityLayer
                  data={item.price.series}
                  margin={{ left: 0, right: 6, top: 8, bottom: 0 }}
                >
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => String(v).slice(5)}
                    minTickGap={40}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    width={58}
                    tickCount={3}
                    tickFormatter={(v) => displayNumber(v)}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(v) => (
                          <span>종가 {displayNumber(v, '원')}</span>
                        )}
                      />
                    }
                  />
                  <Line
                    dataKey="close"
                    type="linear"
                    stroke="var(--color-close)"
                    strokeWidth={2}
                    dot={item.price.series.length === 1}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
              <p className="mt-2 text-[10px] text-muted-foreground">
                거래량 · 주
              </p>
              <ChartContainer
                config={priceConfig}
                className="h-20 w-full aspect-auto"
                aria-label="최근 거래일 실제 거래량, 주 단위"
              >
                <BarChart
                  accessibilityLayer
                  data={item.price.series}
                  margin={{ left: 0, right: 6, top: 4, bottom: 0 }}
                >
                  <XAxis dataKey="date" hide />
                  <YAxis
                    width={58}
                    tickCount={2}
                    tickFormatter={(v) => displayNumber(v)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(v) => (
                          <span>거래량 {displayNumber(v, '주')}</span>
                        )}
                      />
                    }
                  />
                  <Bar
                    dataKey="volume"
                    fill="var(--color-volume)"
                    opacity={0.6}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {item.price.series[0].date} — {item.price.series.at(-1)!.date}
              </p>
            </>
          ) : (
            <p className="py-5 text-xs text-muted-foreground">
              수집된 가격 이력이 없습니다.
            </p>
          )}
          <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-[11px]">
            {item.price.baseline ? (
              <>
                확인 기준 {formatWon(item.price.baseline.close)} →{' '}
                {formatWon(item.price.close)}
                <span className="ml-2 font-medium">
                  {formatPercent(item.price.sinceReview)}
                </span>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  기준 거래일 {item.price.baseline.date} · 수정주가·기업행동
                  영향은 원문 확인 필요
                </p>
              </>
            ) : (
              '첫 확인 후부터 확인 시점 대비 가격 변화를 표시합니다.'
            )}
          </div>
        </section>
        <section className="border-t pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">분기 실적</h3>
            <Link
              href={`/stocks/${item.code}?tab=financials`}
              className="text-[10px] text-primary"
            >
              재무 펼치기 ↗
            </Link>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {item.financials.latest
              ? `${item.financials.latest.year} ${item.financials.latest.quarter}`
              : '분기 미확인'}{' '}
            ·{' '}
            {item.financials.latest?.statement_basis === 'CFS'
              ? '연결'
              : item.financials.latest?.statement_basis === 'OFS'
                ? '별도'
                : '기준 미확인'}
          </p>
          {!!item.financials.changes.length && (
            <p className="mt-2 text-[10px] text-primary">
              {item.financials.changes
                .map((c) => `${c.period} ${c.kind === 'new' ? '추가' : '수정'}`)
                .join(' · ')}
            </p>
          )}
          <div className="mt-3 divide-y">
            {item.financials.metrics.map((metric) => (
              <div
                key={metric.key}
                className="flex items-center justify-between gap-3 py-2 text-[11px]"
              >
                <span className="text-muted-foreground">{metric.label}</span>
                <span className="text-right tabular-nums">
                  {formatWon(metric.value, true)}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {metric.yoy !== null
                      ? `${formatPercent(metric.yoy)} YoY`
                      : '증감률 —'}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            동일 회계 기준 전년 동기 비교. 비교 자료가 없거나 전년 값이
            0·음수이면 증감률을 표시하지 않습니다.
          </p>
        </section>
        <section className="border-t pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">
              {item.filings.newCount === null
                ? '첫 확인 · 최근 공시'
                : `추가 수집 공시 ${item.filings.newCount}건`}
            </h3>
            <Link
              href={`/stocks/${item.code}?tab=events&scope=all`}
              className="text-[10px] text-primary"
            >
              공시 펼치기 ↗
            </Link>
          </div>
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            {item.filings.newCount === null
              ? `기존 수집 ${item.filings.total}건. 과거 자료를 새 공시로 세지 않습니다.`
              : `공시 확인 ${checkedDate(item.filings.checked_at)} 이후 · 제목 기준 우선 확인 ${item.filings.focusCount}건. 과거 공시 추가 수집도 포함.`}
          </p>
          <div className="mt-3 divide-y">
            {item.filings.preview.map((event, index) => {
              const url = safeSourceUrl(event.url);
              const classification = classifyFiling(event);
              return (
                <div key={event.id ?? index} className="py-3">
                  <p className="text-[10px] text-muted-foreground">
                    {eventDate(event.date)} ·{' '}
                    {eventCategories[classification.category]}
                    {classification.amendment &&
                      ` · ${classification.amendment}`}
                  </p>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-[11px] leading-5 hover:text-primary"
                    >
                      {event.title ?? '제목 미확인'}{' '}
                      <ExternalLink className="inline size-3" />
                    </a>
                  ) : (
                    <p className="mt-1 text-[11px]">
                      {event.title ?? '제목 미확인'} · 원문 링크 없음
                    </p>
                  )}
                </div>
              );
            })}
            {!item.filings.preview.length && (
              <p className="py-3 text-[11px] text-muted-foreground">
                {item.filings.newCount === 0
                  ? '현재 수집 자료에서 추가된 공시는 없습니다.'
                  : '수집된 공시가 없습니다.'}
              </p>
            )}
          </div>
          <p className="text-[10px] leading-5 text-muted-foreground">
            {item.filings.scope}
          </p>
        </section>
        <section className="border-t pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">자료 상태 · 출처</h3>
            {['error', 'partial'].includes(item.job?.state ?? '') && (
              <Button
                size="xs"
                variant="outline"
                disabled={busy || running}
                onClick={() => onAction('retry')}
              >
                실패 항목 재시도
              </Button>
            )}
          </div>
          <div className="mt-3 space-y-3">
            {item.sources.map((source) => (
              <div
                key={source.key}
                className="rounded-xl border p-3 text-[10px] leading-5"
              >
                <p className="flex justify-between gap-2">
                  <span className="font-semibold">{source.label}</span>
                  <span
                    className={
                      source.status !== 'ok' || source.stale
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-primary'
                    }
                  >
                    {sourceStateLabels[source.status] ?? '상태 미확인'}
                    {source.stale ? ' · 갱신 확인 필요' : ''}
                  </span>
                </p>
                <p className="mt-1 text-muted-foreground">
                  {source.source}
                  <br />
                  기준 {source.as_of ?? '미확인'} · 수집{' '}
                  {source.collected_at
                    ? checkedDate(source.collected_at)
                    : '시점 미확인'}
                </p>
                {source.warning && (
                  <p className="mt-1 text-muted-foreground">{source.warning}</p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
            수집 완료는 실시간 데이터라는 뜻이 아닙니다. 오래됐거나 실패한
            자료는 갱신이 필요합니다. 실패한 항목은 확인 기준을 바꾸지 않습니다.
          </p>
        </section>
      </div>
    </div>
  );
}
