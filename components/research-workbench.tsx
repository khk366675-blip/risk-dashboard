'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  Inbox,
  GitCompareArrows,
  PanelRight,
  Plus,
  Radar,
  RefreshCw,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ManualWatchlistDialog } from '@/components/manual-watchlist-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  thesisReviewStates,
  updateKindLabels,
  type ResearchUpdateItem,
  type ResearchWorkbench as WorkbenchData,
  type WorkbenchStock,
} from '@/lib/research-workbench';
import { sourceStateLabels } from '@/lib/research-followup';
import { formatPercent, formatWon } from '@/lib/stock-detail';

type Section = 'watchlist' | 'updates';

const sectionItems = [
  { key: 'watchlist' as const, label: '관심종목', icon: Star },
  { key: 'updates' as const, label: '업데이트', icon: Inbox },
];

async function readJson(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || '관심종목 자료를 처리하지 못했습니다.');
  return result;
}

function when(value: string | null) {
  if (!value) return '시점 미확인';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function sourceState(value: string) {
  if (value === 'first_review') return '비교 기준 없음';
  return sourceStateLabels[value] ?? '상태 확인 필요';
}

export function ResearchWorkbench({
  initialData,
  initialError = null,
}: {
  initialData: WorkbenchData;
  initialError?: string | null;
}) {
  const router = useRouter();
  const initialUpdate =
    initialData.updates.find((item) => item.state === 'open') ??
    initialData.updates[0] ??
    null;
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<Section>('watchlist');
  const [query, setQuery] = useState('');
  const [updateScope, setUpdateScope] = useState<'open' | 'all'>('open');
  const [selectedUpdateKey, setSelectedUpdateKey] = useState(
    initialUpdate?.key ?? null,
  );
  const [updateNote, setUpdateNote] = useState(initialUpdate?.note ?? '');
  const [drawer, setDrawer] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const result = (await readJson(
        await fetch('/api/watchlist/workbench', { cache: 'no-store' }),
      )) as WorkbenchData;
      setData(result);
      setError(null);
      return result;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : '관심종목 자료를 다시 읽지 못했습니다.',
      );
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const selectedUpdate =
    data.updates.find((item) => item.key === selectedUpdateKey) ?? null;
  const selectedStock =
    data.stocks.find((stock) => stock.code === selectedUpdate?.code) ?? null;

  const filteredStocks = data.stocks.filter((stock) =>
    `${stock.name} ${stock.code}`
      .toLocaleLowerCase('ko-KR')
      .includes(query.trim().toLocaleLowerCase('ko-KR')),
  );
  const filteredUpdates = data.updates.filter(
    (item) =>
      (updateScope === 'all' || item.state === 'open') &&
      `${item.name} ${item.code} ${item.title}`
        .toLocaleLowerCase('ko-KR')
        .includes(query.trim().toLocaleLowerCase('ko-KR')),
  );

  const patchUpdate = async (state: 'open' | 'reviewed') => {
    if (!selectedUpdate || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await readJson(
        await fetch('/api/watchlist/workbench', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'update',
            item_key: selectedUpdate.key,
            status: state,
            note: updateNote,
          }),
        }),
      );
      await reload();
      setNotice(
        state === 'reviewed'
          ? '해당 업데이트를 확인 완료로 표시했습니다.'
          : '다시 확인할 항목으로 되돌렸습니다.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : '저장하지 못했습니다.',
      );
      setBusy(false);
    }
  };

  const acknowledgeBaseline = async () => {
    if (!selectedStock || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await readJson(
        await fetch(`/api/watchlist/${selectedStock.code}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: selectedStock.followup.revision }),
        }),
      );
      await reload();
      setNotice(
        `${selectedStock.name}: 현재 자료를 다음 변화 비교 기준으로 저장했습니다.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : '현재 자료의 비교 기준을 저장하지 못했습니다.',
      );
      setBusy(false);
    }
  };

  const selectSection = (value: Section) => {
    setSection(value);
    setDrawer(false);
    setQuery('');
  };
  const selectUpdate = (item: ResearchUpdateItem) => {
    setSelectedUpdateKey(item.key);
    setUpdateNote(item.note);
    if (window.matchMedia('(max-width:1279px)').matches) setDrawer(true);
  };
  const updateDetail = (
    <UpdateDetail
      item={selectedUpdate}
      stock={selectedStock}
      note={updateNote}
      onNote={setUpdateNote}
      busy={busy}
      onState={(state) => void patchUpdate(state)}
      onBaseline={() => void acknowledgeBaseline()}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-52 shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft className="size-4" />
          Value Dashboard
        </Link>
        <p className="mt-8 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Watchlist
        </p>
        <nav className="mt-2 space-y-1">
          {sectionItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-current={section === key ? 'page' : undefined}
              onClick={() => selectSection(key)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12px] font-medium transition ${
                section === key
                  ? 'bg-primary/[0.09] text-primary'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="size-4" />
              {label}
              {key === 'updates' && data.summary.open_update_count > 0 && (
                <span className="ml-auto rounded-md bg-white px-1.5 py-0.5 text-[9px] font-semibold shadow-sm">
                  {data.summary.open_update_count}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-1 border-t pt-4">
          <Link
            href="/markets"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] text-slate-600 hover:bg-slate-100"
          >
            <CircleDot className="size-4" /> Markets
          </Link>
          <Link
            href="/radar"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] text-slate-600 hover:bg-slate-100"
          >
            <Radar className="size-4" /> Radar
          </Link>
          <Link
            href="/compare"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] text-slate-600 hover:bg-slate-100"
          >
            <GitCompareArrows className="size-4" /> 기업 비교
          </Link>
          <Link
            href="/learning"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] text-slate-600 hover:bg-slate-100"
          >
            <BookOpen className="size-4" /> Learning
          </Link>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b bg-card px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link
                href="/markets"
                className="mb-2 block text-[10px] text-muted-foreground md:hidden"
              >
                ← Markets
              </Link>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {section === 'watchlist' ? '관심종목' : '전체 업데이트'}
              </h1>
            </div>
            <div className="flex items-center gap-1">
              {section === 'watchlist' && (
                <Button size="sm" onClick={() => setManualOpen(true)}>
                  <Plus />
                  <span className="hidden sm:inline">종목 직접 추가</span>
                  <span className="sm:hidden">추가</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void reload()}
              >
                <RefreshCw className={busy ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">상태 확인</span>
              </Button>
              {section === 'updates' && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="xl:hidden"
                  aria-label="업데이트 상세 패널 열기"
                  onClick={() => setDrawer(true)}
                >
                  <PanelRight />
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 grid max-w-sm grid-cols-2 gap-2">
            <Metric label="관심종목" value={data.summary.stock_count} />
            <Metric
              label="새 확인"
              value={data.summary.open_update_count}
              tone={data.summary.open_update_count ? 'primary' : 'default'}
            />
          </div>

          <div className="mt-4 flex gap-1 md:hidden" aria-label="관심종목 메뉴">
            {sectionItems.map(({ key, label, icon: Icon }) => (
              <Button
                key={key}
                size="sm"
                variant={section === key ? 'secondary' : 'ghost'}
                onClick={() => selectSection(key)}
              >
                <Icon /> {label}
              </Button>
            ))}
          </div>

          <Input
            className="mt-3 max-w-sm bg-background text-xs"
            aria-label="관심종목 검색"
            placeholder={
              section === 'watchlist'
                ? '관심종목명·코드 검색'
                : '종목명·코드·업데이트 검색'
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </header>

        {error && (
          <p
            role="alert"
            className="shrink-0 border-b bg-rose-50 px-6 py-2 text-[11px] text-rose-800"
          >
            {error}
          </p>
        )}
        {notice && (
          <output className="shrink-0 border-b bg-primary/5 px-6 py-2 text-[11px] text-primary">
            {notice}
          </output>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {section === 'watchlist' ? (
            <WatchlistView stocks={filteredStocks} updates={data.updates} />
          ) : (
            <UpdatesView
              items={filteredUpdates}
              scope={updateScope}
              onScope={setUpdateScope}
              selectedKey={selectedUpdate?.key ?? null}
              onSelect={selectUpdate}
            />
          )}
        </div>

        <footer className="shrink-0 border-t px-4 py-2 text-[9px] leading-4 text-muted-foreground sm:px-6">
          가격·재무·공시의 기준일과 원문은 종목 상세에서 확인할 수 있습니다.
        </footer>
      </main>

      {section === 'updates' && (
        <aside className="hidden w-[360px] shrink-0 overflow-hidden border-l bg-card xl:block 2xl:w-[400px]">
          {updateDetail}
        </aside>
      )}
      {manualOpen && (
        <ManualWatchlistDialog
          key="manual-watchlist-open"
          open
          onOpenChange={setManualOpen}
          existingCodes={data.stocks.map((stock) => stock.code)}
          onAdded={(code) => router.push(`/stocks/${code}?tab=thesis`)}
        />
      )}
      {section === 'updates' && (
        <Sheet open={drawer} onOpenChange={setDrawer}>
          <SheetContent className="w-full gap-0 overflow-hidden p-0 sm:max-w-[520px]">
            <SheetHeader className="sr-only">
              <SheetTitle>업데이트 상세</SheetTitle>
              <SheetDescription>
                선택한 업데이트의 출처와 검토 상태입니다.
              </SheetDescription>
            </SheetHeader>
            {updateDetail}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'primary';
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${tone === 'primary' ? 'border-primary/20 bg-primary/[0.04]' : 'bg-background'}`}
    >
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === 'primary' ? 'text-primary' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyView({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Check className="size-5" />
        </span>
        <h2 className="mt-4 text-sm font-semibold">{title}</h2>
        <p className="mt-2 text-[11px] leading-6 text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}

function WatchlistView({
  stocks,
  updates,
}: {
  stocks: WorkbenchStock[];
  updates: ResearchUpdateItem[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 py-3 sm:px-6">
        <h2 className="text-sm font-semibold">내 관심종목</h2>
        <p className="mt-1 text-[10px] text-muted-foreground">
          가격·재무·공시·투자포인트는 종목 상세에서 확인합니다.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {!stocks.length ? (
          <EmptyView
            title="관심종목이 없습니다"
            body="Radar 후보를 관심종목으로 등록하면 이곳에 종목 목록이 표시됩니다."
          />
        ) : (
          <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border bg-card">
            {stocks.map((stock) => {
              const openUpdates = updates.filter(
                (item) => item.code === stock.code && item.state === 'open',
              ).length;
              const evidence = stock.theses.reduce(
                (sum, thesis) => sum + thesis.evidence.total,
                0,
              );
              const thesisTitle =
                stock.theses[0]?.content.title ||
                stock.theses[0]?.content.body.split('\n')[0] ||
                '투자포인트 미작성';
              return (
                <Link
                  key={stock.code}
                  href={`/stocks/${stock.code}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-4 transition last:border-0 hover:bg-muted/35 sm:grid-cols-[minmax(190px,1.2fr)_120px_minmax(170px,1fr)_auto] sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {stock.name}
                      </span>
                      {openUpdates > 0 && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-200 bg-amber-50 text-[9px] text-amber-800"
                        >
                          새 확인 {openUpdates}
                        </Badge>
                      )}
                      {stock.followup.discovery === 'manual' && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[9px] text-muted-foreground"
                        >
                          직접 추가
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {stock.code}
                    </span>
                  </span>
                  <span className="text-right sm:text-left">
                    <span className="block text-xs font-semibold tabular-nums">
                      {formatWon(stock.followup.price.close)}
                    </span>
                    <span className="mt-1 block text-[10px] tabular-nums text-muted-foreground">
                      {formatPercent(stock.followup.price.change1d)}
                    </span>
                  </span>
                  <span className="col-span-2 min-w-0 border-t pt-3 sm:col-span-1 sm:border-0 sm:pt-0">
                    <span className="block truncate text-[11px] font-medium">
                      {thesisTitle}
                    </span>
                    <span className="mt-1 block text-[9px] text-muted-foreground">
                      투자포인트 {stock.theses.length} · 연결 자료 {evidence}
                    </span>
                  </span>
                  <span className="hidden items-center gap-1 text-[10px] font-medium text-primary sm:flex">
                    상세 보기
                    <ChevronRight className="size-4 transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function UpdatesView({
  items,
  scope,
  onScope,
  selectedKey,
  onSelect,
}: {
  items: ResearchUpdateItem[];
  scope: 'open' | 'all';
  onScope: (value: 'open' | 'all') => void;
  selectedKey: string | null;
  onSelect: (item: ResearchUpdateItem) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold">새로 달라진 자료</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            마지막 검토 이후의 공시·재무·원문·자료 상태
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            size="xs"
            variant={scope === 'open' ? 'secondary' : 'ghost'}
            onClick={() => onScope('open')}
          >
            미검토
          </Button>
          <Button
            size="xs"
            variant={scope === 'all' ? 'secondary' : 'ghost'}
            onClick={() => onScope('all')}
          >
            전체
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!items.length ? (
          <EmptyView
            title="현재 조건의 업데이트가 없습니다"
            body="종목 상세에서 자료 최신화를 실행하거나 전체 보기에서 이전 항목을 확인할 수 있습니다."
          />
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item)}
                className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left transition hover:bg-muted/40 sm:px-6 ${selectedKey === item.key ? 'bg-primary/[0.035]' : ''}`}
              >
                <span
                  className={`size-2 rounded-full ${item.state === 'reviewed' ? 'bg-slate-300' : item.priority === 'attention' ? 'bg-amber-500' : 'bg-primary'}`}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium text-primary">
                      {updateKindLabels[item.kind]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {item.name} · {item.code}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs font-semibold">
                    {item.title}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                    {item.summary}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-[9px] text-muted-foreground">
                    {when(item.occurred_at)}
                  </span>
                  {item.state === 'reviewed' && (
                    <span className="mt-1 block text-[9px] text-emerald-700">
                      확인됨
                    </span>
                  )}
                  <ChevronRight className="ml-auto mt-1 size-3 text-muted-foreground" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UpdateDetail({
  item,
  stock,
  note,
  onNote,
  busy,
  onState,
  onBaseline,
}: {
  item: ResearchUpdateItem | null;
  stock: WorkbenchStock | null;
  note: string;
  onNote: (value: string) => void;
  busy: boolean;
  onState: (state: 'open' | 'reviewed') => void;
  onBaseline: () => void;
}) {
  if (!item)
    return (
      <EmptyView
        title="업데이트를 선택하세요"
        body="새 자료의 출처와 연결된 투자포인트를 확인할 수 있습니다."
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b p-5">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">{updateKindLabels[item.kind]}</Badge>
          <span className="text-[9px] text-muted-foreground">
            {item.state === 'reviewed'
              ? `확인 ${when(item.reviewed_at)}`
              : '미검토'}
          </span>
        </div>
        <h3 className="mt-4 text-sm font-semibold leading-6">{item.title}</h3>
        <p className="mt-2 text-[11px] leading-6 text-muted-foreground">
          {item.summary}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <section className="rounded-2xl border p-4 text-[10px] leading-5">
          <p className="font-semibold">출처 추적</p>
          <dl className="mt-3 grid grid-cols-[72px_1fr] gap-y-2 text-muted-foreground">
            <dt>종목</dt>
            <dd>
              {item.name} · {item.code}
            </dd>
            <dt>출처</dt>
            <dd>{item.source_name}</dd>
            <dt>식별자</dt>
            <dd className="break-all">{item.source_id ?? '미확인'}</dd>
            <dt>상태</dt>
            <dd>{sourceState(item.source_status)}</dd>
            <dt>기준 시점</dt>
            <dd>{item.occurred_at ?? '미확인'}</dd>
          </dl>
          {item.warning && (
            <p className="mt-3 text-amber-800">{item.warning}</p>
          )}
          <Link
            href={item.href}
            className="mt-4 flex items-center gap-1 font-medium text-primary"
          >
            원자료 화면 열기 <ArrowUpRight className="size-3" />
          </Link>
        </section>

        <section>
          <h4 className="text-[11px] font-semibold">관련 투자포인트</h4>
          <div className="mt-2 space-y-2">
            {stock?.theses.length ? (
              stock.theses.map((thesis) => (
                <Link
                  key={thesis.id}
                  href={`/stocks/${item.code}?tab=thesis`}
                  className="block rounded-xl border p-3 text-[10px] hover:border-primary/30"
                >
                  <span className="font-medium">
                    {thesis.content.title || thesis.content.body.split('\n')[0]}
                  </span>
                  <span className="mt-1 block text-muted-foreground">
                    {thesisReviewStates[thesis.review.state]} · 연결 자료{' '}
                    {thesis.evidence.total}개
                  </span>
                </Link>
              ))
            ) : (
              <p className="rounded-xl border border-dashed p-3 text-[10px] text-muted-foreground">
                아직 작성한 투자포인트가 없습니다.
              </p>
            )}
          </div>
        </section>

        {item.kind !== 'first_review' && (
          <section>
            <label
              className="text-[10px] font-medium"
              htmlFor="update-review-note"
            >
              검토 메모
            </label>
            <Textarea
              id="update-review-note"
              className="mt-2 min-h-24 text-xs"
              value={note}
              onChange={(event) => onNote(event.target.value)}
              placeholder="원문 확인 결과나 다음에 볼 항목"
            />
          </section>
        )}
      </div>

      <div className="shrink-0 border-t p-4">
        {item.kind === 'first_review' ? (
          <Button
            className="w-full"
            size="sm"
            disabled={busy || !stock?.followup.canReview}
            onClick={onBaseline}
          >
            현재 자료를 다음 비교 기준으로 저장
          </Button>
        ) : (
          <Button
            className="w-full"
            size="sm"
            disabled={busy}
            variant={item.state === 'reviewed' ? 'outline' : 'default'}
            onClick={() =>
              onState(item.state === 'reviewed' ? 'open' : 'reviewed')
            }
          >
            {item.state === 'reviewed'
              ? '다시 확인할 항목으로'
              : '확인 완료로 표시'}
          </Button>
        )}
        {item.kind === 'first_review' && !stock?.followup.canReview && (
          <p className="mt-2 text-center text-[9px] text-muted-foreground">
            자료 수집이 끝나고 확인 가능한 출처가 있어야 기준을 저장할 수
            있습니다.
          </p>
        )}
      </div>
    </div>
  );
}
