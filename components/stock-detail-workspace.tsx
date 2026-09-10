'use client';
import { FinancialExplorer } from '@/components/financial-explorer';
import { ResearchTools } from '@/components/research-tools';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Database,
  ExternalLink,
  FileText,
  PanelLeft,
  PanelRight,
  Search,
  ShieldAlert,
  Star,
  RefreshCw,
  LoaderCircle,
  ChevronDown,
  BookOpen,
  GitCompareArrows,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ResearchControls } from '@/components/research-stock-controller';
import { EvidenceAiPanel } from '@/components/evidence-ai-panel';
import { ThesisAiPanel } from '@/components/thesis-ai-panel';
import { ThesisEvidenceReviewPanel } from '@/components/thesis-evidence-review-panel';
import { FilingDocumentWorkspace } from '@/components/filing-document-workspace';
import {
  JournalWorkspace,
  KpiWorkspace,
  ResearchView,
} from '@/components/research-system-workspaces';
import {
  ThesisWorkspace,
  ThesisContextPanel,
  discardThesisMessage,
} from '@/components/thesis-workspace';
import { useThesisNavigationGuard } from '@/components/use-thesis-navigation-guard';
import { useDiscardConfirmation } from '@/components/use-discard-confirmation';
import { thesisTitle, type InvestmentThesis } from '@/lib/investment-thesis';
import { researchStateLabel } from '@/lib/watchlist';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  OverviewPanel,
  FinancialPanel,
  PricePanel,
  EventsPanel,
  Choices,
} from '@/components/stock-research-panels';
import {
  lensColor,
  lensLabel,
  type Lens,
  type RadarRun,
  type RadarEvidence,
} from '@/lib/radar-run';
import {
  formatMultiple,
  formatPercent,
  formatWon,
  type StockDetail,
  type StockEvent,
} from '@/lib/stock-detail';
import {
  displayNumber,
  classifyFiling,
  eventCategories,
  eventChecks,
  eventDate,
  safeSourceUrl,
} from '@/lib/stock-research';

type DetailTab =
  | 'thesis'
  | 'research'
  | 'kpis'
  | 'journal'
  | 'overview'
  | 'financials'
  | 'price'
  | 'events'
  | 'documents';
type EvidenceTab =
  | 'thesis'
  | 'questions'
  | 'thesis-evidence'
  | 'radar'
  | 'sources'
  | 'filing'
  | 'explain';
const tabs = [
  { value: 'thesis', label: '투자포인트' },
  { value: 'research', label: 'Research View' },
  { value: 'overview', label: '핵심 현황' },
  { value: 'financials', label: '재무 추이' },
  { value: 'price', label: '가격·거래량' },
  { value: 'events', label: '공시' },
  { value: 'documents', label: '공시 원문' },
  { value: 'kpis', label: '사업 KPI' },
  { value: 'journal', label: '리서치 로그' },
];

export function StockDetailWorkspace({
  stock,
  radarRun,
  research,
  initialTab = 'overview',
  initialEventsScope = 'focus',
}: {
  stock: StockDetail;
  radarRun: RadarRun;
  research: ResearchControls;
  initialTab?: DetailTab;
  initialEventsScope?: 'focus' | 'all';
}) {
  // Reset company-specific selections when navigating between stocks.
  return (
    <Workspace
      key={stock.code}
      stock={stock}
      radarRun={radarRun}
      research={research}
      initialTab={initialTab}
      initialEventsScope={initialEventsScope}
    />
  );
}

