'use client';
import { runDashboardJob } from '@/lib/dashboard-jobs-client';
import { useActionConfirmation } from '@/components/use-action-confirmation';
import { PrimaryNavigation } from '@/components/primary-navigation';

import Link from 'next/link';
import { useEffect, useRef, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Gauge,
  Globe2,
  LineChart as LineChartIcon,
  Radar,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  assetChangeValue,
  formatAssetChange,
  formatAssetValue,
  marketGroups,
  marketSnapshot,
  rawChangeTone,
  type ChangeHorizon,
  type MarketAsset,
  type MarketGroup,
  type MarketSnapshot,
} from '@/lib/market-snapshot';

const chartConfig = {
  value: { label: '관측값', color: '#2f6fed' },
} satisfies ChartConfig;
type ChartPeriod = '1d' | '1m' | '3m' | '1y';
const chartPeriods: Array<{
  key: ChartPeriod;
  label: string;
  observations: number;
  change: ChangeHorizon;
}> = [
  { key: '1d', label: '최근일', observations: 1, change: '1d' },
  { key: '1m', label: '1개월', observations: 20, change: '20d' },
  { key: '3m', label: '3개월', observations: 60, change: '60d' },
  { key: '1y', label: '1년', observations: 252, change: '252d' },
];
const assetColors: Record<string, string> = {
  sp500: '#2563eb',
  nasdaq: '#7c3aed',
  vix: '#e11d48',
  kospi: '#2563eb',
  kosdaq: '#8b5cf6',
  usdkrw: '#d97706',
  dxy: '#64748b',
  us10y: '#e11d48',
  gold: '#ca8a04',
  silver: '#64748b',
  wti: '#059669',
};

const assetNotes: Record<string, { role: string; watch: string }> = {
  sp500: {
    role: '미국 대형주 위험선호의 대표 벤치마크',
    watch: '이익 전망과 장기금리 변화가 함께 움직이는지 확인',
  },
  nasdaq: {
    role: '성장주·기술주 민감도를 보여주는 벤치마크',
    watch: 'S&P 500 대비 상대강도와 금리 방향을 함께 확인',
  },
  vix: {
    role: '미국 주식 옵션시장의 단기 기대 변동성',
    watch: '절대 수준과 주가지수 하락의 동시 발생 여부를 확인',
  },
  kospi: {
    role: '한국 대형주 중심 시장 벤치마크',
    watch: '지수 상승이 시장 내부 확산과 동행하는지 확인',
  },
  kosdaq: {
    role: '한국 중소형 성장주 민감도를 보여주는 지수',
    watch: 'KOSPI 대비 상대 방향과 거래 확산을 확인',
  },
  usdkrw: {
    role: '원화의 달러 대비 가격과 외환 압력',
    watch: '달러지수·미국 금리와 같은 방향인지 확인',
  },
  dxy: {
    role: '주요 통화 대비 달러 강도를 나타내는 지수',
    watch: '원/달러와 신흥시장 위험선호에 미치는 압력을 확인',
  },
  us10y: {
    role: '글로벌 자산 가격의 핵심 장기 할인율',
    watch: '주가·달러 상승과 동시에 오를 때 부담의 성격을 확인',
  },
  gold: {
    role: '실질금리·달러·안전자산 수요에 민감한 자산',
    watch: '달러·금리와의 관계가 평소와 달라졌는지 확인',
  },
  silver: {
    role: '귀금속과 산업 수요 성격이 함께 있는 자산',
    watch: '금 대비 상대강도와 경기 민감 자산의 동행을 확인',
  },
  wti: {
    role: '글로벌 원유 수급과 물가 압력을 반영하는 벤치마크',
    watch: '단기 급등이 기대수요인지 공급 충격인지 구분',
  },
};

