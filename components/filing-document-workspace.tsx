'use client';
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BookOpen,
  ExternalLink,
  RefreshCw,
  Search,
  Settings2,
  Link2,
  Check,
  FileSearch,
  ArrowUpRight,
  GitCompareArrows,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  documentConfig,
  documentGroups,
  documentStateLabels,
  type FilingDocument,
  type DocumentView,
  type DocumentGroup,
  type DocumentBlock,
  type DocumentSearchResponse,
  type DocumentSearchResult,
  type DocumentCompareResponse,
  type DocumentChange,
  type DocumentChangeSource,
} from '@/lib/filing-documents';
import { eventDate } from '@/lib/stock-research';
import { thesisTitle, type InvestmentThesis } from '@/lib/investment-thesis';
import {
  evidenceRelations,
  researchEvidenceConfig,
  type EvidenceRelation,
  type ResearchEvidence,
} from '@/lib/research-evidence';

async function read(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '원문을 읽지 못했습니다.');
  return data;
}
type EvidenceLinkTarget = {
  receipt: string;
  version: string;
  sectionId: string;
  blockId: string;
  preview: string;
};
const documentChangeLabels = {
  added: '새로 등장',
  removed: '이전 문구 제외',
  changed: '내용 변경',
} as const;
export function FilingDocumentWorkspace({ code }: { code: string }) {
  const searchParams = useSearchParams();
  const initialReceipt = searchParams.get('receipt') ?? '';
  const initialVersion = searchParams.get('version') ?? '';
  const initialSection = searchParams.get('section') ?? '';
  const initialBlock = searchParams.get('block') ?? '';
  const [items, setItems] = useState<FilingDocument[]>([]),
    [receipt, setReceipt] = useState(initialReceipt);
  const [view, setView] = useState<DocumentView | null>(null),
    [version, setVersion] = useState(initialVersion),
    [section, setSection] = useState(initialSection),
    [offset, setOffset] = useState(0),
    [targetBlock, setTargetBlock] = useState(initialBlock),
    [focusedBlock, setFocusedBlock] = useState(initialBlock);
  const [group, setGroup] = useState<DocumentGroup>('all'),
    [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [sourceWarning, setSourceWarning] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [documentQuery, setDocumentQuery] = useState('');
  const [searchGroup, setSearchGroup] = useState<DocumentGroup>('all');
  const [searchReceipt, setSearchReceipt] = useState('');
  const [searchVersions, setSearchVersions] = useState<'current' | 'all'>(
    'current',
  );
  const [searchResult, setSearchResult] =
    useState<DocumentSearchResponse | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareFrom, setCompareFrom] = useState('');
  const [compareTo, setCompareTo] = useState('');
  const [compareGroup, setCompareGroup] = useState<DocumentGroup>('all');
  const [compareQuery, setCompareQuery] = useState('');
  const [compareKind, setCompareKind] = useState<
    'all' | DocumentChange['kind']
  >('all');
  const [compareResult, setCompareResult] =
    useState<DocumentCompareResponse | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [theses, setTheses] = useState<InvestmentThesis[]>([]);
  const [links, setLinks] = useState<ResearchEvidence[]>([]);
  const [linking, setLinking] = useState<EvidenceLinkTarget | null>(null);
  const [linkThesis, setLinkThesis] = useState('');
  const [linkRelation, setLinkRelation] = useState<EvidenceRelation>('context');
  const [linkNote, setLinkNote] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const base = `/api/watchlist/${code}/documents`;
  const loadList = useCallback(
    async (signal?: AbortSignal) => {
      const data = await read(await fetch(base, { cache: 'no-store', signal }));
      if (signal?.aborted) return;
      setItems(data.items);
      setReceipt((prior) =>
        data.items.some((item: FilingDocument) => item.receipt === prior)
          ? prior
          : (data.items[0]?.receipt ?? ''),
      );
      const source = data.source_status;
      setSourceWarning(
        source?.status === 'ok'
          ? `공시 목록 수집: ${source.collected_at ? new Date(source.collected_at).toLocaleString('ko-KR') : '시각 미확인'} · 이 목록 이후 정정 공시가 있을 수 있습니다.`
          : '공시 목록이 없거나 일부만 수집됐습니다. 자료 최신화 후 다시 확인해 주세요.',
      );
    },
    [base],
  );
  useEffect(() => {
    const a = new AbortController();
    void Promise.resolve()
      .then(() => loadList(a.signal))
      .catch(() => {
        if (!a.signal.aborted) setError('보고서 목록을 읽지 못했습니다.');
      });
    return () => a.abort();
  }, [loadList]);
  const loadLinks = useCallback(async () => {
    const [points, evidence] = await Promise.all([
      read(await fetch(`/api/watchlist/${code}/theses`, { cache: 'no-store' })),
      read(
        await fetch(`/api/watchlist/${code}/evidence-links`, {
          cache: 'no-store',
        }),
      ),
    ]);
    const active = (points.items as InvestmentThesis[]).filter(
      (item) => !item.archived,
    );
    setTheses(active);
    setLinks(evidence.items as ResearchEvidence[]);
    setLinkThesis((prior) =>
      active.some((item) => item.id === prior) ? prior : (active[0]?.id ?? ''),
    );
  }, [code]);
  useEffect(() => {
    let current = true;
    void Promise.resolve()
      .then(() => loadLinks())
      .catch(() => {
        if (current) setLinkError('연결 자료 목록을 읽지 못했습니다.');
      });
    return () => {
      current = false;
    };
  }, [loadLinks]);
  useEffect(() => {
    if (!items.some((d) => ['queued', 'running'].includes(d.state))) return;
    const a = new AbortController(),
      timer = setTimeout(() => {
        void loadList(a.signal).catch(() => {
          if (!a.signal.aborted)
            setError('수집 상태를 확인하지 못했습니다. 다시 확인해 주세요.');
        });
      }, documentConfig.poll_interval_ms);
    return () => {
      clearTimeout(timer);
      a.abort();
    };
  }, [items, loadList]);
  const selected = items.find((d) => d.receipt === receipt);
  const storedItems = items.filter((item) => item.current_version);
  useEffect(() => {
    if (!receipt || !selected?.current_version) return;
    const a = new AbortController();
    const params = new URLSearchParams({ offset: String(offset) });
    if (version) params.set('version', version);
    if (section) params.set('section', section);
    if (targetBlock) params.set('block', targetBlock);
    void fetch(`${base}/${receipt}?${params}`, {
      cache: 'no-store',
      signal: a.signal,
    })
      .then(read)
      .then((data) => {
        if (!a.signal.aborted) {
          setView(data);
          if (targetBlock) {
            setOffset(data.offset);
            setTargetBlock('');
          }
          setError(null);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => a.abort();
  }, [
    base,
    receipt,
    selected?.current_version,
    selected?.checked_at,
    version,
    section,
    offset,
    targetBlock,
  ]);
  useEffect(() => {
    if (
      !focusedBlock ||
      !view?.blocks.some((block) => block.id === focusedBlock)
    )
      return;
    requestAnimationFrame(() =>
      document
        .getElementById(`document-block-${focusedBlock}`)
        ?.scrollIntoView({ block: 'center' }),
    );
  }, [focusedBlock, view?.blocks]);
  const collect = async (refresh: boolean) => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await read(
        await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receipt, id: crypto.randomUUID(), refresh }),
        }),
      );
      setVersion('');
      setSection('');
      setOffset(0);
      await loadList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (next: string) => {
    setReceipt(next);
    setView(null);
    setVersion('');
    setSection('');
    setOffset(0);
    setQuery('');
    setGroup('all');
    setTargetBlock('');
    setFocusedBlock('');
    setError(null);
  };
  const toc =
    view?.sections.filter(
      (s) =>
        (group === 'all' || s.group === group) &&
        s.title.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const running =
    busy || (!!selected && ['queued', 'running'].includes(selected.state));
  const openLink = (
    block: DocumentBlock,
    source: {
      receipt: string;
      version: string;
      sectionId: string;
    } = {
      receipt,
      version: view?.version ?? '',
      sectionId: view?.section_id ?? '',
    },
  ) => {
    setLinking({
      receipt: source.receipt,
      version: source.version,
      sectionId: source.sectionId,
      blockId: block.id,
      preview: block.text || '표 형식 원문',
    });
    setLinkRelation('context');
    setLinkNote('');
    setLinkError(null);
    void loadLinks().catch(() => setLinkError('투자포인트를 읽지 못했습니다.'));
  };
  const saveLink = async () => {
    const thesis = theses.find((item) => item.id === linkThesis);
    if (!linking || !thesis || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const body = await read(
        await fetch(`/api/watchlist/${code}/evidence-links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            thesis_id: thesis.id,
            thesis_revision: thesis.revision,
            relation: linkRelation,
            note: linkNote,
            receipt: linking.receipt,
            document_version: linking.version,
            section_id: linking.sectionId,
            block_id: linking.blockId,
          }),
        }),
      );
      const saved = body.item as ResearchEvidence;
      setLinks((prior) => [
        saved,
        ...prior.filter((item) => item.id !== saved.id),
      ]);
      setLinking(null);
    } catch (e) {
      setLinkError((e as Error).message);
    } finally {
      setLinkBusy(false);
    }
  };
  const runDocumentSearch = async () => {
    if (searchBusy) return;
    setSearchBusy(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({
        q: documentQuery,
        group: searchGroup,
        versions: searchVersions,
      });
      if (searchReceipt) params.set('receipt', searchReceipt);
      const data = (await read(
        await fetch(`${base}/search?${params}`, { cache: 'no-store' }),
      )) as DocumentSearchResponse;
      setSearchResult(data);
    } catch (searchFailure) {
      setSearchResult(null);
      setSearchError((searchFailure as Error).message);
    } finally {
      setSearchBusy(false);
    }
  };
  const goToDocumentSource = (result: DocumentChangeSource) => {
    setReceipt(result.receipt);
    setView(null);
    setVersion(result.version);
    setSection(result.section_id);
    setOffset(0);
    setTargetBlock(result.block_id);
    setFocusedBlock(result.block_id);
    setLoading(true);
    setError(null);
    setSearchOpen(false);
    setCompareOpen(false);
  };
  const goToSearchResult = (result: DocumentSearchResult) => {
    goToDocumentSource(result);
  };
  const linkSearchResult = (result: DocumentSearchResult) => {
    openLink(
      {
        id: result.block_id,
        section_id: result.section_id,
        kind: result.block_kind,
        text: result.excerpt,
        source_path: result.source_path,
      },
      {
        receipt: result.receipt,
        version: result.version,
        sectionId: result.section_id,
      },
    );
  };
  const linkDocumentSource = (result: DocumentChangeSource) => {
    openLink(
      {
        id: result.block_id,
        section_id: result.section_id,
        kind: result.block_kind,
        text: result.excerpt,
        source_path: result.source_path,
      },
      {
        receipt: result.receipt,
        version: result.version,
        sectionId: result.section_id,
      },
    );
  };
  const runCompare = async () => {
    if (compareBusy) return;
    setCompareBusy(true);
    setCompareError(null);
    try {
      const params = new URLSearchParams({
        from: compareFrom,
        to: compareTo,
        group: compareGroup,
        q: compareQuery,
      });
      const data = (await read(
        await fetch(`${base}/compare?${params}`, { cache: 'no-store' }),
      )) as DocumentCompareResponse;
      setCompareResult(data);
      setCompareKind('all');
    } catch (compareFailure) {
      setCompareResult(null);
      setCompareError((compareFailure as Error).message);
    } finally {
      setCompareBusy(false);
    }
  };
  const visibleChanges =
    compareResult?.items.filter(
      (change) => compareKind === 'all' || change.kind === compareKind,
    ) ?? [];
  const openCompare = () => {
    const nextTo = storedItems.some((item) => item.receipt === compareTo)
      ? compareTo
      : (storedItems[0]?.receipt ?? '');
    const nextFrom = storedItems.some(
      (item) => item.receipt === compareFrom && compareFrom !== nextTo,
    )
      ? compareFrom
      : (storedItems.find((item) => item.receipt !== nextTo)?.receipt ?? '');
    setCompareTo(nextTo);
    setCompareFrom(nextFrom);
    setCompareError(null);
    setCompareOpen(true);
  };
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-card">
      <Dialog
        open={Boolean(linking)}
        onOpenChange={(open) => {
          if (!open && !linkBusy) setLinking(null);
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!linkBusy}
        >
          <DialogHeader>
            <DialogTitle>원문을 투자포인트에 연결</DialogTitle>
            <DialogDescription>
              사용자가 선택한 관계를 기록합니다. 연결만으로 사실 확인이나 투자
              논리 전체가 입증되는 것은 아닙니다.
            </DialogDescription>
          </DialogHeader>
          {linking && (
            <div className="space-y-4">
              <blockquote className="max-h-36 overflow-y-auto rounded-xl border bg-muted/30 p-3 text-xs leading-6">
                {linking.preview}
              </blockquote>
              {theses.length ? (
                <>
                  <label className="block space-y-1.5 text-xs">
                    <span className="font-medium">연결할 투자포인트</span>
                    <select
                      aria-label="연결할 투자포인트"
                      value={linkThesis}
                      onChange={(e) => setLinkThesis(e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-2"
                    >
                      {theses.map((item) => (
                        <option key={item.id} value={item.id}>
                          {thesisTitle(item.content)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="space-y-2">
                    <legend className="text-xs font-medium">
                      이 자료를 보는 관점
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {Object.entries(evidenceRelations).map(
                        ([value, label]) => (
                          <Button
                            key={value}
                            type="button"
                            size="sm"
                            variant={
                              linkRelation === value ? 'default' : 'outline'
                            }
                            onClick={() =>
                              setLinkRelation(value as EvidenceRelation)
                            }
                          >
                            {label}
                          </Button>
                        ),
                      )}
                    </div>
                  </fieldset>
                  <label className="block space-y-1.5 text-xs">
                    <span>
                      내 메모{' '}
                      <span className="text-muted-foreground">· 선택</span>
                    </span>
                    <Textarea
                      value={linkNote}
                      onChange={(e) => setLinkNote(e.target.value)}
                      maxLength={researchEvidenceConfig.max_note_chars}
                      placeholder="이 문단·표에서 무엇을 확인했는지 기록"
                    />
                    <span className="block text-right text-[10px] text-muted-foreground">
                      {linkNote.length}/{researchEvidenceConfig.max_note_chars}
                      자
                    </span>
                  </label>
                </>
              ) : (
                <p className="rounded-xl border border-dashed p-3 text-xs leading-6 text-muted-foreground">
                  먼저 투자포인트를 저장한 뒤 원문을 연결해 주세요.
                </p>
              )}
              {linkError && (
                <p role="alert" className="text-xs text-destructive">
                  {linkError}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={linkBusy}
              onClick={() => setLinking(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={!linkThesis || linkBusy}
              onClick={() => void saveLink()}
            >
              {linkBusy ? '연결 중…' : '선택한 원문 연결'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <header className="shrink-0 space-y-1.5 border-b px-3 py-2">
        <h2 className="sr-only">공시 원문 작업면</h2>
        <div className="flex items-center gap-2">
          <BookOpen className="hidden size-4 shrink-0 text-primary sm:block" />
          <select
            aria-label="보고서 선택"
            value={receipt}
            onChange={(e) => choose(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
          >
            {!items.length && (
              <option value="">수집된 정기보고서 목록 없음</option>
            )}
            {items.map((d) => (
              <option key={d.receipt} value={d.receipt}>
                {eventDate(d.filing_date)} · {d.title}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            aria-label="근거 찾기"
            onClick={() => setSearchOpen(true)}
          >
            <FileSearch />
            <span className="hidden sm:inline">근거 찾기</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="공시 변화 대조"
            onClick={openCompare}
          >
            <GitCompareArrows />
            <span className="hidden sm:inline">변화 대조</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="출처·관리"
            onClick={() => setSourceOpen(true)}
          >
            <Settings2 />
            <span className="hidden sm:inline">출처·관리</span>
          </Button>
          {selected && (
            <a
              className="inline-flex items-center gap-1 text-xs text-primary"
              href={selected.source_url}
              target="_blank"
              rel="noreferrer"
            >
              DART
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        {selected && (
          <p className="text-[10px] text-muted-foreground">
            {documentStateLabels[selected.state] ?? '상태 확인 필요'}
            {selected.checked_at &&
              ` · 원문 조회 ${new Date(selected.checked_at).toLocaleString('ko-KR')}`}{' '}
            {selected.current_version ? ' · 실시간 자료 아님' : ''}
            {view && view.version !== selected.current_version && (
              <span className="ml-1 font-medium text-amber-700">
                · 이전 저장본 열람 중
              </span>
            )}
          </p>
        )}
        {(error || selected?.error) && (
          <p role="alert" className="text-xs text-destructive">
            {error || selected?.error}
          </p>
        )}
      </header>
      {view && selected?.current_version ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex shrink-0 gap-2 border-b p-2 md:hidden">
            <select
              aria-label="모바일 목차 분류"
              value={group}
              onChange={(e) => setGroup(e.target.value as DocumentGroup)}
              className="h-8 w-24 rounded border bg-background text-xs"
            >
              {Object.entries(documentGroups).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="모바일 문단 이동"
              value={view.section_id}
              onChange={(e) => {
                if (e.target.value === view.section_id && offset === 0) return;
                setSection(e.target.value);
                setOffset(0);
                setLoading(true);
              }}
              className="h-8 min-w-0 flex-1 rounded border bg-background text-xs"
            >
              {!toc.some((s) => s.id === view.section_id) && (
                <option value={view.section_id}>목차 선택</option>
              )}
              {toc.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <nav
            aria-label="보고서 목차"
            className="hidden min-h-0 w-[190px] shrink-0 flex-col border-r md:flex"
          >
            <div className="shrink-0 space-y-2 p-2">
              <select
                aria-label="목차 분류"
                className="h-8 w-full rounded border bg-background px-2 text-xs"
                value={group}
                onChange={(e) => setGroup(e.target.value as DocumentGroup)}
              >
                {Object.entries(documentGroups).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search className="absolute top-2 left-2 size-3 text-muted-foreground" />
                <Input
                  aria-label="목차 검색"
                  placeholder="목차 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
              {toc.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    if (s.id === view.section_id && offset === 0) return;
                    setSection(s.id);
                    setOffset(0);
                    setFocusedBlock('');
                    setLoading(true);
                  }}
                  aria-pressed={view.section_id === s.id}
                  className={`mb-1 w-full rounded-lg p-2 text-left text-[11px] leading-5 ${view.section_id === s.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                >
                  {s.title}
                  <span className="ml-1 text-muted-foreground">
                    · {s.block_count}
                  </span>
                </button>
              ))}
              {!toc.length && (
                <p className="p-2 text-xs text-muted-foreground">
                  일치하는 목차가 없습니다. 전체 목차나 DART 원문에서 확인해
                  주세요.
                </p>
              )}
            </div>
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <article
              aria-label="보고서 추출 본문"
              className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto p-4"
            >
              {loading && (
                <p className="text-xs text-muted-foreground">
                  문단을 불러옵니다…
                </p>
              )}
              {!loading &&
                view.blocks.map((block) => (
                  <section
                    key={block.id}
                    id={`document-block-${block.id}`}
                    className={`group relative min-w-0 rounded-lg pr-7 ${focusedBlock === block.id ? 'bg-primary/5 ring-1 ring-primary/20' : ''}`}
                  >
                    <span
                      className="float-left mt-1 mr-2 text-[9px] text-muted-foreground"
                      title={`${view.member} · ${block.id} · ${block.source_path}`}
                    >
                      {Number(block.id.slice(1)) + 1}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="absolute top-0 right-0 text-muted-foreground hover:text-primary"
                      aria-label={
                        links.some(
                          (item) =>
                            item.document_version === view.version &&
                            item.block_id === block.id,
                        )
                          ? '다른 투자포인트에도 연결'
                          : '투자포인트에 연결'
                      }
                      title="투자포인트에 원문 근거 연결"
                      onClick={() => openLink(block)}
                    >
                      {links.some(
                        (item) =>
                          item.document_version === view.version &&
                          item.block_id === block.id,
                      ) ? (
                        <Check />
                      ) : (
                        <Link2 />
                      )}
                    </Button>
                    {block.kind === 'table' && block.rows ? (
                      <div className="max-w-full overflow-x-auto rounded border">
                        <table className="w-full border-collapse text-[11px]">
                          <tbody>
                            {block.rows.map((row, i) => (
                              <tr key={i}>
                                {row.map((cell, j) =>
                                  cell.header ? (
                                    <th
                                      key={j}
                                      rowSpan={cell.rowspan}
                                      colSpan={cell.colspan}
                                      className="min-w-20 border bg-muted p-2 text-left font-medium whitespace-pre-wrap"
                                    >
                                      {cell.text}
                                    </th>
                                  ) : (
                                    <td
                                      key={j}
                                      rowSpan={cell.rowspan}
                                      colSpan={cell.colspan}
                                      className="min-w-20 border p-2 align-top whitespace-pre-wrap"
                                    >
                                      {cell.text}
                                    </td>
                                  ),
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs leading-7 break-words whitespace-pre-wrap">
                        {block.text}
                      </p>
                    )}
                  </section>
                ))}
            </article>
            <footer className="flex shrink-0 items-center justify-between gap-2 border-t p-2 text-[10px] text-muted-foreground">
              <Button
                size="sm"
                variant="ghost"
                disabled={offset === 0 || loading}
                onClick={() => {
                  setFocusedBlock('');
                  setOffset(
                    Math.max(0, offset - documentConfig.blocks_per_page),
                  );
                  setLoading(true);
                }}
              >
                이전
              </Button>
              <span>
                {view.offset + 1}–
                {Math.min(view.offset + view.blocks.length, view.total_blocks)}{' '}
                / {view.total_blocks} 문단·표
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  offset + view.blocks.length >= view.total_blocks || loading
                }
                onClick={() => {
                  setFocusedBlock('');
                  setOffset(offset + documentConfig.blocks_per_page);
                  setLoading(true);
                }}
              >
                다음
              </Button>
            </footer>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5 text-xs leading-7 text-muted-foreground">
          {running
            ? 'DART 원문을 수집하고 문단·표를 확인하고 있습니다. 화면을 닫아도 저장 작업은 계속됩니다.'
            : selected
              ? '보고서를 선택한 뒤 출처·관리에서 원문 수집을 눌러주세요. 사업·분기·반기보고서의 주 XML만 처리하며, 이미지·PDF·외부 첨부는 DART에서 직접 확인합니다.'
              : '관심종목 자료를 먼저 최신화해 정기보고서 목록을 가져오세요. 목록이 없다고 공시가 없다는 뜻은 아닙니다.'}
        </div>
      )}
      <Sheet open={sourceOpen} onOpenChange={setSourceOpen}>
        <SheetContent className="w-full min-h-0 gap-0 sm:max-w-md">
          <SheetHeader className="shrink-0 border-b pr-12">
            <SheetTitle>원문 출처·관리</SheetTitle>
            <SheetDescription>
              수집 상태, 저장 버전, 추출 범위를 확인합니다. AI 호출 없음.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-xs leading-6 text-muted-foreground">
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">보고서 수집</h3>
              {selected && (
                <p>
                  {selected.title} · 접수번호 {selected.receipt}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!selected || running}
                  onClick={() => void collect(!!selected?.current_version)}
                >
                  <RefreshCw className={running ? 'animate-spin' : ''} />
                  {running
                    ? '수집 중…'
                    : selected?.current_version
                      ? '원문 다시 수집'
                      : '이 보고서 원문 수집'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void loadList().catch(() =>
                      setError('목록을 읽지 못했습니다.'),
                    )
                  }
                >
                  원문 목록 다시 확인
                </Button>
              </div>
              {(error || selected?.error) && (
                <p className="text-destructive">{error || selected?.error}</p>
              )}
            </div>
            {view && selected?.current_version && (
              <div className="space-y-2">
                <label
                  htmlFor={`document-version-${code}`}
                  className="block font-semibold text-foreground"
                >
                  저장한 원문 버전
                </label>
                <select
                  id={`document-version-${code}`}
                  aria-label="저장한 원문 버전"
                  value={view.version}
                  onChange={(e) => {
                    if (e.target.value === view.version) return;
                    setVersion(e.target.value);
                    setSection('');
                    setOffset(0);
                    setLoading(true);
                  }}
                  className="h-9 w-full rounded border bg-background px-2 text-xs"
                >
                  {view.versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {new Date(v.collected_at).toLocaleString('ko-KR')} ·{' '}
                      {v.version.slice(0, 8)}
                    </option>
                  ))}
                </select>
                <p>
                  {view.parser_version} ·{' '}
                  {view.version === selected.current_version
                    ? '최근 저장본'
                    : '이전 저장본'}
                </p>
              </div>
            )}
            <div className="space-y-2 border-t pt-4">
              <h3 className="font-semibold text-foreground">
                추출 범위·출처 확인
              </h3>
              <p>{sourceWarning} 정정본은 별도 접수번호로 보존합니다.</p>
              {selected && <p>접수번호 {selected.receipt}</p>}
              {view ? (
                <>
                  {view.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                  <p>
                    해석하지 않은 첨부: {view.omitted_members.length}개 ·{' '}
                    {view.omitted_members.join(', ') || '별도 파일 없음'}
                  </p>
                  <p className="break-all">
                    원본 SHA-256: {view.archive_sha256}
                  </p>
                </>
              ) : (
                <p>
                  문서 수집은 사용자 투자포인트와 검토 확인 상태를 바꾸지
                  않습니다.
                </p>
              )}
              <p>
                목차 분류는 제목 기반 탐색 보조입니다. 회계 기준·단위·보고
                기간은 표 제목과 인접 문단, DART 원문에서 직접 확인하세요. AI
                근거 대조는 아직 연결하지 않았습니다.
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent className="w-full min-h-0 gap-0 sm:max-w-xl">
          <SheetHeader className="shrink-0 border-b pr-12">
            <SheetTitle>투자포인트 근거 탐색</SheetTitle>
            <SheetDescription>
              로컬에 저장한 DART 추출본의 문단·표를 검색합니다. 결과는 검토
              후보이며 사실 입증이나 투자 판단이 아닙니다.
            </SheetDescription>
          </SheetHeader>
          <div className="shrink-0 space-y-3 border-b p-4">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void runDocumentSearch();
              }}
            >
              <Input
                aria-label="원문 전체 검색어"
                value={documentQuery}
                onChange={(event) => setDocumentQuery(event.target.value)}
                maxLength={documentConfig.search_max_chars}
                placeholder="예: 해외 매출, 신규 수주, 재고자산"
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={searchBusy}>
                <Search className={searchBusy ? 'animate-pulse' : ''} />
                {searchBusy ? '검색 중…' : '검색'}
              </Button>
            </form>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="space-y-1 text-[10px] text-muted-foreground">
                <span>보고서</span>
                <select
                  aria-label="검색할 보고서"
                  value={searchReceipt}
                  onChange={(event) => setSearchReceipt(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                >
                  <option value="">저장된 전체 보고서</option>
                  {items
                    .filter((item) => item.current_version)
                    .map((item) => (
                      <option key={item.receipt} value={item.receipt}>
                        {eventDate(item.filing_date)} · {item.title}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                <span>목차 분류</span>
                <select
                  aria-label="검색할 목차 분류"
                  value={searchGroup}
                  onChange={(event) =>
                    setSearchGroup(event.target.value as DocumentGroup)
                  }
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                >
                  {Object.entries(documentGroups).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                <span>저장 버전</span>
                <select
                  aria-label="검색할 저장 버전"
                  value={searchVersions}
                  onChange={(event) =>
                    setSearchVersions(event.target.value as 'current' | 'all')
                  }
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                >
                  <option value="current">최근 저장본만</option>
                  <option value="all">이전 저장본 포함</option>
                </select>
              </label>
            </div>
            {searchError && (
              <p role="alert" className="text-xs text-destructive">
                {searchError}
              </p>
            )}
            {searchResult && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {searchResult.result_count}개 결과
                </span>
                <span>
                  저장본 {searchResult.coverage.searched_versions}/
                  {searchResult.coverage.candidate_versions}개 검색
                </span>
                <span>
                  상태{' '}
                  {searchResult.coverage.status === 'ok'
                    ? '정상'
                    : searchResult.coverage.status === 'partial'
                      ? '일부 검색'
                      : '검색할 저장본 없음'}
                </span>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!searchResult && !searchBusy && (
              <div className="rounded-xl border border-dashed p-4 text-xs leading-6 text-muted-foreground">
                제목이 아니라 추출된 본문 전체를 찾습니다. 여러 단어를 입력하면
                모든 단어가 들어간 문단·표만 표시합니다. 최신 공시 전체를 새로
                조회하는 기능은 아닙니다.
              </div>
            )}
            {searchResult && !searchResult.items.length && (
              <div className="rounded-xl border border-dashed p-4 text-xs leading-6 text-muted-foreground">
                선택한 저장본 범위에서 일치하는 문단·표를 찾지 못했습니다. 이는
                해당 사실이나 근거가 없다는 뜻이 아닙니다. 표현을 바꾸거나 이전
                저장본·다른 목차 분류까지 확인해 주세요.
              </div>
            )}
            {searchResult?.warnings.map((warning) => (
              <p
                key={warning}
                className="mb-2 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200"
              >
                {warning}
              </p>
            ))}
            <div className="space-y-3">
              {searchResult?.items.map((result) => (
                <article
                  key={`${result.receipt}-${result.version}-${result.block_id}`}
                  className="rounded-xl border p-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-foreground">
                      {documentGroups[result.section_group]}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 ${result.current ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}
                    >
                      {result.current ? '최근 저장본' : '이전 저장본'}
                    </span>
                    <span>{eventDate(result.filing_date)}</span>
                    <span className="truncate">{result.title}</span>
                  </div>
                  <h3 className="mt-2 text-xs font-semibold leading-5">
                    {result.section_title}
                  </h3>
                  <p className="mt-1 text-xs leading-6 break-words text-muted-foreground">
                    {result.excerpt}
                  </p>
                  <p
                    className="mt-2 truncate text-[9px] text-muted-foreground/70"
                    title={`${result.receipt} · ${result.version} · ${result.source_path}`}
                  >
                    {result.receipt} · {result.version.slice(0, 8)} ·{' '}
                    {result.source_path}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => goToSearchResult(result)}
                    >
                      <ArrowUpRight />
                      원문 위치
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => linkSearchResult(result)}
                    >
                      <Link2 />
                      투자포인트에 연결
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={compareOpen} onOpenChange={setCompareOpen}>
        <SheetContent className="w-full min-h-0 gap-0 sm:max-w-2xl">
          <SheetHeader className="shrink-0 border-b pr-12">
            <SheetTitle>공시 변화 대조</SheetTitle>
            <SheetDescription>
              두 저장 보고서의 같은 목차를 문단·표 단위로 맞춰 변화 후보를
              찾습니다. 변화의 의미와 투자포인트 관계는 사용자가 확인합니다.
            </SheetDescription>
          </SheetHeader>
          <div className="shrink-0 space-y-3 border-b p-4">
            {storedItems.length < 2 ? (
              <p className="rounded-xl border border-dashed p-3 text-xs leading-6 text-muted-foreground">
                변화 대조에는 원문 추출본이 저장된 서로 다른 보고서가 2개 이상
                필요합니다. 보고서를 선택해 원문을 수집하면 기존 저장본을
                덮어쓰지 않고 비교할 수 있습니다.
              </p>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runCompare();
                }}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1 text-[10px] text-muted-foreground">
                    <span>기준 보고서 · 이전</span>
                    <select
                      aria-label="변화 대조 기준 보고서"
                      value={compareFrom}
                      onChange={(event) => {
                        setCompareFrom(event.target.value);
                        setCompareResult(null);
                      }}
                      className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                    >
                      {storedItems.map((item) => (
                        <option key={item.receipt} value={item.receipt}>
                          {eventDate(item.filing_date)} · {item.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 text-[10px] text-muted-foreground">
                    <span>비교 보고서 · 최근</span>
                    <select
                      aria-label="변화 대조 비교 보고서"
                      value={compareTo}
                      onChange={(event) => {
                        setCompareTo(event.target.value);
                        setCompareResult(null);
                      }}
                      className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                    >
                      {storedItems.map((item) => (
                        <option key={item.receipt} value={item.receipt}>
                          {eventDate(item.filing_date)} · {item.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[150px_1fr_auto] sm:items-end">
                  <label className="space-y-1 text-[10px] text-muted-foreground">
                    <span>목차 분류</span>
                    <select
                      aria-label="변화 대조 목차 분류"
                      value={compareGroup}
                      onChange={(event) =>
                        setCompareGroup(event.target.value as DocumentGroup)
                      }
                      className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                    >
                      {Object.entries(documentGroups).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="space-y-1 text-[10px] text-muted-foreground">
                    <span>변화 안에서 검색 · 선택</span>
                    <Input
                      aria-label="공시 변화 검색어"
                      value={compareQuery}
                      maxLength={documentConfig.search_max_chars}
                      onChange={(event) => setCompareQuery(event.target.value)}
                      placeholder="예: 중국, 수주, 재고자산"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={
                      compareBusy || !compareFrom || compareFrom === compareTo
                    }
                  >
                    <GitCompareArrows
                      className={compareBusy ? 'animate-pulse' : ''}
                    />
                    {compareBusy ? '대조 중…' : '변화 대조'}
                  </Button>
                </div>
              </form>
            )}
            {compareFrom && compareFrom === compareTo && (
              <p role="alert" className="text-xs text-amber-800">
                서로 다른 보고서를 선택해 주세요.
              </p>
            )}
            {compareError && (
              <p role="alert" className="text-xs text-destructive">
                {compareError}
              </p>
            )}
            {compareResult && (
              <div className="space-y-2">
                <div
                  className="grid grid-cols-4 gap-1.5"
                  aria-label="공시 변화 종류별 요약"
                >
                  {[
                    {
                      value: 'all' as const,
                      label: '전체',
                      count:
                        compareResult.counts.added +
                        compareResult.counts.removed +
                        compareResult.counts.changed,
                    },
                    {
                      value: 'changed' as const,
                      label: '내용 변경',
                      count: compareResult.counts.changed,
                    },
                    {
                      value: 'added' as const,
                      label: '새로 등장',
                      count: compareResult.counts.added,
                    },
                    {
                      value: 'removed' as const,
                      label: '이전 제외',
                      count: compareResult.counts.removed,
                    },
                  ].map((summary) => (
                    <button
                      type="button"
                      key={summary.value}
                      aria-pressed={compareKind === summary.value}
                      onClick={() => setCompareKind(summary.value)}
                      className={`rounded-lg border px-1.5 py-2 text-center text-[10px] ${compareKind === summary.value ? 'border-primary/30 bg-primary/5 text-primary' : 'text-muted-foreground'}`}
                    >
                      <span className="block font-medium">{summary.label}</span>
                      <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                        {summary.count}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] leading-5 text-muted-foreground">
                  같은 제목 목차 {compareResult.coverage.aligned_sections}개
                  정렬 · 상태{' '}
                  {compareResult.coverage.status === 'ok'
                    ? '정상'
                    : '일부 비교'}
                </p>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!compareResult && storedItems.length >= 2 && !compareBusy && (
              <div className="rounded-xl border border-dashed p-4 text-xs leading-6 text-muted-foreground">
                숫자·문구의 변화 후보를 찾는 도구입니다. 목차 이동, 단순 서식
                변경, 기간 차이도 변화로 잡힐 수 있으므로 두 원문과 회계
                기준·단위를 함께 확인하세요.
              </div>
            )}
            {compareResult?.warnings.map((warning) => (
              <p
                key={warning}
                className="mb-2 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200"
              >
                {warning}
              </p>
            ))}
            {compareResult && !visibleChanges.length && (
              <p className="rounded-xl border border-dashed p-4 text-xs leading-6 text-muted-foreground">
                선택한 범위에서 표시할 변화 후보가 없습니다. 변화가 없다는
                확정이 아니며, 목차 구조가 달라 정렬되지 않은 내용과 미수집
                첨부는 원문에서 별도로 확인해야 합니다.
              </p>
            )}
            <div className="space-y-3">
              {visibleChanges.map((change) => (
                <article key={change.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${change.kind === 'changed' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : change.kind === 'added' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}
                    >
                      {documentChangeLabels[change.kind]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {
                        documentGroups[
                          (change.after ?? change.before)!.section_group
                        ]
                      }
                    </span>
                    <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                      {(change.after ?? change.before)!.section_title}
                    </span>
                  </div>
                  <div
                    className={`mt-3 grid gap-2 ${change.before && change.after ? 'sm:grid-cols-2' : ''}`}
                  >
                    {change.before && (
                      <DocumentChangeSourceCard
                        label="이전 보고서"
                        source={change.before}
                        tone="before"
                        onGo={goToDocumentSource}
                        onLink={linkDocumentSource}
                      />
                    )}
                    {change.after && (
                      <DocumentChangeSourceCard
                        label="최근 보고서"
                        source={change.after}
                        tone="after"
                        onGo={goToDocumentSource}
                        onLink={linkDocumentSource}
                      />
                    )}
                  </div>
                </article>
              ))}
            </div>
            {compareResult && (
              <p className="mt-4 border-t pt-3 text-[10px] leading-5 text-muted-foreground">
                `새로 등장`, `내용 변경`, `이전 문구 제외`는 텍스트 비교 결과일
                뿐 중요도나 투자 방향을 뜻하지 않습니다. 투자포인트 연결 시
                관계를 직접 선택하세요.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function DocumentChangeSourceCard({
  label,
  source,
  tone,
  onGo,
  onLink,
}: {
  label: string;
  source: DocumentChangeSource;
  tone: 'before' | 'after';
  onGo: (source: DocumentChangeSource) => void;
  onLink: (source: DocumentChangeSource) => void;
}) {
  return (
    <section
      className={`min-w-0 rounded-lg border p-2.5 ${tone === 'after' ? 'bg-emerald-500/[0.035]' : 'bg-amber-500/[0.035]'}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span>
        <span>{eventDate(source.filing_date)}</span>
        <span className="min-w-0 truncate">{source.title}</span>
      </div>
      <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5">
        {source.excerpt}
      </p>
      <p
        className="mt-2 truncate text-[9px] text-muted-foreground/70"
        title={`${source.receipt} · ${source.version} · ${source.source_path}`}
      >
        {source.receipt} · {source.version.slice(0, 8)} · {source.source_path}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        <Button size="xs" variant="ghost" onClick={() => onGo(source)}>
          <ArrowUpRight /> 원문 위치
        </Button>
        <Button size="xs" variant="ghost" onClick={() => onLink(source)}>
          <Link2 /> 투자포인트 연결
        </Button>
      </div>
    </section>
  );
}