function Workspace({
  stock,
  radarRun,
  research,
  initialTab,
  initialEventsScope,
}: {
  stock: StockDetail;
  radarRun: RadarRun;
  research: ResearchControls;
  initialTab: DetailTab;
  initialEventsScope: 'focus' | 'all';
}) {
  const queryPointId = useSearchParams().get('thesis') ?? undefined;
  const [activeTab, setActiveTab] = useState<DetailTab>(
    !research.item &&
      (initialTab === 'thesis' ||
        initialTab === 'research' ||
        initialTab === 'kpis' ||
        initialTab === 'journal' ||
        initialTab === 'financials' ||
        initialTab === 'events')
      ? 'overview'
      : initialTab,
  );
  const [selectedLens, setSelectedLens] = useState<Lens>(
    stock.radar.primary_lens,
  );
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>(
    research.item ? 'thesis' : 'radar',
  );
  const [thesisDirty, setThesisDirty] = useState(false);
  const [aiDraftDirty, setAiDraftDirty] = useState(false);
  const [updatedThesis, setUpdatedThesis] = useState<InvestmentThesis | null>(
    null,
  );
  const [selectedThesis, setSelectedThesis] = useState<InvestmentThesis | null>(
    null,
  );
  const [thesisItems, setThesisItems] = useState<InvestmentThesis[] | null>(
    null,
  );
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  useThesisNavigationGuard(thesisDirty || aiDraftDirty, confirmDiscard);
  const [selectedEvent, setSelectedEvent] = useState<StockEvent | null>(null);
  const [drawer, setDrawer] = useState<'candidates' | 'evidence' | null>(null);
  const [leftVisible, setLeftVisible] = useState(true);
  const [rightVisible, setRightVisible] = useState(
    !(['documents', 'research', 'kpis', 'journal'] as DetailTab[]).includes(
      initialTab,
    ),
  );
  const [documentSummaryOpen, setDocumentSummaryOpen] = useState(false);
  const [questionMode, setQuestionMode] = useState(false);
  // Both reading workspaces keep stock information accessible in the compact header.
  const readingDocument =
    activeTab === 'documents' || (activeTab === 'thesis' && questionMode);
  const showStockSummary = !readingDocument || documentSummaryOpen;
  const warnings = [
    ...new Set([...(stock.warnings ?? []), ...stock.radar.warnings]),
  ];
  const candidateRail = (
    <CandidateRail
      stock={stock}
      radarRun={radarRun}
      research={
        thesisItems
          ? {
              ...research,
              items: research.items.map((item) =>
                item.code === stock.code
                  ? {
                      ...item,
                      thesis: {
                        count: thesisItems.filter((t) => !t.archived).length,
                        title: thesisItems.find((t) => !t.archived)
                          ? thesisTitle(
                              thesisItems.find((t) => !t.archived)!.content,
                            )
                          : null,
                      },
                    }
                  : item,
              ),
            }
          : research
      }
    />
  );
  const evidenceRail = (
    <EvidenceRail
      stock={stock}
      radarRun={radarRun}
      warnings={warnings}
      tab={evidenceTab}
      onTabChange={setEvidenceTab}
      lens={selectedLens}
      onLensChange={setSelectedLens}
      event={selectedEvent}
      registered={Boolean(research.item)}
      selectedThesis={selectedThesis}
      thesisDirty={thesisDirty}
      onAiDraftDirty={setAiDraftDirty}
      onThesisAdopt={(item) => {
        setActiveTab('thesis');
        setDrawer(null);
        setSelectedThesis(item);
        setUpdatedThesis(item);
        setThesisItems(
          (prior) => prior?.map((p) => (p.id === item.id ? item : p)) ?? null,
        );
      }}
    />
  );
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {discardDialog}
      {leftVisible && (
        <aside className="hidden w-[216px] shrink-0 flex-col border-r bg-sidebar xl:flex">
          {candidateRail}
        </aside>
      )}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className={`shrink-0 border-b bg-card px-4 sm:px-6 ${readingDocument ? 'py-2' : 'py-3'}`}
        >
          <div
            className={`flex items-center justify-between gap-2 ${showStockSummary ? 'mb-3' : ''}`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden xl:inline-flex"
                aria-label={leftVisible ? '후보 패널 접기' : '후보 패널 펼치기'}
                aria-expanded={leftVisible}
                onClick={() => setLeftVisible(!leftVisible)}
              >
                <PanelLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="xl:hidden"
                aria-label="후보 패널 열기"
                onClick={() => setDrawer('candidates')}
              >
                <PanelLeft />
              </Button>
              <Link
                href={
                  stock.radar.discovery === 'manual' ? '/watchlist' : '/radar'
                }
                className={`text-[11px] text-muted-foreground hover:text-primary ${readingDocument ? 'hidden sm:inline' : ''}`}
              >
                {stock.radar.discovery === 'manual' ? '관심종목' : 'Radar'}
              </Link>
              {readingDocument ? (
                <h1
                  className="truncate text-sm font-semibold"
                  title={`${stock.name} · ${stock.code}`}
                >
                  {stock.name}
                  <span className="ml-2 hidden text-[10px] font-normal text-muted-foreground sm:inline">
                    {stock.code}
                  </span>
                </h1>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  / 종목 검토
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {readingDocument && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={documentSummaryOpen}
                  aria-controls="stock-summary"
                  onClick={() => setDocumentSummaryOpen(!documentSummaryOpen)}
                >
                  종목 정보
                  <ChevronDown
                    className={`size-3.5 transition-transform ${documentSummaryOpen ? 'rotate-180' : ''}`}
                  />
                  {(research.error ||
                    ['partial', 'error'].includes(
                      research.item?.job?.state ?? '',
                    )) && (
                    <span
                      className="size-1.5 rounded-full bg-amber-500"
                      aria-label="자료 상태 확인 필요"
                    />
                  )}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="hidden lg:inline-flex"
                onClick={() => {
                  if (activeTab === 'financials') {
                    setEvidenceTab('sources');
                    setDrawer('evidence');
                    return;
                  }
                  setRightVisible(true);
                  setEvidenceTab('sources');
                }}
              >
                <Database className="size-3.5" />
                데이터 확인
                {warnings.length ? (
                  <span className="size-1.5 rounded-full bg-amber-500" />
                ) : null}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className={
                  activeTab === 'financials'
                    ? 'hidden'
                    : 'hidden lg:inline-flex'
                }
                aria-label={
                  rightVisible ? '근거 패널 접기' : '근거 패널 펼치기'
                }
                aria-expanded={rightVisible}
                onClick={() => setRightVisible(!rightVisible)}
              >
                <PanelRight />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="lg:hidden"
                onClick={() => setDrawer('evidence')}
              >
                <PanelRight />
                근거·출처
              </Button>
            </div>
          </div>
          <div
            id="stock-summary"
            hidden={!showStockSummary}
            className={
              showStockSummary
                ? 'flex flex-wrap items-start justify-between gap-x-4 gap-y-2'
                : 'hidden'
            }
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className="text-2xl font-semibold tracking-tight"
                  role={readingDocument ? undefined : 'heading'}
                  aria-level={readingDocument ? undefined : 1}
                >
                  {stock.name}
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {stock.code}
                </Badge>
                {stock.radar.discovery === 'manual' && (
                  <Badge variant="outline" className="text-[9px]">
                    직접 추가
                  </Badge>
                )}
                {stock.radar.matched_lenses.map((lens) => (
                  <span
                    key={lens}
                    title={lensLabel[lens]}
                    className="grid size-5 place-items-center rounded-md text-[9px] font-semibold text-white"
                    style={{ backgroundColor: lensColor[lens] }}
                  >
                    {lensLabel[lens][0]}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {stock.market} ·{' '}
                {stock.industry || stock.sector || '업종 미확인'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold tabular-nums tracking-tight">
                {formatWon(stock.summary.latest_price)}
              </p>
              <p className="mt-1 text-[11px]">
                <span
                  className={
                    stock.summary.change_1d_pct !== null &&
                    stock.summary.change_1d_pct < 0
                      ? 'text-blue-600'
                      : 'text-rose-600'
                  }
                >
                  {formatPercent(stock.summary.change_1d_pct)}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {stock.summary.price_as_of ?? '가격 기준일 미확인'} · 전
                  거래일 대비
                </span>
              </p>
            </div>
          </div>
        </header>
        {showStockSummary && (
          <ResearchToolbar
            research={{
              ...research,
              change: async (action, initial) => {
                if (
                  action === 'remove' &&
                  thesisDirty &&
                  !(await confirmDiscard(discardThesisMessage))
                )
                  return false;
                return research.change(action, initial);
              },
            }}
          />
        )}
        <Tabs
          value={activeTab}
          onValueChange={async (value) => {
            if (
              value !== activeTab &&
              thesisDirty &&
              !(await confirmDiscard(discardThesisMessage))
            )
              return;
            setActiveTab(value as DetailTab);
            setRightVisible(
              !(
                ['documents', 'research', 'kpis', 'journal'] as DetailTab[]
              ).includes(value as DetailTab),
            );
            if (value === 'thesis') setEvidenceTab('thesis');
          }}
          className="min-h-0 flex-1 flex-col gap-0"
        >
          <div className="scrollbar-none shrink-0 overflow-x-auto border-b bg-card px-4 sm:px-6">
            <TabsList
              variant="line"
              className={`${readingDocument ? 'h-10' : 'h-12'} gap-3`}
              aria-label="종목 상세 섹션"
            >
              {tabs
                .filter(
                  (tab) =>
                    research.item ||
                    ![
                      'thesis',
                      'research',
                      'kpis',
                      'journal',
                      'documents',
                    ].includes(tab.value),
                )
                .map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    disabled={
                      !research.item &&
                      (tab.value === 'financials' || tab.value === 'events')
                    }
                    className="px-1 text-xs data-active:text-primary after:bg-primary"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
            </TabsList>
          </div>
          <div
            className={`min-h-0 flex-1 overflow-hidden ${readingDocument ? 'p-2' : 'p-3 sm:p-4'}`}
          >
            <TabsContent
              value="documents"
              className="h-full min-h-0 overflow-hidden"
            >
              {research.item && (
                <div className="flex h-full min-h-0 flex-col">
                  <a
                    href={`/stocks/${stock.code}/pdf`}
                    className="mb-2 shrink-0 text-xs text-primary underline"
                  >
                    리포트·IR PDF 첨부 및 열람 →
                  </a>
                  <div className="min-h-0 flex-1">
                    <FilingDocumentWorkspace code={stock.code} />
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent
              value="thesis"
              className="h-full min-h-0 overflow-hidden"
            >
              {research.item && (
                <ThesisWorkspace
                  key={
                    updatedThesis
                      ? `${updatedThesis.id}:${updatedThesis.revision}`
                      : 'initial'
                  }
                  code={stock.code}
                  onDirty={setThesisDirty}
                  onSelect={setSelectedThesis}
                  onItems={setThesisItems}
                  confirmDiscard={confirmDiscard}
                  preferredPointId={updatedThesis?.id ?? queryPointId}
                  preferredCheckId={updatedThesis?.content.checks.at(-1)?.id}
                  onQuestionMode={setQuestionMode}
                  onRequestAi={() => {
                    setEvidenceTab('questions');
                    setRightVisible(true);
                    if (window.innerWidth < 1024) setDrawer('evidence');
                  }}
                  onRequestEvidence={() => {
                    setEvidenceTab('thesis');
                    setRightVisible(true);
                    if (window.innerWidth < 1024) setDrawer('evidence');
                  }}
                />
              )}
            </TabsContent>
            <TabsContent
              value="research"
              className="h-full min-h-0 overflow-hidden"
            >
              {research.item && <ResearchView stock={stock} />}
            </TabsContent>
            <TabsContent
              value="kpis"
              className="h-full min-h-0 overflow-hidden"
            >
              {research.item && <KpiWorkspace code={stock.code} />}
            </TabsContent>
            <TabsContent
              value="journal"
              className="h-full min-h-0 overflow-hidden"
            >
              {research.item && <JournalWorkspace code={stock.code} />}
            </TabsContent>
            <TabsContent value="overview" className="h-full overflow-y-auto">
              <OverviewPanel
                stock={stock}
                onFinancials={() => {
                  if (research.item) setActiveTab('financials');
                  else void research.change('register');
                }}
              />
            </TabsContent>
            <TabsContent value="financials" className="h-full overflow-hidden">
              <FinancialExplorer stock={stock} />
            </TabsContent>
            <TabsContent value="price" className="h-full overflow-y-auto">
              <PricePanel stock={stock} />
            </TabsContent>
            <TabsContent value="events" className="h-full overflow-y-auto">
              <EventsPanel
                initialScope={initialEventsScope}
                stock={stock}
                selected={selectedEvent}
                onSelect={(event) => {
                  setSelectedEvent(event);
                  setEvidenceTab('filing');
                  setRightVisible(true);
                  if (window.matchMedia('(max-width: 1023px)').matches)
                    setDrawer('evidence');
                }}
              />
            </TabsContent>
          </div>
        </Tabs>
      </main>
      {rightVisible && activeTab !== 'financials' && (
        <aside className="hidden w-[304px] shrink-0 flex-col overflow-hidden border-l bg-card lg:flex 2xl:w-[336px]">
          {evidenceRail}
        </aside>
      )}
      <Sheet
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open) setDrawer(null);
        }}
      >
        <SheetContent
          side={drawer === 'candidates' ? 'left' : 'right'}
          className="gap-0 p-0"
        >
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>
              {drawer === 'candidates' ? 'Radar 후보' : '검토 근거'}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {stock.name} ·{' '}
              {drawer === 'candidates'
                ? '다른 종목으로 이동'
                : '원문·계산 기준·미확인 자료'}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            {drawer === 'candidates' ? candidateRail : evidenceRail}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ResearchToolbar({ research }: { research: ResearchControls }) {
  const running =
    research.item?.job &&
    ['queued', 'running'].includes(research.item.job.state);
  return (
    <div className="shrink-0 border-b bg-primary/[0.035] px-4 py-2.5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-medium">
            {running ? (
              <LoaderCircle className="size-3.5 animate-spin text-primary" />
            ) : (
              <Star
                className={`size-3.5 ${research.item ? 'fill-primary text-primary' : 'text-muted-foreground'}`}
              />
            )}
            {research.item
              ? research.item.job
                ? researchStateLabel[research.item.job.state]
                : '관심종목에 저장됨'
              : 'Radar 후보 · 기본 자료'}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {research.item
              ? (research.item.job?.step ?? '검토할 자료를 보강합니다.')
              : '관심종목으로 등록하면 상세 재무·현금흐름·공시를 채웁니다.'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!research.item ? (
            <Button
              size="sm"
              disabled={research.busy}
              onClick={() => void research.change('register')}
            >
              <Star />
              {research.busy ? '등록 중' : '관심종목 등록'}
            </Button>
          ) : (
            <>
              {research.item.job &&
                ['partial', 'error'].includes(research.item.job.state) && (
                  <Button
                    size="sm"
                    disabled={research.busy || Boolean(running)}
                    onClick={() => void research.change('retry')}
                  >
                    미확인 자료 재시도
                  </Button>
                )}
              <Button
                size="sm"
                variant="outline"
                disabled={research.busy || Boolean(running)}
                onClick={() => void research.change('refresh')}
              >
                <RefreshCw />
                자료 최신화
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={research.busy}
                onClick={() => void research.change('remove')}
                title="목록에서만 해제합니다. 기존 자료는 보존됩니다."
              >
                관심 해제
              </Button>
            </>
          )}
        </div>
      </div>
      {research.error && (
        <p role="alert" className="mt-2 text-[11px] text-amber-800">
          {research.error}
        </p>
      )}
    </div>
  );
}

function CandidateRail({
  stock,
  radarRun,
  research,
}: {
  stock: StockDetail;
  radarRun: RadarRun;
  research: ResearchControls;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'watchlist' | 'radar'>(
    research.item ? 'watchlist' : 'radar',
  );
  const sourceCandidates =
    mode === 'radar'
      ? radarRun.candidates
      : research.items.map((item) => {
          const candidate = radarRun.candidates.find(
            (candidate) => candidate.code === item.code,
          );
          return {
            code: item.code,
            name: item.name,
            market: candidate?.market ?? '관심종목',
            primary_lens: candidate?.primary_lens,
            matched_lenses: candidate?.matched_lenses ?? [],
          };
        });
  const candidates = sourceCandidates.filter((candidate) =>
    `${candidate.name} ${candidate.code}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <div className="shrink-0 border-b p-4">
        <Link
          href={stock.radar.discovery === 'manual' ? '/watchlist' : '/radar'}
          className="flex items-center gap-2 py-2 text-xs font-semibold"
        >
          <ArrowLeft className="size-4" />
          {stock.radar.discovery === 'manual'
            ? '관심종목으로 돌아가기'
            : 'Radar로 돌아가기'}
        </Link>
        {stock.radar.discovery !== 'manual' && (
          <Link
            href="/watchlist"
            className="mt-2 flex items-center gap-2 text-xs font-medium text-primary"
          >
            <Star className="size-3.5" />
            관심종목 전체 보기
          </Link>
        )}
        <div className="mt-2 flex gap-1">
          <Link
            href="/compare"
            className="flex flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] text-muted-foreground hover:bg-slate-100 hover:text-foreground"
          >
            <GitCompareArrows className="size-3" /> 기업 비교
          </Link>
          <Link
            href="/learning"
            className="flex flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] text-muted-foreground hover:bg-slate-100 hover:text-foreground"
          >
            <BookOpen className="size-3" /> Learning
          </Link>
        </div>
        <ResearchTools />
        <div className="mt-3">
          <Choices
            label="종목 목록"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'watchlist', label: `관심 ${research.items.length}` },
              { value: 'radar', label: 'Radar' },
            ]}
          />
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-3 size-3.5 text-muted-foreground" />
          <Input
            aria-label="후보 종목 검색"
            placeholder="종목명·코드"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-full rounded-xl border bg-card pl-9 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h2 className="text-xs font-semibold">
          {mode === 'radar' ? 'Radar 후보' : '관심종목'}
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {candidates.length} / {sourceCandidates.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {candidates.map((candidate) => (
          <Link
            key={candidate.code}
            href={`/stocks/${candidate.code}`}
            aria-current={candidate.code === stock.code ? 'page' : undefined}
            className={`mb-1 flex items-center gap-2.5 rounded-xl border px-3 py-3 transition ${candidate.code === stock.code ? 'border-primary/20 bg-card shadow-sm' : 'border-transparent hover:bg-card/70'}`}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{
                backgroundColor: candidate.primary_lens
                  ? lensColor[candidate.primary_lens]
                  : 'var(--muted-foreground)',
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {candidate.name}
              </span>
              <span className="mt-1 block text-[9px] text-muted-foreground">
                {candidate.code} · {candidate.market}
              </span>
              {mode === 'watchlist' && (
                <span className="mt-1 block truncate text-[9px] text-muted-foreground">
                  {research.items.find((item) => item.code === candidate.code)
                    ?.thesis?.title ?? '투자포인트 미작성'}
                </span>
              )}
            </span>
            <span className="text-[9px] font-medium text-muted-foreground">
              {candidate.matched_lenses
                .map((lens) => lensLabel[lens][0])
                .join('·')}
            </span>
          </Link>
        ))}
        {!candidates.length && (
          <p className="p-4 text-xs text-muted-foreground">
            검색 결과가 없습니다.
          </p>
        )}
      </div>
    </>
  );
}

function EvidenceRail({
  stock,
  radarRun,
  warnings,
  tab,
  onTabChange,
  lens,
  onLensChange,
  event,
  registered,
  selectedThesis,
  thesisDirty,
  onAiDraftDirty,
  onThesisAdopt,
}: {
  stock: StockDetail;
  radarRun: RadarRun;
  warnings: string[];
  tab: EvidenceTab;
  onTabChange: (tab: EvidenceTab) => void;
  lens: Lens;
  onLensChange: (lens: Lens) => void;
  event: StockEvent | null;
  registered: boolean;
  selectedThesis: InvestmentThesis | null;
  thesisDirty: boolean;
  onAiDraftDirty: (dirty: boolean) => void;
  onThesisAdopt: (item: InvestmentThesis) => void;
}) {
  const result = stock.radar.lenses[lens];
  const hasCashFlowAdjustment = stock.quarters.some(
    (quarter) => quarter.warnings?.length,
  );
  return (
    <>
      <div className="shrink-0 border-b bg-primary/[0.025] p-4">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileText className="size-4" />
          </span>
          <div>
            <h2 className="text-xs font-semibold">검토 근거</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              수치와 원문을 함께 확인
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Choices
            label="우측 검토 패널"
            value={tab}
            onChange={onTabChange}
            options={[
              ...(registered
                ? [
                    { value: 'thesis' as const, label: '내 검토' },
                    { value: 'questions' as const, label: 'AI 제안' },
                    { value: 'thesis-evidence' as const, label: 'AI 근거' },
                  ]
                : []),
              ...(stock.radar.discovery === 'manual'
                ? []
                : [{ value: 'radar' as const, label: '발견 경로' }]),
              { value: 'sources', label: '지표·출처' },
              ...(event
                ? [{ value: 'filing' as const, label: '선택 공시' }]
                : []),
            ]}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'thesis' && <ThesisContextPanel item={selectedThesis} />}
        {tab === 'questions' && (
          <ThesisAiPanel
            key={selectedThesis?.id ?? 'empty'}
            code={stock.code}
            item={selectedThesis}
            dirty={thesisDirty}
            onDraftDirty={onAiDraftDirty}
            onAdopt={onThesisAdopt}
          />
        )}
        {tab === 'thesis-evidence' && (
          <ThesisEvidenceReviewPanel
            key={selectedThesis?.id ?? 'empty'}
            code={stock.code}
            thesis={selectedThesis}
          />
        )}
        {tab === 'explain' && (
          <>
            <div className="mb-4">
              <Choices
                label="해설할 Radar 렌즈"
                value={lens}
                onChange={onLensChange}
                options={stock.radar.matched_lenses.map((value) => ({
                  value,
                  label: lensLabel[value],
                }))}
              />
            </div>
            <EvidenceAiPanel
              key={`${stock.code}-${lens}-${stock.run_id}-${stock.generated_at}`}
              code={stock.code}
              lens={lens}
            />
          </>
        )}
        {tab === 'radar' && (
          <>
            <Choices
              label="Radar 렌즈"
              value={lens}
              onChange={onLensChange}
              options={stock.radar.matched_lenses.map((value) => ({
                value,
                label: lensLabel[value],
              }))}
            />
            <div className="my-4 flex items-end justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground">발견 렌즈</p>
                <p
                  className="mt-1 text-lg font-semibold"
                  style={{ color: lensColor[lens] }}
                >
                  {lensLabel[lens]}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground">
                자료 커버리지 {result.coverage_pct}%
              </p>
            </div>
            <section className="rounded-xl border bg-muted/40 p-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold">
                <ShieldAlert className="size-3.5" />
                반대 근거·확인 사항
              </h3>
              {result.contradictions.length ? (
                result.contradictions.map((text, index) => (
                  <p
                    key={index}
                    className="mt-2 text-[11px] leading-5 text-muted-foreground"
                  >
                    {text}
                  </p>
                ))
              ) : (
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  구조화된 반대 근거가 없습니다. 위험이 없다는 뜻은 아닙니다.
                </p>
              )}
            </section>
            <h3 className="mb-2 mt-5 text-[10px] font-semibold text-muted-foreground">
              선정 당시 근거 · {result.evidence.length}개
            </h3>
            {hasCashFlowAdjustment && (
              <p className="mb-3 rounded-lg bg-amber-50 p-2 text-[10px] leading-5 text-amber-900">
                상세 검증에서 일부 분기 현금흐름을 미확인으로 처리했습니다.
                아래는 기존 Radar 실행 당시의 기록이며, 현금흐름 관련 근거는
                원문 재확인이 필요합니다.
              </p>
            )}
            <div className="space-y-2">
              {result.evidence.map((item, i) => (
                <EvidenceItem key={`${item.key}-${i}`} item={item} />
              ))}
            </div>
          </>
        )}
        {tab === 'sources' && (
          <SourcesPanel stock={stock} radarRun={radarRun} />
        )}
        {tab === 'filing' && event && <FilingPanel event={event} />}
        {(['radar', 'sources', 'filing'] as EvidenceTab[]).includes(tab) &&
          warnings.length > 0 && (
            <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <h3 className="text-[11px] font-semibold text-amber-900">
                자료 범위·주의
              </h3>
              {warnings.map((warning, index) => (
                <p
                  key={index}
                  className="mt-2 text-[10px] leading-5 text-amber-950/75"
                >
                  {warning}
                </p>
              ))}
            </section>
          )}
      </div>
      <p className="shrink-0 border-t px-4 py-3 text-[9px] leading-4 text-muted-foreground">
        {tab === 'thesis'
          ? '투자포인트와 검토 기록은 자료 갱신과 별도로 보존됩니다.'
          : tab === 'questions'
            ? '요청 버튼을 누를 때 선택한 투자포인트 저장본만 전송됩니다.'
            : tab === 'thesis-evidence'
              ? '선택한 투자포인트와 연결 자료 snapshot만 전송됩니다.'
              : tab === 'explain'
                ? 'AI 해석과 원자료를 구분해 확인하세요. 선정 근거 설명은 투자 판단이나 현재 조건 통과 여부를 뜻하지 않습니다.'
                : 'Radar는 후보 발견 도구입니다. 원자료와 규칙 기반 확인 사항은 AI 분석 결과가 아닙니다.'}
      </p>
    </>
  );
}

function EvidenceItem({ item }: { item: RadarEvidence }) {
  const url = typeof item.value === 'string' ? safeSourceUrl(item.value) : null;
  const body = (
    <>
      <span className="mt-0.5 text-primary">
        {url ? (
          <ArrowUpRight className="size-3.5" />
        ) : (
          <CheckCircle2 className="size-3.5" />
        )}
      </span>
      <span>
        <span className="block text-[11px] font-medium leading-5">
          {item.label.replaceAll('EV/EBITDA', 'EV/영업이익(근사)')}
        </span>
        <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
          {item.period} · {item.source}
        </span>
      </span>
    </>
  );
  const className = 'flex items-start gap-2 rounded-xl border bg-card p-3';
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`${className} hover:border-primary/30`}
    >
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

function SourcesPanel({
  stock,
  radarRun,
}: {
  stock: StockDetail;
  radarRun: RadarRun;
}) {
  const v = stock.valuation;
  const labels: Record<string, string> = {
    prices: '가격 이력',
    financials: '재무제표',
    dart_events: '수집 공시',
  };
  const statuses: Record<string, string> = {
    ok: '수집됨',
    partial: '일부 확인',
    missing: '자료 없음',
    error: '수집 실패',
    stale: '이전 자료',
  };
  const metrics = [
    [
      'PER',
      formatMultiple(v.per),
      v.attribution_basis === 'parent'
        ? '시가총액 ÷ 최근 4분기 지배주주 순이익'
        : v.attribution_basis === 'total'
          ? '시가총액 ÷ 최근 4분기 전체 순이익 · 참고 배수'
          : '기존 수집 배수 · 상세 재무 갱신 후 기준 재확인',
    ],
    [
      'PBR',
      formatMultiple(v.pbr),
      v.attribution_basis === 'parent'
        ? '시가총액 ÷ 최근 지배주주 자본'
        : v.attribution_basis === 'total'
          ? '시가총액 ÷ 최근 자본총계 · 참고 배수'
          : '기존 수집 배수 · 상세 재무 갱신 후 기준 재확인',
    ],
    [
      v.roe_basis === 'average' ? 'ROE · 평균 자본' : 'ROE · 기말 자본',
      displayNumber(v.ttm_roe_pct, '%'),
      v.roe_basis === 'average'
        ? '최근 4분기 순이익 ÷ 기초·기말 평균자본 · 연결은 지배주주 기준'
        : '최근 4분기 순이익 ÷ 기말 자본. 평균 자본 기준 아님',
    ],
    [
      '부채비율',
      displayNumber(v.debt_ratio_pct, '%'),
      '최근 기말 부채총계 ÷ 자본',
    ],
    [
      v.interest_basis === 'interest'
        ? '이자비용 커버리지'
        : '금융비용 커버리지',
      formatMultiple(v.interest_coverage),
      v.interest_basis === 'interest'
        ? '최근 4분기 영업이익 ÷ 이자비용. 금융비용 전체로 대체하지 않음'
        : '최근 4분기 영업이익 ÷ 기존 수집 금융비용. 이자비용만의 배율과 다를 수 있음',
    ],
    [
      'EV / 영업이익 · 근사',
      formatMultiple(v.ev_operating_profit ?? null),
      '(시가총액 + 수집 차입금 − 현금) ÷ 최근 4분기 영업이익. EBITDA 배율 아님; 차입금 항목 누락 가능',
    ],
  ];
  return (
    <>
      <h3 className="text-xs font-semibold">밸류에이션·재무 안정성</h3>
      <dl className="mt-2 divide-y">
        {metrics.map(([label, value, formula]) => (
          <div key={label} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[11px]">{label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{value}</dd>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {formula}
            </p>
          </div>
        ))}
      </dl>
      <h3 className="mb-2 mt-5 text-xs font-semibold">데이터 출처</h3>
      <div className="space-y-2">
        {Object.entries(stock.source_status).map(([key, status]) => (
          <section key={key} className="rounded-xl border p-3">
            <div className="flex justify-between gap-2">
              <h4 className="text-[11px] font-medium">
                {labels[key] ?? '추가 자료'}
              </h4>
              <span
                className={`text-[10px] ${status.status === 'ok' ? 'text-muted-foreground' : 'text-amber-700'}`}
              >
                {statuses[status.status] ?? '상태 확인 필요'}
              </span>
            </div>
            <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
              {status.source ?? '출처 미기록'}
              <br />
              기준 {status.as_of ?? '별도 기준일 미기록'} ·{' '}
              {status.record_count ?? status.quarter_count ?? 0}
              {key === 'financials' ? '분기' : '건'}
              <br />
              연결 실행 {status.collected_at ?? stock.collected_at ?? '미기록'}
            </p>
            {status.warning && (
              <p className="mt-2 text-[10px] leading-4 text-amber-800">
                {status.warning}
              </p>
            )}
          </section>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-muted/50 p-3 text-[10px] leading-5 text-muted-foreground">
        <p className="break-all">등록 당시 Radar {stock.run_id ?? '미기록'}</p>
        {stock.research_run_id && (
          <p className="mt-1 break-all">
            상세 보강 실행 {stock.research_run_id}
          </p>
        )}
        <p className="mt-1">
          화면 자료 생성 {stock.generated_at}
          <br />
          자료 생성일은 원자료의 기준일과 다릅니다.
        </p>
        {stock.run_id && stock.run_id !== radarRun.run_id && (
          <p className="mt-2 text-amber-800">
            등록 당시 Radar 근거를 보존하고 있습니다. 현재 Radar 결과와 달라도
            관심종목과 상세 자료는 유지됩니다.
          </p>
        )}
        <a
          href={
            stock.data_level === 'research'
              ? `/api/watchlist/${stock.code}`
              : `/data/radar/stocks/${stock.code}.json`
          }
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-primary"
        >
          이 화면의 원자료 보기 <ExternalLink className="size-3" />
        </a>
      </div>
      {stock.quarters.some((quarter) => quarter.source_url) && (
        <section className="mt-5">
          <h3 className="mb-2 text-xs font-semibold">분기별 재무 원문</h3>
          <div className="divide-y">
            {[...stock.quarters].reverse().map((quarter) => (
              <div
                key={`${quarter.year}-${quarter.quarter}`}
                className="flex items-center justify-between py-2.5 text-[10px]"
              >
                <span>
                  {quarter.year} {quarter.quarter} ·{' '}
                  {quarter.statement_basis === 'CFS'
                    ? '연결'
                    : quarter.statement_basis === 'OFS'
                      ? '별도'
                      : '기준 미확인'}
                </span>
                {safeSourceUrl(quarter.source_url ?? null) ? (
                  <a
                    href={safeSourceUrl(quarter.source_url ?? null)!}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-primary"
                  >
                    DART 원문 <ExternalLink className="size-3" />
                  </a>
                ) : (
                  <span className="text-muted-foreground">원문 미확인</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function FilingPanel({ event }: { event: StockEvent }) {
  const classification = classifyFiling(event);
  const category = classification.category;
  const url = safeSourceUrl(event.url);
  return (
    <>
      <Badge variant="secondary" className="text-[10px]">
        {eventCategories[category]}
      </Badge>
      <p className="mt-3 text-[10px] text-muted-foreground">
        DART · {eventDate(event.date)}
      </p>
      <h3 className="mt-2 text-sm font-semibold leading-6">
        {event.title ?? '제목 미확인'}
      </h3>
      <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
        공시 제목 기반 분류입니다. 본문을 분석한 중요도 판단이 아니며, 실제
        내용과 영향은 원문 확인이 필요합니다.
      </p>
      <div className="mt-3 rounded-xl bg-muted/50 p-3 text-[11px] leading-5">
        <p className="font-medium">
          {classification.priority === 'focus'
            ? '우선 확인에 포함한 이유'
            : classification.priority === 'reference'
              ? '전체 공시에서 확인'
              : '분류 미확인'}
        </p>
        <p className="mt-1 text-muted-foreground">{classification.reason}</p>
        {classification.amendment && (
          <p className="mt-2 text-primary">
            {classification.amendment} 공시입니다. 원문에서 변경 사항과 기존
            공시를 대조하세요. 같은 제목의 공시도 별도로 유지합니다.
          </p>
        )}
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex items-center justify-between rounded-xl bg-primary px-4 py-3 text-xs font-medium text-primary-foreground"
        >
          공시 원문 열기 <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <p className="mt-4 rounded-xl border border-amber-200 p-3 text-xs text-amber-800">
          원문 링크가 누락되어 있습니다.
        </p>
      )}
      <section className="mt-6">
        <h4 className="text-xs font-semibold">원문에서 확인할 사항</h4>
        <ol className="mt-3 space-y-3">
          {eventChecks[category].map((check, index) => (
            <li key={check} className="flex gap-2 text-[11px] leading-5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px]">
                {index + 1}
              </span>
              <span>{check}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[10px] text-muted-foreground">
          유형별 고정 체크리스트 · AI 분석 아님
        </p>
      </section>
    </>
  );
}