export function MarketsWorkspace({
  initialSnapshot = marketSnapshot,
  radarCount,
}: {
  initialSnapshot?: MarketSnapshot;
  radarCount: number;
}) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(initialSnapshot);
  const jobRequest = useRef<AbortController | null>(null);
  useEffect(() => () => jobRequest.current?.abort(), []);
  const [selectedKey, setSelectedKey] = useState(snapshot.assets[0]?.key ?? '');
  const [selectedGroup, setSelectedGroup] =
    useState<MarketGroup>('global_equity');
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('1m');
  const [query, setQuery] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const selected =
    snapshot.assets.find((asset) => asset.key === selectedKey) ??
    snapshot.assets[0];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ko-KR');
    return snapshot.assets.filter(
      (asset) =>
        !normalized ||
        `${asset.label} ${asset.symbol}`
          .toLocaleLowerCase('ko-KR')
          .includes(normalized),
    );
  }, [query, snapshot.assets]);
  const latestCount = snapshot.assets.filter(
    (asset) => asset.freshness === 'latest',
  ).length;
  const chartPeriodSpec =
    chartPeriods.find((item) => item.key === chartPeriod) ?? chartPeriods[1];
  const selectAsset = (key: string) => {
    setSelectedKey(key);
    const asset = snapshot.assets.find((item) => item.key === key);
    if (asset) setSelectedGroup(asset.group);
  };

  const refreshMarkets = async () => {
    if (refreshing) return;
    if (
      !(await confirmAction({
        title: '시장 데이터를 갱신할까요?',
        description:
          'Markets의 지수·환율·금리 등 최신 데이터를 수집합니다. 개인 리서치는 변경하지 않습니다.',
        actionLabel: '데이터 갱신',
      }))
    )
      return;
    setRefreshing(true);
    setRefreshError(null);
    setRefreshMessage(null);
    setStatusOpen(true);
    try {
      jobRequest.current?.abort();
      jobRequest.current = new AbortController();
      const payload = {
        snapshot: (await runDashboardJob(
          'markets',
          jobRequest.current.signal,
        )) as MarketSnapshot,
      };
      setSnapshot(payload.snapshot);
      const latest = payload.snapshot.assets.filter(
        (asset) => asset.freshness === 'latest',
      ).length;
      setRefreshMessage(
        `${latest}/${payload.snapshot.assets.length}개 지표를 최신 상태로 확인했습니다.`,
      );
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : '시장 데이터 갱신 중 오류가 발생했습니다.',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const { confirmAction, confirmationDialog } = useActionConfirmation();
  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      {confirmationDialog}
      <div className="mx-auto grid h-full max-w-[1800px] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
        <MarketsNav snapshot={snapshot} radarCount={radarCount} />
        <main className="flex min-w-0 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-white/90 px-5 backdrop-blur-xl">
            <Link
              href="/radar"
              aria-label="Radar로 이동"
              className="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-slate-100 hover:text-foreground md:hidden"
            >
              <Radar className="size-4" />
            </Link>
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="지표·심볼 검색"
                className="h-8 w-full rounded-xl border bg-white pl-9 pr-3 text-xs outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
              />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <div className="ml-1 grid size-8 place-items-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                KH
              </div>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 pt-4 lg:overflow-hidden xl:px-6">
            <div className="flex shrink-0 flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <span>Research</span>
                  <ChevronRight className="size-3" />
                  <span className="text-foreground">Markets</span>
                </div>
                <h1 className="text-xl font-semibold tracking-[-0.04em] sm:text-[25px]">
                  Markets
                </h1>
              </div>
              <Button
                variant="outline"
                className="h-9 w-full rounded-xl sm:w-auto"
                onClick={refreshMarkets}
                disabled={refreshing}
              >
                <RefreshCw
                  className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />{' '}
                {refreshing ? '전체 갱신 중' : '전체 데이터 갱신'}
              </Button>
            </div>
            <SummaryStrip snapshot={snapshot} latestCount={latestCount} />
            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
              <MarketVisualBoard
                assets={filtered}
                selectedKey={selected?.key ?? ''}
                selectedGroup={selectedGroup}
                period={chartPeriod}
                onPeriodChange={setChartPeriod}
                onGroupChange={setSelectedGroup}
                onSelect={selectAsset}
              />
              <ContextPanel asset={selected} period={chartPeriodSpec} />
            </div>
          </div>
        </main>
      </div>
      <StatusSheet
        snapshot={snapshot}
        open={statusOpen}
        onOpenChange={setStatusOpen}
        refreshing={refreshing}
        refreshMessage={refreshMessage}
        refreshError={refreshError}
        onRefresh={refreshMarkets}
      />
    </div>
  );
}

