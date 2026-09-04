import type { StockDetail, StockEvent, StockQuarter } from './stock-detail';
import type { ResearchRecord } from './watchlist';
import {
  classifyFiling,
  filterFilings,
  numberOrNull,
} from './stock-research.ts';

export type ReviewBaseline = {
  checked_at: string;
  events: { checked_at: string; keys: string[] } | null;
  financials: { checked_at: string; quarters: Record<string, string> } | null;
  price: { checked_at: string; date: string; close: number } | null;
};
export type FollowupConfig = {
  followup_stale_hours: number;
  followup_price_points: number;
  followup_event_preview_limit: number;
};
const sourceLabels = {
  prices: '가격',
  financials: '재무',
  dart_events: '공시',
} as const;
export const sourceStateLabels: Record<string, string> = {
  ok: '수집 완료',
  partial: '일부 미확인',
  error: '수집 실패',
  missing: '자료 없음',
  stale: '이전 자료',
};
export const quarterKey = (q: StockQuarter) => `${q.year} ${q.quarter}`;
const quarterSerial = (q: StockQuarter) => q.year * 4 + Number(q.quarter[0]);
const validQuarters = (stock: StockDetail) =>
  stock.quarters
    .filter((q) => Number.isInteger(q.year) && /^[1-4]Q$/.test(q.quarter))
    .sort((a, b) => quarterSerial(a) - quarterSerial(b));
const eventKey = (event: StockEvent) =>
  event.id || event.url || JSON.stringify([event.date, event.title]);
// Do not include collection timestamps: fetching unchanged data is not a revision.
function quarterSignature(q: StockQuarter) {
  return JSON.stringify([
    q.statement_basis ?? null,
    q.receipt_no ?? null,
    ...[q.rev, q.op, q.ni, q.ocf, q.equity, q.debt].map(numberOrNull),
  ]);
}
function sourceUsable(stock: StockDetail, key: string) {
  return (
    stock.data_level === 'research' &&
    ['ok', 'partial'].includes(stock.source_status[key]?.status ?? '')
  );
}
export function checkpointFor(
  stock: StockDetail,
  previous: ReviewBaseline | null,
  now: string,
): ReviewBaseline {
  const quarters = validQuarters(stock);
  const latest = [...stock.prices]
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  return {
    checked_at: now,
    events: sourceUsable(stock, 'dart_events')
      ? {
          checked_at: now,
          // Keep previously seen receipt IDs even when the collection window rolls forward.
          keys: [
            ...new Set([
              ...(previous?.events?.keys ?? []),
              ...stock.events.map(eventKey),
            ]),
          ],
        }
      : (previous?.events ?? null),
    financials:
      sourceUsable(stock, 'financials') && quarters.length
        ? {
            checked_at: now,
            quarters: {
              ...previous?.financials?.quarters,
              ...Object.fromEntries(
                quarters.map((q) => [quarterKey(q), quarterSignature(q)]),
              ),
            },
          }
        : (previous?.financials ?? null),
    price:
      sourceUsable(stock, 'prices') &&
      latest &&
      numberOrNull(latest.close) !== null &&
      latest.close > 0
        ? { checked_at: now, date: latest.date, close: latest.close }
        : (previous?.price ?? null),
  };
}

