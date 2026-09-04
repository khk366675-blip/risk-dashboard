'use client';

import Link from 'next/link';
import { createContext, useContext, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  FileSearch,
  Info,
  GitCompareArrows,
  LineChart,
  Menu,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WatchlistButton } from '@/components/watchlist-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  formatMarketCap,
  lensColor,
  lensForDisplay,
  lensLabel,
  lenses,
  radarRun as initialRadarRun,
  type Lens,
  type RadarCandidate,
  type RadarEvidence,
  type RadarRun,
} from '@/lib/radar-run';

const RadarRunContext = createContext<RadarRun>(initialRadarRun);
const useRadarRun = () => useContext(RadarRunContext);

export default function RadarWorkspace({
  initialRadarRun: currentRadarRun = initialRadarRun,
}: {
  initialRadarRun?: RadarRun;
}) {
  const [radarRun, setRadarRun] = useState<RadarRun>(currentRadarRun);
  const [selectedLens, setSelectedLens] = useState<Lens | 'all'>('all');
  const [selectedCode, setSelectedCode] = useState(
    radarRun.candidates[0]?.code ?? '',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [radarRefreshing, setRadarRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const filteredCandidates = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('ko-KR');
    return radarRun.candidates.filter((candidate) => {
      const matchesLens =
        selectedLens === 'all' ||
        candidate.matched_lenses.includes(selectedLens);
      const matchesQuery =
        !query ||
        `${candidate.name} ${candidate.code} ${candidate.market}`
          .toLocaleLowerCase('ko-KR')
          .includes(query);
      return matchesLens && matchesQuery;
    });
  }, [radarRun.candidates, searchQuery, selectedLens]);

  const selectedCandidate =
    filteredCandidates.find((candidate) => candidate.code === selectedCode) ??
    filteredCandidates[0];
  const refreshRadar = async () => {
    if (radarRefreshing) return;
    setRadarRefreshing(true);
    setRefreshMessage(null);
    setRefreshError(null);
    setDiagnosticsOpen(true);
    try {
      const response = await fetch('/api/radar/refresh', {
        method: 'POST',
        cache: 'no-store',
      });
      const payload = (await response.json()) as {
        ok: boolean;
        radar?: RadarRun;
        error?: string;
        detail?: string;
      };
      if (!response.ok || !payload.ok || !payload.radar)
        throw new Error(
          payload.detail ||
            payload.error ||
            'Radar 실행 응답이 올바르지 않습니다.',
        );
      setRadarRun(payload.radar);
      setSelectedCode((current) =>
        payload.radar!.candidates.some(
          (candidate) => candidate.code === current,
        )
          ? current
          : (payload.radar!.candidates[0]?.code ?? ''),
      );
      setRefreshMessage(
        `${payload.radar.summary.candidate_unique_count}개 후보를 ${payload.radar.as_of} 기준으로 갱신했습니다.`,
      );
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : 'Radar 전체시장 실행 중 오류가 발생했습니다.',
      );
    } finally {
      setRadarRefreshing(false);
    }
  };

  return (
    <RadarRunContext.Provider value={radarRun}>
      <div className="h-screen overflow-hidden bg-background text-foreground">
        <div className="mx-auto grid h-full max-w-[1800px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
          <GlobalSidebar
            candidateCount={radarRun.summary.candidate_unique_count}
          />

          <main className="flex min-w-0 flex-col overflow-hidden">
            <Topbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onMenuOpen={() => setMobileMenuOpen(true)}
            />

            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-4 sm:px-5 xl:px-6">
              <div className="flex shrink-0 flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <span>Research</span>
                    <span>/</span>
                    <span className="text-foreground">Radar v0</span>
                  </div>
                  <h1 className="text-xl font-semibold tracking-[-0.035em] sm:text-[25px]">
                    Radar 후보
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`hidden h-8 rounded-xl px-3 text-[11px] font-medium md:flex ${radarRun.status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${radarRun.status === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    />{' '}
                    {radarRun.status === 'ok' ? '전체시장 실행' : '부분 실행'} ·{' '}
                    {radarRun.as_of}
                  </Badge>
                  <Button
                    variant="outline"
                    className="h-8 rounded-xl px-3"
                    onClick={() => setConditionsOpen(true)}
                  >
                    <SlidersHorizontal /> 조건
                  </Button>
                  <Button
                    className="h-8 rounded-xl px-3 shadow-[0_8px_24px_rgba(35,79,194,0.18)]"
                    onClick={refreshRadar}
                    disabled={radarRefreshing}
                  >
                    <RefreshCw
                      className={radarRefreshing ? 'animate-spin' : ''}
                    />{' '}
                    {radarRefreshing ? '전체시장 실행 중' : 'Radar 최신 실행'}
                  </Button>
                </div>
              </div>

              <RunStrip />

              <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto md:grid-cols-[250px_minmax(440px,1fr)] xl:grid-cols-[250px_minmax(440px,1fr)_340px] xl:overflow-hidden">
                <RadarSidebar
                  selectedLens={selectedLens}
                  selectedCode={selectedCandidate?.code ?? ''}
                  onLensChange={setSelectedLens}
                  filteredCandidates={filteredCandidates}
                />

                <RadarMap
                  selectedLens={selectedLens}
                  selectedCandidate={selectedCandidate}
                  selectedCode={selectedCandidate?.code ?? ''}
                  candidates={filteredCandidates}
                  onCandidateChange={setSelectedCode}
                  onDiagnosticsOpen={() => setDiagnosticsOpen(true)}
                />

                <EvidencePanel
                  candidate={selectedCandidate}
                  selectedLens={selectedLens}
                />
              </div>
            </div>
          </main>
        </div>

        <ConditionsSheet
          open={conditionsOpen}
          onOpenChange={setConditionsOpen}
        />
        <DiagnosticsSheet
          open={diagnosticsOpen}
          onOpenChange={setDiagnosticsOpen}
          refreshing={radarRefreshing}
          refreshMessage={refreshMessage}
          refreshError={refreshError}
          onRefresh={refreshRadar}
        />
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="w-[280px] p-0">
            <div className="h-full bg-sidebar p-4">
              <GlobalSidebar
                candidateCount={radarRun.summary.candidate_unique_count}
                mobile
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </RadarRunContext.Provider>
  );
}

function GlobalSidebar({
  candidateCount,
  mobile = false,
}: {
  candidateCount: number;
  mobile?: boolean;
}) {
  const radarRun = useRadarRun();
  const evaluatedCount =
    radarRun.summary.evaluated_universe_count ??
    radarRun.summary.financial_universe_count;
  const financialCount =
    radarRun.summary.financial_coverage_count ??
    radarRun.summary.financial_universe_count;
  return (
    <aside
      className={`${mobile ? 'flex' : 'hidden lg:flex'} h-full flex-col border-r border-sidebar-border bg-sidebar px-4 py-5`}
    >
      <div className="flex items-center gap-3 px-2 pb-7">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-[0_8px_24px_rgba(35,79,194,0.22)]">
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
      <nav className="space-y-1" aria-label="주요 메뉴">
        <NavItem icon={LineChart} label="Markets" href="/markets" />
        <NavItem
          icon={Radar}
          label="Radar"
          active
          trailing={String(candidateCount)}
          href="/radar"
        />
        <NavItem icon={Star} label="관심종목" href="/watchlist" />
        <NavItem icon={GitCompareArrows} label="기업 비교" href="/compare" />
        <NavItem icon={BookOpen} label="Learning" href="/learning" />
      </nav>
      <div
        className={`mt-auto rounded-2xl border p-3.5 ${radarRun.status === 'ok' ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70'}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">데이터 범위</span>
          <span
            className={`flex items-center gap-1 text-[11px] font-medium ${radarRun.status === 'ok' ? 'text-emerald-800' : 'text-amber-800'}`}
          >
            <span
              className={`size-1.5 rounded-full ${radarRun.status === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'}`}
            />{' '}
            {radarRun.status === 'ok' ? '최신' : '부분'}
          </span>
        </div>
        <div
          className={`mt-3 h-1.5 overflow-hidden rounded-full ${radarRun.status === 'ok' ? 'bg-emerald-100' : 'bg-amber-100'}`}
        >
          <div
            className={`h-full rounded-full ${radarRun.status === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{
              width: `${Math.max(3, (evaluatedCount / radarRun.summary.listing_universe_count) * 100)}%`,
            }}
          />
        </div>
        <p
          className={`mt-2 text-[11px] leading-4 ${radarRun.status === 'ok' ? 'text-emerald-950/70' : 'text-amber-950/70'}`}
        >
          게이트 {evaluatedCount.toLocaleString('ko-KR')}개 · 분석가능 재무{' '}
          {financialCount.toLocaleString('ko-KR')}개
        </p>
      </div>
    </aside>
  );
}

function Topbar({
  searchQuery,
  onSearchChange,
  onMenuOpen,
}: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onMenuOpen: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-background/90 px-4 backdrop-blur-xl sm:px-5 xl:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="메뉴 열기"
        onClick={onMenuOpen}
      >
        <Menu />
      </Button>
      <div className="relative hidden max-w-md flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label="Radar 후보 검색"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="현재 후보에서 종목명·코드 검색"
          className="h-8 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-xs outline-none transition focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
        />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <div className="ml-1 grid size-8 place-items-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
          KH
        </div>
      </div>
    </header>
  );
}

function RunStrip() {
  const radarRun = useRadarRun();
  const evaluatedCount =
    radarRun.summary.evaluated_universe_count ??
    radarRun.summary.financial_universe_count;
  const financialCount =
    radarRun.summary.financial_coverage_count ??
    radarRun.summary.financial_universe_count;
  const priceIsFresh = radarRun.candidates.every(
    (candidate) => candidate.freshness === 'latest',
  );
  const metrics = [
    {
      label: '평가 Universe',
      value: `${evaluatedCount.toLocaleString('ko-KR')}개`,
      sub: `DART 재무 수집 ${financialCount.toLocaleString('ko-KR')}개`,
    },
    {
      label: '공통 게이트 통과',
      value: `${radarRun.summary.standard_eligible_count}개`,
      sub: '시총·유동성·이력',
    },
    {
      label: '중복 제거 후보',
      value: `${radarRun.summary.candidate_unique_count}개`,
      sub: '현재 연구 목록',
    },
    {
      label: '가격 기준일',
      value: radarRun.candidates[0]?.latest_price_date ?? '누락',
      sub: priceIsFresh ? '완료 시장일 검증' : '일부 가격 오래됨',
      warning: !priceIsFresh,
    },
    {
      label: '규칙 버전',
      value: radarRun.rule_version.split('.').at(-1) ?? radarRun.rule_version,
      sub: radarRun.scope_label,
    },
  ];
  return (
    <section
      aria-label="Radar 실행 요약"
      className="grid shrink-0 overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-3 xl:grid-cols-5"
    >
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${index ? 'border-t border-border sm:border-l sm:border-t-0' : ''}`}
        >
          <div>
            <p className="text-[10px] font-medium text-muted-foreground">
              {metric.label}
            </p>
            <p
              className={`mt-0.5 text-xs font-semibold tabular-nums ${metric.warning ? 'text-amber-700' : ''}`}
            >
              {metric.value}
            </p>
          </div>
          <span
            className={`max-w-24 text-right text-[9px] leading-3.5 ${metric.warning ? 'text-amber-700' : 'text-muted-foreground'}`}
          >
            {metric.sub}
          </span>
        </div>
      ))}
    </section>
  );
}

