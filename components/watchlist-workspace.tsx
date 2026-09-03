'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Star,
  Radar,
  RefreshCw,
  PanelRight,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { type FollowupItem } from '@/lib/research-followup';
import { formatWon, formatPercent } from '@/lib/stock-detail';
import {
  WatchlistFollowupPanel,
  checkedDate,
} from '@/components/watchlist-followup-panel';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

export function WatchlistWorkspace({
  initialItems,
  initialError = null,
  pollInterval,
}: {
  initialItems: FollowupItem[];
  initialError?: string | null;
  pollInterval: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState(initialError);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<'all' | 'changes' | 'first' | 'issues'>(
    'all',
  );
  const [selectedCode, setSelectedCode] = useState(
    initialItems[0]?.code ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rightVisible, setRightVisible] = useState(true);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let keepPolling = false;
    const read = async () => {
      if (inFlight || abort.signal.aborted) return;
      inFlight = true;
      setReading(true);
      try {
        const response = await fetch('/api/watchlist/followup', {
          cache: 'no-store',
          signal: abort.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (abort.signal.aborted) return;
        setItems(result.items);
        setError(null);
        keepPolling = result.items.some((item: FollowupItem) =>
          ['queued', 'running'].includes(item.job?.state ?? ''),
        );
      } catch (failure) {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : '목록을 확인하지 못했습니다.',
          );
      } finally {
        inFlight = false;
        if (!abort.signal.aborted) {
          setReading(false);
          if (keepPolling) timer = setTimeout(read, pollInterval);
        }
      }
    };
    void read();
    const onFocus = () => {
      clearTimeout(timer);
      void read();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      abort.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [pollInterval, revision]);
  const filtered = items.filter(
    (item) =>
      `${item.name} ${item.code}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'changes'
          ? item.hasChanges
          : filter === 'first'
            ? item.firstSections.length > 0
            : item.needsAttention)),
  );
  const selected =
    filtered.find((item) => item.code === selectedCode) ?? filtered[0] ?? null;
  const actions = async (action: 'review' | 'refresh' | 'retry') => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/watchlist/${selected.code}${action === 'review' ? '/review' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            action === 'review'
              ? { revision: selected.revision }
              : { mode: action === 'retry' ? 'retry' : 'all' },
          ),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? '요청을 완료하지 못했습니다.');
      setRevision((value) => value + 1);
      setNotice(
        action === 'review'
          ? `${selected.name}: 확인 가능한 자료를 다음 비교 기준으로 저장했습니다.`
          : `${selected.name}: 자료 수집을 요청했습니다. 완료 상태가 자동으로 반영됩니다.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : '요청에 실패했습니다.',
      );
    } finally {
      setBusy(false);
    }
  };
  const showPanel = (code: string) => {
    setSelectedCode(code);
    setRightVisible(true);
    if (window.matchMedia('(max-width:1279px)').matches) setDrawer(true);
  };
  const panel = selected && (
    <WatchlistFollowupPanel
      item={selected}
      busy={busy || reading || !!error}
      onAction={(action) => void actions(action)}
    />
  );
  const filters = [
    { value: 'all' as const, label: '전체', count: items.length },
    {
      value: 'changes' as const,
      label: '공시·실적 추가',
      count: items.filter((i) => i.hasChanges).length,
    },
    {
      value: 'first' as const,
      label: '첫 확인 필요',
      count: items.filter((i) => i.firstSections.length).length,
    },
    {
      value: 'issues' as const,
      label: '자료 점검',
      count: items.filter((i) => i.needsAttention).length,
    },
  ];
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-44 shrink-0 border-r bg-sidebar p-4 md:block">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft className="size-4" />
          Value Dashboard
        </Link>
        <nav className="mt-8 space-y-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl p-3 text-xs text-muted-foreground"
          >
            <Radar className="size-4" />
            Radar
          </Link>
          <Link
            href="/watchlist"
            aria-current="page"
            className="flex items-center gap-2 rounded-xl border bg-card p-3 text-xs font-semibold text-primary"
          >
            <Star className="size-4" />
            관심종목 <span className="ml-auto">{items.length}</span>
          </Link>
          <Link
            href="/markets"
            className="block rounded-xl p-3 text-xs text-muted-foreground"
          >
            Markets
          </Link>
        </nav>
        <p className="mt-8 text-[11px] leading-6 text-muted-foreground">
          Radar에서 발견하고
          <br />
          달라진 자료부터 확인합니다.
        </p>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b bg-card px-6 py-5">
          <Link
            href="/"
            className="mb-3 block text-xs text-muted-foreground md:hidden"
          >
            ← Radar로
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                관심종목 팔로업{' '}
                <span className="ml-1 text-muted-foreground">
                  {items.length}
                </span>
              </h1>
              <p className="mt-2 text-xs text-muted-foreground">
                새 공시, 분기 실적, 실제 가격을 한곳에서
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={reading || busy}
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw className={reading ? 'animate-spin' : ''} />
                목록 상태 확인
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={!selected}
                aria-label="검토 패널 열기 또는 접기"
                onClick={() => {
                  if (window.matchMedia('(max-width:1279px)').matches)
                    setDrawer(true);
                  else setRightVisible(!rightVisible);
                }}
              >
                <PanelRight />
              </Button>
            </div>
          </div>
          <fieldset
            className="mt-5 flex flex-wrap gap-1"
            aria-label="관심종목 필터"
          >
            {filters.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={filter === option.value ? 'secondary' : 'ghost'}
                className={
                  filter === option.value
                    ? 'text-primary'
                    : 'text-muted-foreground'
                }
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
                <span className="ml-1 tabular-nums">{option.count}</span>
              </Button>
            ))}
          </fieldset>
          <Input
            className="mt-3 max-w-sm bg-background text-xs"
            aria-label="관심종목 검색"
            placeholder="종목명·코드 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </header>
        {error && (
          <p
            role="alert"
            className="shrink-0 border-b bg-amber-50 px-6 py-3 text-xs text-amber-900"
          >
            {error}{' '}
            <Button
              size="xs"
              variant="link"
              onClick={() => setRevision((v) => v + 1)}
            >
              다시 확인
            </Button>
          </p>
        )}
        {notice && (
          <output className="shrink-0 border-b bg-primary/5 px-6 py-2 text-[11px] text-primary">
            {notice}
          </output>
        )}
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          {!items.length && !error ? (
            <div className="grid h-full place-items-center">
              <div className="max-w-sm text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Star className="size-6" />
                </span>
                <h2 className="mt-5 text-lg font-semibold">
                  검토할 종목을 골라보세요
                </h2>
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  Radar 후보에서 관심종목으로 등록하면
                  <br />
                  가격·재무·공시 자료를 보강합니다.
                  <br />
                  다음 Radar에서 빠져도 이곳에는 남습니다.
                </p>
                <Link
                  href="/"
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-xs font-medium text-primary-foreground"
                >
                  Radar 후보 살펴보기 <ArrowUpRight className="size-4" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="min-w-[640px] overflow-hidden rounded-2xl border bg-card">
              <div className="grid grid-cols-[minmax(150px,1fr)_130px_minmax(165px,1.2fr)_100px_32px] gap-3 border-b bg-muted/30 px-4 py-3 text-[10px] text-muted-foreground">
                <span>종목 · 마지막 확인</span>
                <span>종가 · 전 거래일 대비</span>
                <span>공시 · 분기 실적</span>
                <span>자료 상태</span>
                <span className="sr-only">패널</span>
              </div>
              {filtered.map((item) => (
                <article
                  key={item.code}
                  className={`grid grid-cols-[minmax(150px,1fr)_130px_minmax(165px,1.2fr)_100px_32px] items-center gap-3 border-b px-4 py-5 last:border-0 ${selected?.code === item.code ? 'bg-primary/[0.035]' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/stocks/${item.code}`}
                      className="block truncate text-sm font-semibold hover:text-primary"
                    >
                      {item.name} ↗
                    </Link>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {item.code}
                    </span>
                    <span className="mt-2 block text-[10px] text-muted-foreground">
                      {checkedDate(item.checked_at)}
                    </span>
                  </span>
                  <Link
                    href={`/stocks/${item.code}?tab=price`}
                    className="text-xs hover:text-primary"
                  >
                    <span className="block font-semibold tabular-nums">
                      {formatWon(item.price.close)}
                    </span>
                    <span className="mt-1 block tabular-nums">
                      {formatPercent(item.price.change1d)}
                    </span>
                    <span className="mt-2 block text-[10px] text-muted-foreground">
                      {item.price.date ?? '기준일 미확인'}
                    </span>
                  </Link>
                  <div className="min-w-0 space-y-2 text-[11px]">
                    <Link
                      href={`/stocks/${item.code}?tab=events&scope=all`}
                      className={`block hover:underline ${item.filings.newCount ? 'font-medium text-primary' : ''}`}
                    >
                      {item.filings.newCount === null
                        ? `공시 ${item.filings.total}건 · 첫 확인`
                        : `추가 공시 ${item.filings.newCount}건`}
                      {!!item.filings.focusCount && (
                        <span className="ml-1 text-[10px]">
                          (우선 {item.filings.focusCount})
                        </span>
                      )}
                    </Link>
                    <Link
                      href={`/stocks/${item.code}?tab=financials`}
                      className={`block hover:underline ${item.financials.changes.length ? 'text-primary' : 'text-muted-foreground'}`}
                    >
                      {item.financials.changes.length
                        ? `재무 추가·수정 ${item.financials.changes.length}분기`
                        : item.financials.latest
                          ? `${item.financials.latest.year} ${item.financials.latest.quarter}${item.financials.checked_at ? ' · 추가 없음' : ' · 첫 확인'}`
                          : '분기 자료 미확인'}
                    </Link>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => showPanel(item.code)}
                    className={`h-auto whitespace-normal justify-start px-0 text-left text-[10px] ${item.needsAttention ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
                  >
                    {['queued', 'running'].includes(item.job?.state ?? '')
                      ? '자료 수집 중'
                      : item.needsAttention
                        ? '자료 점검 필요'
                        : '기준일 확인 가능'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${item.name} 팔로업 패널 열기`}
                    aria-pressed={selected?.code === item.code}
                    onClick={() => showPanel(item.code)}
                  >
                    <PanelRight className="size-4" />
                  </Button>
                </article>
              ))}
              {!filtered.length && items.length > 0 && (
                <p className="p-8 text-center text-xs text-muted-foreground">
                  검색 결과가 없습니다.
                </p>
              )}
            </div>
          )}
        </div>
        <footer className="shrink-0 border-t px-6 py-3 text-[10px] text-muted-foreground">
          ‘공시·실적 추가’는 마지막 확인 자료와의 차이입니다. 가격 움직임은
          별도로 표시하며, 투자 판단이나 추천이 아닙니다.
        </footer>
      </main>
      {rightVisible && selected && (
        <aside className="hidden w-[336px] shrink-0 flex-col overflow-hidden border-l bg-card xl:flex 2xl:w-[360px]">
          {panel}
        </aside>
      )}
      <Sheet open={drawer && !!selected} onOpenChange={setDrawer}>
        <SheetContent className="gap-0 p-0">
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>관심종목 팔로업</SheetTitle>
            <SheetDescription className="text-xs">
              변경 자료와 원문을 확인합니다.
            </SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    </div>
  );
}