function MarketsNav({
  snapshot,
  radarCount,
}: {
  snapshot: MarketSnapshot;
  radarCount: number;
}) {
  return (
    <aside className="hidden h-full flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 md:flex">
      <div className="flex items-center gap-3 px-2 pb-7">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-white shadow-[0_8px_24px_rgba(35,79,194,0.22)]">
          V
        </div>
        <div>
          <p className="text-sm font-semibold tracking-[-0.02em]">
            Value Dashboard
          </p>
          <p className="text-[11px] text-muted-foreground">
            Research workspace
          </p>
        </div>
      </div>
      <PrimaryNavigation active={'markets'} radarCount={radarCount} />
      <div className="mt-auto space-y-2">
        <MobileSyncControls />
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">시장 데이터</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-800">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {snapshot.status === 'ok' ? '정상' : '부분'}
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-emerald-950/70">
            {
              snapshot.assets.filter((asset) => asset.freshness === 'latest')
                .length
            }
            /{snapshot.assets.length} 최신 · 한국 breadth{' '}
            {snapshot.breadth.coverage_count.toLocaleString('ko-KR')}종목
          </p>
        </div>
      </div>
    </aside>
  );
}

function MobileSyncControls() {
  const { confirmAction, confirmationDialog } = useActionConfirmation();
  const [running, setRunning] = useState<'publish' | 'sync' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const run = async (action: 'publish' | 'sync') => {
    if (running) return;
    if (
      !(await confirmAction({
        title:
          action === 'publish'
            ? '모바일에 게시할까요?'
            : '모바일과 동기화할까요?',
        description:
          action === 'publish'
            ? '현재 Radar·시장 데이터·관심종목·리서치·Learning 기록을 원격 저장소에 전송해 모바일 게시본을 갱신합니다.'
            : '모바일 메모를 이 PC에 가져온 뒤, 최신 로컬 자료를 원격 저장소에 게시합니다.',
        actionLabel: action === 'publish' ? '게시' : '동기화',
      }))
    )
      return;
    setRunning(action);
    setMessage(null);
    setFailed(false);
    try {
      const response = await fetch('/api/mobile/local-sync', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        pulled?: { imported_count: number; skipped_count: number } | null;
        published?: {
          watchlist_count: number;
          generated_at: string;
          radar_count: number;
          radar_as_of: string;
        };
      };
      if (!response.ok || !result.ok || !result.published)
        throw new Error(result.error || '모바일 작업을 완료하지 못했습니다.');
      setMessage(
        action === 'sync'
          ? `메모 ${result.pulled?.imported_count ?? 0}개 반영 · ${result.published.watchlist_count}개 게시`
          : `Radar ${result.published.radar_count}개 (${result.published.radar_as_of}) · 관심종목 ${result.published.watchlist_count}개 게시`,
      );
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : '모바일 작업에 실패했습니다.',
      );
    } finally {
      setRunning(null);
    }
  };

  return (
    <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
      {confirmationDialog}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-blue-950">모바일</p>
        <span className="text-[9px] text-blue-700/60">Supabase</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-xl bg-white text-[10px]"
          disabled={Boolean(running)}
          onClick={() => void run('publish')}
        >
          {running === 'publish' ? (
            <RefreshCw className="animate-spin" />
          ) : (
            <Upload />
          )}
          게시
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-xl bg-white text-[10px]"
          disabled={Boolean(running)}
          onClick={() => void run('sync')}
        >
          <RefreshCw className={running === 'sync' ? 'animate-spin' : ''} />
          동기화
        </Button>
      </div>
      <p
        className={`mt-2 min-h-4 text-[9px] leading-4 ${failed ? 'text-rose-700' : 'text-blue-900/60'}`}
      >
        {message ?? '게시 또는 모바일 메모 반영'}
      </p>
    </section>
  );
}