function RadarSidebar({
  selectedLens,
  selectedCode,
  onLensChange,
  filteredCandidates,
}: {
  selectedLens: Lens | 'all';
  selectedCode: string;
  onLensChange: (lens: Lens | 'all') => void;
  filteredCandidates: RadarCandidate[];
}) {
  const radarRun = useRadarRun();
  return (
    <aside className="flex min-h-[420px] flex-col overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_12px_40px_rgba(15,23,42,0.035)] xl:min-h-0">
      <div className="shrink-0 border-b border-border p-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold">Radar lens</h2>
          <button
            type="button"
            onClick={() => onLensChange('all')}
            className="text-[10px] font-medium text-primary"
          >
            전체 {radarRun.summary.candidate_unique_count}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {lenses.map((lens) => {
            const active = selectedLens === lens.key;
            const count = radarRun.summary.lens_counts[lens.key];
            return (
              <button
                key={lens.key}
                type="button"
                onClick={() => onLensChange(active ? 'all' : lens.key)}
                className={`rounded-xl border px-2.5 py-2 text-left transition ${active ? 'border-primary/30 bg-primary/[0.055]' : 'border-border bg-slate-50/60 hover:border-slate-300'}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="grid size-5 place-items-center rounded-md text-[9px] font-bold text-white"
                    style={{ backgroundColor: lens.color }}
                  >
                    {lens.shortLabel}
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums">
                    {count}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[10px] font-medium">
                  {lens.label}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between px-3.5 py-3">
          <div>
            <h3 className="text-xs font-semibold">포착 후보</h3>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {filteredCandidates.length}개 · 중복 후보는 한 번만 표시
            </p>
          </div>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filteredCandidates.length ? (
            filteredCandidates.map((candidate) => (
              <Link
                key={candidate.code}
                href={`/stocks/${candidate.code}`}
                aria-label={`${candidate.name} 상세 작업면 열기`}
                className={`group mb-1 block w-full rounded-xl border px-3 py-2.5 text-left transition ${selectedCode === candidate.code ? 'border-primary/20 bg-blue-50/70 shadow-sm' : 'border-transparent hover:bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">
                      {candidate.name}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {candidate.code} ·{' '}
                      {formatMarketCap(candidate.market_cap_krw)}
                    </p>
                  </div>
                  <span className="flex items-center gap-1">
                    <span
                      className="mt-0.5 size-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          lensColor[lensForDisplay(candidate, selectedLens)],
                      }}
                    />
                    <ChevronRight className="size-3 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {candidate.matched_lenses.map((lens) => (
                    <span
                      key={lens}
                      className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[8px] font-semibold text-slate-600"
                    >
                      {lensLabel[lens]}
                    </span>
                  ))}
                </div>
              </Link>
            ))
          ) : (
            <div className="mx-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
              <FileSearch className="mx-auto size-5 text-slate-400" />
              <p className="mt-2 text-xs font-medium">
                현재 조건의 후보가 없습니다
              </p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                가격이 오래된 경우 Dislocation 판정을 자동 보류합니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function RadarMap({
  selectedLens,
  selectedCandidate,
  selectedCode,
  candidates,
  onCandidateChange,
  onDiagnosticsOpen,
}: {
  selectedLens: Lens | 'all';
  selectedCandidate?: RadarCandidate;
  selectedCode: string;
  candidates: RadarCandidate[];
  onCandidateChange: (code: string) => void;
  onDiagnosticsOpen: () => void;
}) {
  return (
    <section className="flex min-h-[480px] min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_12px_40px_rgba(15,23,42,0.035)] xl:min-h-0">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">후보 근거 비교</h2>
            <Badge
              variant="secondary"
              className="bg-slate-100 text-[10px] text-slate-600"
            >
              {selectedLens === 'all' ? '전체 렌즈' : lensLabel[selectedLens]}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            통과 조건의 실제 값과 기준을 표시하며 렌즈 간 점수로 합산하지 않습니다.
          </p>
        </div>
      </div>

      {candidates.length ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            {candidates.map((candidate) => {
              const lens = lensForDisplay(candidate, selectedLens);
              const result = candidate.lenses[lens];
              const alertCount =
                result.contradictions.length + candidate.warnings.length;
              return (
                <button
                  key={candidate.code}
                  type="button"
                  onClick={() => onCandidateChange(candidate.code)}
                  className={`w-full rounded-2xl border p-3 text-left transition ${candidate.code === selectedCode ? 'border-primary/35 bg-blue-50/45 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: lensColor[lens] }}
                        />
                        <strong className="truncate text-[12px]">
                          {candidate.name}
                        </strong>
                        <span className="text-[9px] text-muted-foreground">
                          {candidate.code}
                        </span>
                      </div>
                      <p className="mt-1 text-[9px] text-muted-foreground">
                        {candidate.market} · {lensLabel[lens]} · 기준일 {candidate.as_of}
                      </p>
                    </div>
                    {alertCount > 0 ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-200 bg-amber-50 text-[8px] text-amber-800"
                      >
                        추가 확인 {alertCount}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-[8px]">
                        근거 {result.evidence.length}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
                    {result.evidence.slice(0, 3).map((item) => (
                      <span
                        key={item.key}
                        className="min-w-0 rounded-xl bg-slate-50 px-2.5 py-2"
                      >
                        <span className="block truncate text-[8px] text-muted-foreground">
                          {item.label}
                        </span>
                        <span className="mt-1 flex items-baseline justify-between gap-2">
                          <strong className="truncate text-[11px] tabular-nums text-slate-800">
                            {formatRadarEvidenceValue(item)}
                          </strong>
                          <small className="shrink-0 text-[8px] text-slate-500">
                            기준 {item.comparison}
                          </small>
                        </span>
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <AlertTriangle className="mx-auto size-7 text-amber-500" />
            <h3 className="mt-3 text-sm font-semibold">
              현재 조건을 통과한 후보가 없습니다
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
              선택한 렌즈의 강화 조건과 데이터 커버리지를 모두 만족한 종목이
              없습니다. 실행 진단에서 원천 상태를 확인할 수 있습니다.
            </p>
            <Button
              variant="outline"
              className="mt-4 rounded-xl"
              onClick={onDiagnosticsOpen}
            >
              <Info /> 실행 진단 보기
            </Button>
          </div>
        </div>
      )}

      {selectedCandidate ? (
        <div className="shrink-0 border-t bg-slate-50/70 px-4 py-2 text-[9px] text-muted-foreground">
          선택 후보의 전체 근거·반대 근거·출처는 오른쪽에서 이어서 확인합니다.
        </div>
      ) : null}
    </section>
  );
}

function formatRadarEvidenceValue(item: RadarEvidence) {
  if (typeof item.value === 'string')
    return item.value.startsWith('http') ? 'DART 원문' : item.value;
  if (typeof item.value !== 'number' || !Number.isFinite(item.value)) return '미수집';
  const absolute = Math.abs(item.value);
  if (absolute >= 1_000_000_000_000)
    return `${(item.value / 1_000_000_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조`;
  if (absolute >= 100_000_000)
    return `${(item.value / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  const formatted = item.value.toLocaleString('ko-KR', {
    maximumFractionDigits: 2,
  });
  if (item.comparison.includes('%p')) return `${formatted}%p`;
  if (item.comparison.includes('%')) return `${formatted}%`;
  return formatted;
}

function EvidencePanel({
  candidate,
  selectedLens,
}: {
  candidate?: RadarCandidate;
  selectedLens: Lens | 'all';
}) {
  if (!candidate) {
    return (
      <aside className="flex min-h-[480px] items-center justify-center rounded-[20px] border border-primary/15 bg-[linear-gradient(180deg,#f7f9ff_0%,#ffffff_34%)] p-6 text-center md:col-span-2 xl:col-span-1">
        <div>
          <Sparkles className="mx-auto size-6 text-primary" />
          <p className="mt-3 text-sm font-semibold">표시할 근거가 없습니다</p>
          <p className="mt-1 text-xs text-muted-foreground">
            다른 렌즈를 선택해 보세요.
          </p>
        </div>
      </aside>
    );
  }
  const displayLens = lensForDisplay(candidate, selectedLens);
  const result = candidate.lenses[displayLens];
  const evidenceSummary = result.evidence
    .slice(0, 2)
    .map((item) => item.label)
    .join('· ');
  const warnings = [...candidate.warnings];
  if (candidate.freshness === 'stale')
    warnings.unshift(
      `가격 기준일 ${candidate.latest_price_date ?? '누락'} · 현재 가격 신호 아님`,
    );
  return (
    <aside className="flex min-h-[480px] flex-col overflow-hidden rounded-[20px] border border-primary/15 bg-[linear-gradient(180deg,#f7f9ff_0%,#ffffff_34%)] shadow-[0_16px_50px_rgba(35,79,194,0.09)] md:col-span-2 xl:col-span-1 xl:min-h-0">
      <div className="shrink-0 border-b border-primary/10 px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-white shadow-sm">
              <Sparkles className="size-3.5" />
            </span>
            <div>
              <p className="text-xs font-semibold">선정 근거 요약</p>
              <p className="text-[9px] text-muted-foreground">
                규칙 근거를 읽기 쉽게 정리
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-[9px] text-emerald-700"
          >
            <ShieldCheck /> 출처 연결
          </Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-semibold tracking-[-0.02em]">
              {candidate.name}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {candidate.code} · {lensLabel[displayLens]} 관점
            </p>
          </div>
          <Badge variant="secondary" className="bg-white text-[9px] shadow-sm">
            근거 {result.evidence_count}개
          </Badge>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3.5">
          <p className="text-[10px] font-semibold text-muted-foreground">
            포착 요약
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-700">
            {evidenceSummary || '현재 구조화된 포착 근거가 없습니다.'}
          </p>
          <div className="mt-3 flex items-center gap-3 text-[9px] text-muted-foreground">
            <span>연결 근거 {result.evidence.length}개</span>
            <span>기준일 {candidate.as_of}</span>
            <span>{result.band === 'strong' ? '복수 조건 통과' : '추가 검토'}</span>
          </div>
        </div>

        <div
          className={`mt-3 rounded-2xl border p-3.5 ${result.contradictions.length ? 'border-amber-200/80 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/60'}`}
        >
          <p
            className={`text-[10px] font-semibold ${result.contradictions.length ? 'text-amber-800' : 'text-emerald-800'}`}
          >
            {result.contradictions.length
              ? '반대 근거 먼저 보기'
              : '구조화된 반대 근거'}
          </p>
          <p
            className={`mt-1.5 text-xs leading-5 ${result.contradictions.length ? 'text-amber-950/80' : 'text-emerald-950/70'}`}
          >
            {result.contradictions[0] ??
              '현재 수집 범위에서 확인된 반대 근거가 없습니다. 미수집 항목은 별도 확인이 필요합니다.'}
          </p>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground">
              연결된 근거
            </p>
            <span className="text-[9px] text-muted-foreground">
              {result.evidence.length}개
            </span>
          </div>
          <div className="mt-2 space-y-2">
            {result.evidence.slice(0, 5).map((item) => (
              <EvidenceSourceRow key={item.key} item={item} />
            ))}
          </div>
        </div>

        {warnings.length ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-800">
              <AlertTriangle className="size-3" /> 데이터 주의
            </p>
            <ul className="mt-2 space-y-1.5 text-[9px] leading-4 text-amber-950/75">
              {warnings.slice(0, 3).map((warning) => (
                <li key={warning}>· {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-primary/10 bg-white/80 p-3.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">데이터 커버리지</span>
          <span className="font-semibold tabular-nums">
            {result.coverage_pct}%
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${result.coverage_pct}%` }}
          />
        </div>
        <Link
          href={`/stocks/${candidate.code}`}
          className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary text-[11px] font-semibold text-white shadow-[0_8px_22px_rgba(35,79,194,0.18)] transition hover:bg-primary/90"
        >
          종목 상세 <ExternalLink className="size-3" />
        </Link>
        <div className="mt-2">
          <WatchlistButton key={candidate.code} code={candidate.code} />
        </div>
      </div>
    </aside>
  );
}

function EvidenceSourceRow({ item }: { item: RadarEvidence }) {
  const isLink =
    typeof item.value === 'string' && item.value.startsWith('http');
  const content = (
    <>
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
        <Database className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium">
          {item.label}
        </span>
        <span className="mt-0.5 block text-[9px] text-muted-foreground">
          {item.source} · {item.period} · {item.comparison}
        </span>
      </span>
      {isLink ? (
        <ExternalLink className="ml-auto size-3 text-muted-foreground" />
      ) : (
        <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-slate-700">
          {formatRadarEvidenceValue(item)}
        </span>
      )}
    </>
  );
  const className =
    'flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-primary/30 hover:bg-blue-50/30';
  return isLink ? (
    <a
      href={String(item.value)}
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function ConditionsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sections = [
    {
      title: '공통 진입',
      color: '#475569',
      items: [
        '시가총액 300억원 이상',
        '20일 중앙 거래대금 2억원 이상',
        '가격 이력 120일 이상',
        '재무 갱신 180일 이내',
      ],
    },
    {
      title: 'Quality',
      color: lensColor.quality,
      items: [
        '조건 통과 종목 전체 표시',
        '전체 7개 중 근거 6개',
        '최근 4분기 모두 영업흑자',
        'ROE 20%·현금전환 1.5배',
        '이자보상 10배·부채비율 50%',
        '영업이익률 15% 이상',
      ],
    },
    {
      title: 'Improvement',
      color: lensColor.improvement,
      items: [
        '조건 통과 종목 전체 표시',
        '사업 근거 3개·재무 근거 1개',
        '전체 근거 4개·커버리지 67%',
        '매출 YoY +30%',
        '영업이익 YoY +75%',
        '손실 70% 축소·마진 +6%p',
        '현재 마진 7%·부채 35%p 개선',
      ],
    },
    {
      title: 'Dislocation',
      color: lensColor.dislocation,
      items: [
        '조건 통과 종목 전체 표시',
        '가격·가치 근거 5개 모두',
        '52주 고점 대비 -40%',
        '극단적 하락 -55%',
        '시장 대비 6개월 -35%p',
        '가격 하위 10%·가치 하위 7%',
      ],
    },
    {
      title: 'Event',
      color: lensColor.event,
      items: [
        '조건 통과 종목 전체 표시',
        '일반 중요공시 최근 7일',
        '희석 위험 공시 최근 2일',
        '일반 공시는 거래반응 필수',
        '2일 내 8.0배·750억원',
        '공급계약·자사주·희석 위험',
      ],
    },
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-[560px]"
      >
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Radar 강화 조건</SheetTitle>
          <SheetDescription>
            절대조건과 데이터 커버리지를 통과한 종목은 렌즈별 개수 상한 없이
            모두 표시합니다.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-6 pb-6">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: section.color }}
                />
                <h3 className="text-sm font-semibold">{section.title}</h3>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {section.items.map((item) => (
                  <div
                    key={item}
                    className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </section>
          ))}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-950/80">
            <Info className="mr-1 inline size-3.5" /> 종합 투자점수나 매수·매도
            등급은 만들지 않습니다. 결측과 반대 근거도 후보 상세에 함께
            남깁니다.
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DiagnosticsSheet({
  open,
  onOpenChange,
  refreshing,
  refreshMessage,
  refreshError,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshing: boolean;
  refreshMessage: string | null;
  refreshError: string | null;
  onRefresh: () => void;
}) {
  const radarRun = useRadarRun();
  const prices = radarRun.source_status.prices;
  const financials = radarRun.source_status.dart_financials;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-[580px]"
      >
        <SheetHeader className="border-b px-6 py-5">
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
              전체시장 실행
            </Badge>
            <span className="truncate text-[10px] text-muted-foreground">
              {radarRun.run_id}
            </span>
          </div>
          <SheetTitle className="mt-2">Radar 실행 진단</SheetTitle>
          <SheetDescription>
            KOSPI·KOSDAQ 전체 목록에서 규모·유동성·가격 이력을 통과한 종목을
            최신 재무와 공시로 평가했습니다.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-6 pb-6">
          <section
            className={`rounded-2xl border p-4 ${refreshError ? 'border-rose-200 bg-rose-50' : refreshing ? 'border-blue-200 bg-blue-50' : 'border-emerald-200 bg-emerald-50'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold">
                  {refreshing
                    ? '전체시장 가격·DART·공시를 다시 수집하고 있습니다'
                    : refreshError
                      ? '마지막 Radar 실행 실패'
                      : (refreshMessage ?? '현재 저장된 Radar 실행 결과')}
                </p>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                  전체 실행은 수 분 걸릴 수 있습니다. 완료 전에는 기존 결과를
                  유지합니다.
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
                {refreshing ? '실행 중' : '다시 실행'}
              </Button>
            </div>
            {refreshError ? (
              <p className="mt-3 rounded-xl bg-white/70 p-2.5 text-[9px] leading-4 text-rose-800">
                {refreshError}
              </p>
            ) : null}
          </section>
          <section className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border p-3">
              <p className="text-[10px] text-muted-foreground">가격 최신성</p>
              <p className="mt-1 text-lg font-semibold">
                {prices?.coverage_pct ?? 0}%
              </p>
              <p className="text-[9px] text-muted-foreground">
                {prices?.fresh_count?.toLocaleString('ko-KR')} /{' '}
                {prices?.target_count?.toLocaleString('ko-KR')}
              </p>
            </div>
            <div className="rounded-2xl border p-3">
              <p className="text-[10px] text-muted-foreground">DART 재무</p>
              <p className="mt-1 text-lg font-semibold">
                {financials?.coverage_pct ?? 0}%
              </p>
              <p className="text-[9px] text-muted-foreground">
                {financials?.covered_count?.toLocaleString('ko-KR')} /{' '}
                {financials?.target_count?.toLocaleString('ko-KR')}
              </p>
            </div>
            <div className="rounded-2xl border p-3">
              <p className="text-[10px] text-muted-foreground">중복 제거</p>
              <p className="mt-1 text-lg font-semibold">
                {radarRun.summary.candidate_unique_count}
              </p>
              <p className="text-[9px] text-muted-foreground">조건 통과 전체</p>
            </div>
          </section>
          <div className="grid grid-cols-2 gap-2">
            {lenses.map((lens) => (
              <div
                key={lens.key}
                className="rounded-2xl border border-border p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: lens.color }}
                  />
                  <span className="text-[11px] font-medium">{lens.label}</span>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <p className="text-2xl font-semibold tabular-nums">
                    {radarRun.summary.lens_counts[lens.key]}
                  </p>
                  <p className="text-[9px] text-muted-foreground">상한 없음</p>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  조건 통과 전체 · 중복 포함
                </p>
              </div>
            ))}
          </div>
          <section className="rounded-2xl border border-border p-4">
            <h3 className="text-xs font-semibold">공통 게이트 탈락 원인</h3>
            <div className="mt-3 space-y-3">
              {Object.entries(radarRun.diagnostics.standard_rejections).map(
                ([reason, count]) => (
                  <div key={reason}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span>{reason}</span>
                      <span className="font-semibold tabular-nums">
                        {count}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-slate-500"
                        style={{
                          width: `${(count / radarRun.summary.listing_universe_count) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ),
              )}
            </div>
          </section>
          {radarRun.warnings.length ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <AlertTriangle className="size-3.5" /> 추가 확인 범위
              </h3>
              <ul className="mt-3 space-y-2 text-[11px] leading-5 text-amber-950/75">
                {radarRun.warnings.map((warning) => (
                  <li key={warning}>· {warning}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="rounded-2xl border border-border p-4">
            <h3 className="text-xs font-semibold">다음 데이터 개선</h3>
            <ol className="mt-3 space-y-2 text-[11px] leading-5 text-slate-700">
              <li>1. 누락 업종 분류를 보강해 업종 내 상대가치로 전환</li>
              <li>
                2. 공급계약 금액·매출 대비 비중을 구조화해 Event 품질 강화
              </li>
              <li>3. 감사의견·거래정지·상장폐지 절차 위험 소스 연결</li>
            </ol>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  trailing,
  href,
}: {
  icon: typeof Radar;
  label: string;
  active?: boolean;
  trailing?: string;
  href: string;
}) {
  const content = (
    <>
      <Icon className="size-[17px]" />
      <span>{label}</span>
      {trailing ? (
        <span className="ml-auto rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-sm">
          {trailing}
        </span>
      ) : null}
    </>
  );
  const className = `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${active ? 'bg-primary/[0.08] text-primary' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`;
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