export function buildFollowup(
  record: ResearchRecord,
  baseline: ReviewBaseline | null,
  revision: string,
  config: FollowupConfig,
  now = Date.now(),
) {
  const { stock, item } = record;
  const sources = Object.entries(sourceLabels).map(([key, label]) => {
    const source = stock.source_status[key];
    const timestamp = Date.parse(source?.collected_at ?? '');
    const stale =
      !Number.isFinite(timestamp) ||
      timestamp > now ||
      now - timestamp > config.followup_stale_hours * 3_600_000;
    return {
      key,
      label,
      status: source?.status ?? 'missing',
      stale,
      as_of: source?.as_of ?? null,
      collected_at: source?.collected_at ?? null,
      source: source?.source ?? '출처 미확인',
      warning: source?.warning ?? null,
      run_id: source?.run_id ?? null,
    };
  });
  const seen = new Set(baseline?.events?.keys ?? []);
  const additions = baseline?.events
    ? stock.events.filter((e) => !seen.has(eventKey(e)))
    : [];
  const focus = additions.filter((e) => classifyFiling(e).priority === 'focus');
  const quarters = validQuarters(stock);
  const changes = baseline?.financials
    ? quarters.flatMap((q) => {
        const before = baseline.financials!.quarters[quarterKey(q)];
        return before === quarterSignature(q)
          ? []
          : [
              {
                period: quarterKey(q),
                kind:
                  before === undefined
                    ? ('new' as const)
                    : ('revised' as const),
              },
            ];
      })
    : [];
  const latestQuarter = quarters.at(-1) ?? null;
  const previousQuarter = latestQuarter
    ? quarters.find(
        (q) =>
          q.year === latestQuarter.year - 1 &&
          q.quarter === latestQuarter.quarter,
      )
    : null;
  const financialMetrics = (['rev', 'op', 'ocf'] as const).map((key) => {
    const value = numberOrNull(latestQuarter?.[key]);
    const comparable =
      !!latestQuarter?.statement_basis &&
      latestQuarter.statement_basis === previousQuarter?.statement_basis;
    const previous = comparable ? numberOrNull(previousQuarter?.[key]) : null;
    return {
      key,
      label:
        key === 'rev' ? '매출액' : key === 'op' ? '영업이익' : '영업현금흐름',
      value,
      previous,
      yoy:
        value !== null && previous !== null && previous > 0
          ? (value / previous - 1) * 100
          : null,
    };
  });
  const prices = [...stock.prices].sort((a, b) => a.date.localeCompare(b.date));
  const latest = prices.at(-1);
  const prior = prices.at(-2);
  const close = numberOrNull(latest?.close);
  const previousClose = numberOrNull(prior?.close);
  const sinceReview =
    close !== null &&
    baseline?.price &&
    latest &&
    latest.date >= baseline.price.date
      ? (close / baseline.price.close - 1) * 100
      : null;
  const firstSections = [
    !baseline?.events && '공시',
    !baseline?.financials && '재무',
    !baseline?.price && '가격',
  ].filter(Boolean) as string[];
  const running = ['queued', 'running'].includes(item.job?.state ?? '');
  const canReview =
    !running &&
    sources.some((s) => sourceUsable(stock, s.key)) &&
    (stock.events.length > 0 ||
      stock.quarters.length > 0 ||
      stock.prices.length > 0);
  return {
    ...item,
    discovery: stock.radar?.discovery ?? 'radar',
    revision,
    checked_at: baseline?.checked_at ?? null,
    firstSections,
    canReview,
    needsAttention:
      sources.some((s) => s.status !== 'ok' || s.stale) ||
      ['error', 'partial'].includes(item.job?.state ?? ''),
    hasChanges: additions.length > 0 || changes.length > 0,
    sources,
    filings: {
      total: stock.events.length,
      newCount: baseline?.events ? additions.length : null,
      focusCount: baseline?.events ? focus.length : null,
      checked_at: baseline?.events?.checked_at ?? null,
      preview: filterFilings(
        baseline?.events ? additions : stock.events,
        'all',
      ).slice(0, config.followup_event_preview_limit),
      scope: stock.event_scope ?? '조회 범위 미확인',
    },
    financials: {
      latest: latestQuarter,
      changes,
      metrics: financialMetrics,
      checked_at: baseline?.financials?.checked_at ?? null,
      previousPeriod: previousQuarter ? quarterKey(previousQuarter) : null,
    },
    price: {
      close,
      date: latest?.date ?? null,
      volume: numberOrNull(latest?.volume),
      change1d:
        close !== null && previousClose !== null && previousClose > 0
          ? (close / previousClose - 1) * 100
          : null,
      sinceReview,
      baseline: baseline?.price ?? null,
      series: prices.slice(-config.followup_price_points).map((p) => ({
        date: p.date,
        close: numberOrNull(p.close),
        volume: numberOrNull(p.volume),
      })),
    },
  };
}
export type FollowupItem = ReturnType<typeof buildFollowup>;

export type StockDetailTab =
  | 'thesis'
  | 'research'
  | 'kpis'
  | 'journal'
  | 'overview'
  | 'financials'
  | 'price'
  | 'events'
  | 'documents';
export function parseDetailTab(value: unknown): StockDetailTab {
  return value === 'thesis' ||
    value === 'research' ||
    value === 'kpis' ||
    value === 'journal' ||
    value === 'financials' ||
    value === 'price' ||
    value === 'events' ||
    value === 'documents'
    ? value
    : 'overview';
}