function SummaryStrip({
  snapshot,
  latestCount,
}: {
  snapshot: MarketSnapshot;
  latestCount: number;
}) {
  const asset = (key: string) =>
    snapshot.assets.find((item) => item.key === key);
  const sp500 = asset('sp500');
  const nasdaq = asset('nasdaq');
  const vix = asset('vix');
  const kospi = asset('kospi');
  const kosdaq = asset('kosdaq');
  const usdkrw = asset('usdkrw');
  const dxy = asset('dxy');
  const us10y = asset('us10y');
  return (
    <section className="grid shrink-0 overflow-hidden rounded-2xl border bg-white sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.35fr_1fr]">
      <RawContextCard
        icon={Globe2}
        label="글로벌 주식"
        state={snapshot.summary.global_risk_label}
        metrics={[
          ['S&P', sp500 ? formatAssetValue(sp500) : '—'],
          ['Nasdaq', nasdaq ? formatAssetValue(nasdaq) : '—'],
          ['VIX', vix ? formatAssetValue(vix) : '—'],
        ]}
      />
      <RawContextCard
        icon={LineChartIcon}
        label="한국 벤치마크"
        state={snapshot.summary.korea_label}
        metrics={[
          ['KOSPI', kospi ? formatAssetValue(kospi) : '—'],
          ['KOSDAQ', kosdaq ? formatAssetValue(kosdaq) : '—'],
        ]}
        bordered
      />
      <div className="border-t px-4 py-2.5 sm:border-l sm:border-t-0">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground">
            <Activity className="size-3" /> 시장 내부 확산
          </span>
          <span className="text-[9px] text-muted-foreground">
            {snapshot.breadth.coverage_count.toLocaleString('ko-KR')}종목
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <MiniBreadth label="상승" value={snapshot.breadth.advancers_pct} />
          <MiniBreadth label="20일선↑" value={snapshot.breadth.above_20d_pct} />
          <MiniBreadth label="60일선↑" value={snapshot.breadth.above_60d_pct} />
        </div>
      </div>
      <RawContextCard
        icon={Gauge}
        label="환율·금리"
        state={snapshot.summary.fx_pressure_label}
        metrics={[
          ['원/달러', usdkrw ? formatAssetValue(usdkrw) : '—'],
          ['DXY', dxy ? formatAssetValue(dxy) : '—'],
          ['미10Y', us10y ? formatAssetValue(us10y) : '—'],
        ]}
        bordered
        note={`${latestCount}/${snapshot.assets.length} 최신`}
      />
    </section>
  );
}

function RawContextCard({
  label,
  state,
  metrics,
  icon: Icon,
  bordered = false,
  note,
}: {
  label: string;
  state: string;
  metrics: Array<[string, string]>;
  icon: typeof Globe2;
  bordered?: boolean;
  note?: string;
}) {
  return (
    <div
      className={`px-4 py-2.5 ${bordered ? 'border-t sm:border-l sm:border-t-0' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground">
          <Icon className="size-3" /> {label}
        </span>
        {note ? (
          <span className="text-[8px] text-emerald-700">{note}</span>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] font-semibold">{state}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {metrics.map(([metric, value]) => (
          <span key={metric} className="text-[8px] text-muted-foreground">
            {metric}{' '}
            <strong className="ml-0.5 font-semibold tabular-nums text-slate-700">
              {value}
            </strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniBreadth({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[8px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {value === null ? '—' : `${value}%`}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function MarketVisualBoard({
  assets,
  selectedKey,
  selectedGroup,
  period,
  onPeriodChange,
  onGroupChange,
  onSelect,
}: {
  assets: MarketAsset[];
  selectedKey: string;
  selectedGroup: MarketGroup;
  period: ChartPeriod;
  onPeriodChange: (period: ChartPeriod) => void;
  onGroupChange: (group: MarketGroup) => void;
  onSelect: (key: string) => void;
}) {
  const periodSpec =
    chartPeriods.find((item) => item.key === period) ?? chartPeriods[1];
  const groupAssets = assets.filter(
    (asset) => asset.group === selectedGroup && asset.sparkline.length,
  );
  return (
    <section className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[20px] border bg-white shadow-[0_12px_40px_rgba(15,23,42,0.035)] lg:min-h-0">
      <div className="shrink-0 border-b px-4 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold">실제 수치 흐름</h2>
              <Badge
                variant="secondary"
                className="bg-emerald-50 text-[8px] text-emerald-700"
              >
                원단위
              </Badge>
            </div>
            <p className="mt-1 text-[9px] text-muted-foreground">
              독립 축의 실제 관측값이며 정규화하지 않습니다.
            </p>
          </div>
          <div className="flex shrink-0 rounded-xl border bg-white p-1">
            {chartPeriods.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onPeriodChange(item.key)}
                className={`rounded-lg px-2 py-1.5 text-[9px] font-medium transition ${period === item.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex rounded-xl bg-slate-100 p-1">
          {marketGroups.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => onGroupChange(group.key)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-[9px] font-medium transition ${selectedGroup === group.key ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid shrink-0 gap-2 p-3 lg:grid-cols-3">
        {groupAssets.map((asset) => (
          <ActualLevelChart
            key={asset.key}
            asset={asset}
            period={periodSpec}
            selected={asset.key === selectedKey}
            onSelect={onSelect}
          />
        ))}
        {!groupAssets.length ? (
          <div className="col-span-full grid h-[180px] place-items-center text-xs text-muted-foreground">
            표시할 실제 수치가 없습니다.
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t">
        <div className="grid shrink-0 grid-cols-[minmax(125px,1fr)_72px_72px_72px_72px_92px] bg-slate-50/70 px-4 py-2 text-[8px] font-medium text-muted-foreground">
          <span>기간별 실제 변화</span>
          <span className="text-center">1D</span>
          <span className="text-center">5D</span>
          <span className="text-center">20D</span>
          <span className="text-center">60D</span>
          <span className="text-center">52주 위치</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {assets.map((asset) => (
            <PerformanceRow
              key={asset.key}
              asset={asset}
              selected={asset.key === selectedKey}
              onSelect={onSelect}
            />
          ))}
          {!assets.length ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              검색 결과가 없습니다.
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 border-t bg-slate-50/70 px-4 py-2 text-[8px] leading-4 text-muted-foreground">
        최근일은 가장 최근 거래일의 시가·고가·저가·종가입니다. 분봉 데이터가
        아닙니다.
      </div>
    </section>
  );
}

function ActualLevelChart({
  asset,
  period,
  selected,
  onSelect,
}: {
  asset: MarketAsset;
  period: {
    key: ChartPeriod;
    label: string;
    observations: number;
    change: ChangeHorizon;
  };
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const data = asset.sparkline
    .slice(-period.observations)
    .map((point) => ({ date: point.date.slice(5), value: point.value }));
  const change = assetChangeValue(asset, period.change);
  return (
    <button
      type="button"
      aria-label={`${asset.label} 실제 수치 차트 선택`}
      onClick={() => onSelect(asset.key)}
      className={`min-w-0 rounded-2xl border p-3 text-left transition ${selected ? 'border-primary/30 bg-blue-50/50 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span>
          <span className="block text-[10px] font-semibold">{asset.label}</span>
          <span className="mt-0.5 block text-[7px] text-muted-foreground">
            {asset.symbol} · {asset.unit} · {asset.as_of}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[11px] font-semibold tabular-nums">
            {formatAssetValue(asset)}
          </span>
          <span
            className={`mt-0.5 block text-[8px] font-semibold tabular-nums ${rawChangeTone(change)}`}
          >
            {formatAssetChange(asset, period.change)} · {period.label}
          </span>
        </span>
      </div>
      {period.key === '1d' ? (
        <SessionSummary asset={asset} />
      ) : (
        <ChartContainer
          config={chartConfig}
          className="mt-1 aspect-auto h-[110px] w-full"
          initialDimension={{ width: 250, height: 110 }}
        >
          <LineChart
            data={data}
            margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 5" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={45}
              tickMargin={6}
            />
            <YAxis
              domain={['auto', 'auto']}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value) => formatAxisValue(value, asset)}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={assetColors[asset.key] ?? '#2f6fed'}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      )}
    </button>
  );
}

function SessionSummary({ asset }: { asset: MarketAsset }) {
  const session = asset.latest_session;
  if (!session)
    return (
      <div className="mt-3 grid h-[98px] place-items-center rounded-xl bg-slate-50 text-[9px] text-muted-foreground">
        최근 거래일 OHLC가 없습니다.
      </div>
    );
  const values = [
    ['시가', session.open],
    ['고가', session.high],
    ['저가', session.low],
    ['종가', session.close],
  ] as const;
  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-medium text-slate-600">
          최근 거래일
        </span>
        <span className="text-[7px] text-muted-foreground">{session.date}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {values.map(([label, value]) => (
          <span
            key={label}
            className="rounded-lg bg-white px-1 py-1.5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <span className="block text-[7px] text-muted-foreground">
              {label}
            </span>
            <strong className="mt-0.5 block truncate text-[8px] font-semibold tabular-nums text-slate-800">
              {formatObservedValue(value, asset)}
            </strong>
          </span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 divide-x text-center">
        <span>
          <span className="block text-[7px] text-muted-foreground">
            전일 종가 대비
          </span>
          <strong
            className={`mt-0.5 block text-[8px] tabular-nums ${rawChangeTone(assetChangeValue(asset, '1d'))}`}
          >
            {formatAssetChange(asset, '1d')}
          </strong>
        </span>
        <span>
          <span className="block text-[7px] text-muted-foreground">
            시가 대비
          </span>
          <strong
            className={`mt-0.5 block text-[8px] tabular-nums ${rawChangeTone(session.from_open_pct)}`}
          >
            {formatSignedPercent(session.from_open_pct)}
          </strong>
        </span>
        <span>
          <span className="block text-[7px] text-muted-foreground">
            장중 고저폭
          </span>
          <strong className="mt-0.5 block text-[8px] tabular-nums text-slate-700">
            {session.range_pct === null
              ? '—'
              : `${session.range_pct.toFixed(2)}%`}
          </strong>
        </span>
      </div>
    </div>
  );
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatObservedValue(value: number | null, asset: MarketAsset): string {
  if (value === null) return '—';
  const formatted = value.toLocaleString('ko-KR', {
    maximumFractionDigits: value < 10 ? 3 : 2,
  });
  return asset.unit === 'KRW'
    ? `₩${formatted}`
    : asset.unit === '%'
      ? `${formatted}%`
      : asset.unit === 'USD'
        ? `$${formatted}`
        : formatted;
}

function formatAxisValue(value: number, asset: MarketAsset): string {
  if (asset.key === 'us10y') return value.toFixed(2);
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('ko-KR');
  return value.toLocaleString('ko-KR', {
    maximumFractionDigits: value < 10 ? 2 : 1,
  });
}

function PerformanceRow({
  asset,
  selected,
  onSelect,
}: {
  asset: MarketAsset;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const horizons: ChangeHorizon[] = ['1d', '5d', '20d', '60d'];
  return (
    <button
      type="button"
      onClick={() => onSelect(asset.key)}
      className={`grid w-full grid-cols-[minmax(125px,1fr)_72px_72px_72px_72px_92px] items-center border-t px-4 py-1.5 text-left transition first:border-t-0 ${selected ? 'bg-blue-50/80' : 'hover:bg-slate-50'}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: assetColors[asset.key] ?? '#64748b' }}
        />
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-semibold">
            {asset.label}
          </span>
          <span className="block truncate text-[7px] text-muted-foreground">
            {formatAssetValue(asset)}
          </span>
        </span>
      </span>
      {horizons.map((horizon) => {
        const value = assetChangeValue(asset, horizon);
        return (
          <span
            key={horizon}
            className="mx-1 rounded-md px-1 py-1.5 text-center text-[8px] font-semibold tabular-nums"
            style={heatStyle(value)}
          >
            {formatAssetChange(asset, horizon)}
          </span>
        );
      })}
      <span className="px-2">
        <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100">
          <span
            className="block h-full rounded-full bg-slate-500"
            style={{ width: `${asset.position_252d_pct ?? 0}%` }}
          />
        </span>
        <span className="mt-0.5 block text-center text-[7px] text-muted-foreground">
          {asset.position_252d_pct === null
            ? '—'
            : `${asset.position_252d_pct.toFixed(0)}%`}
        </span>
      </span>
    </button>
  );
}

function heatStyle(value: number | null): React.CSSProperties {
  if (value === null) return { backgroundColor: '#f8fafc', color: '#94a3b8' };
  return value >= 0
    ? { backgroundColor: 'rgba(244,63,94,0.09)', color: '#9f1239' }
    : { backgroundColor: 'rgba(37,99,235,0.09)', color: '#1d4ed8' };
}

function ContextPanel({
  asset,
  period,
}: {
  asset?: MarketAsset;
  period: {
    key: ChartPeriod;
    label: string;
    observations: number;
    change: ChangeHorizon;
  };
}) {
  if (!asset)
    return (
      <aside className="grid min-h-[520px] place-items-center rounded-[20px] border bg-white text-xs text-muted-foreground lg:min-h-0">
        표시할 지표가 없습니다.
      </aside>
    );
  const note = assetNotes[asset.key] ?? {
    role: '시장 맥락을 확인하는 보조 지표',
    watch: '다른 자산과의 동행 여부를 확인',
  };
  const data = asset.sparkline
    .slice(-period.observations)
    .map((point) => ({ ...point, shortDate: point.date.slice(5) }));
  const change20 = assetChangeValue(asset, '20d');
  const direction =
    change20 === null
      ? '20일 변화가 누락됐습니다.'
      : `최근 20거래일 ${formatAssetChange(asset, '20d')} 변했습니다.`;
  const position =
    asset.position_252d_pct === null
      ? '52주 위치를 계산할 수 없습니다.'
      : `52주 관측 범위의 ${asset.position_252d_pct.toFixed(0)}% 위치입니다.`;
  return (
    <aside className="flex min-h-[520px] flex-col overflow-hidden rounded-[20px] border border-primary/15 bg-[linear-gradient(180deg,#f5f8ff_0%,#ffffff_38%)] shadow-[0_16px_50px_rgba(35,79,194,0.08)] lg:min-h-0">
      <div className="shrink-0 border-b border-primary/10 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[9px] font-medium text-muted-foreground">
              선택 지표
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
              {asset.label}
            </h2>
            <p className="mt-0.5 text-[9px] text-muted-foreground">
              {asset.symbol} · {asset.source}
            </p>
          </div>
          <StatusBadge status={asset.freshness} />
        </div>
        <div className="mt-3 flex items-end justify-between">
          <p className="text-2xl font-semibold tabular-nums">
            {formatAssetValue(asset)}
          </p>
          <p
            className={`text-xs font-semibold tabular-nums ${rawChangeTone(assetChangeValue(asset, '1d'))}`}
          >
            {formatAssetChange(asset, '1d')}{' '}
            <span className="text-[9px] font-normal text-muted-foreground">
              1D
            </span>
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <div className="rounded-2xl border bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold">
              {period.label} 원지표 흐름
            </p>
            <span className="text-[9px] text-muted-foreground">
              {asset.as_of}
            </span>
          </div>
          {period.key === '1d' ? (
            <SessionSummary asset={asset} />
          ) : (
            <ChartContainer
              config={chartConfig}
              className="mt-2 aspect-auto h-[150px] w-full"
              initialDimension={{ width: 320, height: 150 }}
            >
              <LineChart
                data={data}
                margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 5" />
                <XAxis
                  dataKey="shortDate"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={45}
                  tickMargin={6}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(value) => formatAxisValue(value, asset)}
                />
                <ReferenceLine
                  y={data[0]?.value}
                  stroke="#cbd5e1"
                  strokeDasharray="3 4"
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={assetColors[asset.key] ?? '#2f6fed'}
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {(['1d', '5d', '20d', '60d'] as ChangeHorizon[]).map((horizon) => {
            const value = assetChangeValue(asset, horizon);
            return (
              <div
                key={horizon}
                className="rounded-xl border bg-white p-2 text-center"
              >
                <p className="text-[8px] uppercase text-muted-foreground">
                  {horizon}
                </p>
                <p
                  className={`mt-1 text-[10px] font-semibold tabular-nums ${rawChangeTone(value)}`}
                >
                  {formatAssetChange(asset, horizon)}
                </p>
              </div>
            );
          })}
        </div>
        <section className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-3.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-950">
            <BookOpen className="size-3.5" /> 읽는 법
          </div>
          <p className="mt-2 text-[11px] leading-5 text-blue-950/75">
            {note.role}. {direction} {position}
          </p>
          {asset.inverse ? (
            <p className="mt-2 text-[9px] leading-4 text-blue-900/60">
              이 지표의 상승은 위험선호 개선으로 단순 해석하지 않습니다.
            </p>
          ) : null}
        </section>
        <section className="mt-3 rounded-2xl border bg-white p-3.5">
          <p className="text-[10px] font-semibold">함께 확인할 것</p>
          <p className="mt-2 text-[11px] leading-5 text-slate-600">
            {note.watch}
          </p>
        </section>
        {asset.warning ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[9px] leading-4 text-amber-900">
            {asset.warning}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function StatusSheet({
  snapshot,
  open,
  onOpenChange,
  refreshing,
  refreshMessage,
  refreshError,
  onRefresh,
}: {
  snapshot: MarketSnapshot;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  refreshing: boolean;
  refreshMessage: string | null;
  refreshError: string | null;
  onRefresh: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-[540px]"
      >
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>시장 데이터 상태</SheetTitle>
          <SheetDescription>
            각 지표는 독립 수집되며 실패·지연 상태를 최신값처럼 숨기지 않습니다.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-6 pb-6">
          <section
            className={`rounded-2xl border p-4 ${refreshError ? 'border-rose-200 bg-rose-50' : refreshing ? 'border-blue-200 bg-blue-50' : 'border-emerald-200 bg-emerald-50'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold">
                  {refreshing
                    ? '전체 시장 데이터 갱신 중'
                    : refreshError
                      ? '마지막 갱신 실패'
                      : (refreshMessage ?? '현재 저장된 시장 데이터')}
                </p>
                <p className="mt-1 text-[9px] text-muted-foreground">
                  생성 시각{' '}
                  {snapshot.generated_at.replace('T', ' ').slice(0, 19)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 rounded-xl bg-white"
                onClick={onRefresh}
                disabled={refreshing}
              >
                <RefreshCw
                  className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                {refreshing ? '수집 중' : '다시 갱신'}
              </Button>
            </div>
            {refreshError ? (
              <p className="mt-3 rounded-xl bg-white/70 p-2.5 text-[9px] leading-4 text-rose-800">
                {refreshError}
              </p>
            ) : null}
          </section>
          <section className="grid grid-cols-3 gap-2">
            {[
              [
                '최신',
                snapshot.assets.filter((item) => item.freshness === 'latest')
                  .length,
              ],
              [
                '지연',
                snapshot.assets.filter((item) => item.freshness === 'stale')
                  .length,
              ],
              [
                '누락',
                snapshot.assets.filter((item) => item.freshness === 'missing')
                  .length,
              ],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-2xl border p-3 text-center"
              >
                <p className="text-[9px] text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-semibold">{value}</p>
              </div>
            ))}
          </section>
          {snapshot.assets.map((asset) => (
            <div
              key={asset.key}
              className="flex items-center gap-3 rounded-xl border p-3"
            >
              <StatusBadge status={asset.freshness} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold">{asset.label}</p>
                <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                  {asset.source} · {asset.symbol} ·{' '}
                  {asset.as_of ?? '관측일 누락'}
                </p>
              </div>
              {asset.warning ? (
                <span className="text-[9px] text-amber-700">확인 필요</span>
              ) : (
                <CheckCircle2 className="size-3.5 text-emerald-500" />
              )}
            </div>
          ))}
          <section className="rounded-2xl border bg-slate-50 p-4 text-[10px] leading-5 text-slate-600">
            합성점수는 사용하지 않습니다. 상태 라벨은 S&P 500·Nasdaq 20일 방향,
            VIX 20 이하 여부, KOSPI·KOSDAQ 방향과 20·60일선 상회 종목 비율을
            각각 직접 확인하는 투명한 규칙입니다.
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatusBadge({ status }: { status: MarketAsset['freshness'] }) {
  const style =
    status === 'latest'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'stale'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-rose-200 bg-rose-50 text-rose-700';
  return (
    <Badge
      variant="outline"
      className={`${style} rounded-lg px-1.5 py-0.5 text-[8px]`}
    >
      {status === 'latest' ? '최신' : status === 'stale' ? '지연' : '누락'}
    </Badge>
  );
}
