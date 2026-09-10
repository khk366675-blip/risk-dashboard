'use client';

import { RichMemoOpen } from '@/components/rich-memo-view';
import { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Plus,
  Save,
  NotebookPen,
  Sparkles,
  Link2,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { useLocalDraft } from '@/components/draft-recovery';
import { ThesisVersions } from '@/components/thesis-versions';
import { ThesisQuestions } from '@/components/thesis-questions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  emptyThesis,
  thesisConfig,
  thesisTitle,
  validateThesisContent,
  type InvestmentThesis,
  type ThesisContent,
} from '@/lib/investment-thesis';
import {
  evidenceRelations,
  type ResearchEvidence,
} from '@/lib/research-evidence';
import {
  financialEvidenceStatusLabel,
  type FinancialEvidence,
} from '@/lib/research-financial-evidence';
import { displayNumber } from '@/lib/stock-research';
import { documentUrl } from '@/lib/filing-documents';
import { ManualEvidenceDialog } from '@/components/manual-evidence-dialog';
import {
  manualEvidenceTypes,
  type ManualEvidence,
} from '@/lib/research-manual-evidence';

export const discardThesisMessage =
  '저장하지 않은 투자포인트 변경이 있습니다. 변경을 버리고 이동할까요?';
const evidenceRelationGroups = [
  {
    value: 'supports',
    label: '뒷받침',
    description: '가설과 같은 방향인지 검토',
    dot: 'bg-sky-500',
  },
  {
    value: 'challenges',
    label: '약화',
    description: '반대 사실·다른 설명 검토',
    dot: 'bg-amber-500',
  },
  {
    value: 'context',
    label: '미확인',
    description: '참고 자료·관계 미확인',
    dot: 'bg-slate-400',
  },
] as const;
async function responseJson(response: Response) {
  const body = await response.json().catch(() => {
    throw new Error('서버 응답을 읽지 못했습니다. 입력을 유지했습니다.');
  });
  if (!response.ok)
    throw new Error(body.error || '저장 요청을 완료하지 못했습니다.');
  return body;
}

export function ThesisWorkspace({
  code,
  onDirty,
  onSelect,
  onItems,
  confirmDiscard,
  preferredPointId,
  onRequestAi,
  onRequestEvidence,
  preferredCheckId,
  onQuestionMode,
}: {
  code: string;
  onDirty: (dirty: boolean) => void;
  onSelect: (item: InvestmentThesis | null) => void;
  onItems: (items: InvestmentThesis[]) => void;
  confirmDiscard: (message: string) => Promise<boolean>;
  preferredPointId?: string;
  onRequestAi: () => void;
  onRequestEvidence: () => void;
  preferredCheckId?: string;
  onQuestionMode: (active: boolean) => void;
}) {
  const [section, setSection] = useState<'point' | 'questions'>(
    preferredCheckId ? 'questions' : 'point',
  );
  useEffect(() => {
    onQuestionMode(section === 'questions');
    return () => onQuestionMode(false);
  }, [section, onQuestionMode]);
  const [items, setItems] = useState<InvestmentThesis[]>([]);
  const [selected, setSelected] = useState<InvestmentThesis | null>(null);
  const [draft, setDraft] = useState<ThesisContent>(emptyThesis);
  const [id, setId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(selected?.content ?? emptyThesis());
  const recovery = useLocalDraft(
    `thesis:${code}:${selected?.id ?? 'new'}`,
    draft,
    loaded && dirty,
    setDraft,
  );
  useEffect(() => {
    onDirty(dirty || busy);
    return () => onDirty(false);
  }, [dirty, busy, onDirty]);
  const select = useCallback(
    (item: InvestmentThesis | null) => {
      setSelected(item);
      setDraft(item ? structuredClone(item.content) : emptyThesis());
      setId(item?.id ?? crypto.randomUUID());
      onSelect(item);
      setNotice(null);
    },
    [onSelect],
  );
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/watchlist/${code}/theses`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(responseJson)
      .then((body) => {
        if (abort.signal.aborted) return;
        setItems(body.items);
        onItems(body.items);
        select(
          body.items.find(
            (item: InvestmentThesis) =>
              !item.archived && item.id === preferredPointId,
          ) ??
            body.items.find((item: InvestmentThesis) => !item.archived) ??
            null,
        );
        setLoaded(true);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [code, onItems, select, preferredPointId]);
  const read = async () => {
    const body = await responseJson(
      await fetch(`/api/watchlist/${code}/theses`, { cache: 'no-store' }),
    );
    setItems(body.items);
    onItems(body.items);
    if (!loaded) {
      select(
        body.items.find((item: InvestmentThesis) => !item.archived) ?? null,
      );
      setLoaded(true);
    }
    return body.items as InvestmentThesis[];
  };
  const choose = async (item: InvestmentThesis | null) => {
    if (busy || (dirty && !(await confirmDiscard(discardThesisMessage))))
      return;
    select(item);
    setError(null);
  };
  const patch = (change: Partial<ThesisContent>) => {
    setDraft({ ...draft, ...change });
    setNotice(null);
  };
  const save = async (archive?: boolean) => {
    if (busy) return;
    if (
      archive !== undefined &&
      dirty &&
      !(await confirmDiscard('저장 전 변경을 버리고 보관 상태를 바꿀까요?'))
    )
      return;
    setError(null);
    setNotice(null);
    let content;
    try {
      content =
        archive === undefined ? validateThesisContent(draft) : undefined;
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/watchlist/${code}/theses${selected ? `/${selected.id}` : ''}`,
        {
          method: selected ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            selected
              ? {
                  revision: selected.revision,
                  ...(archive === undefined
                    ? { content }
                    : { archived: archive }),
                }
              : { id, content },
          ),
        },
      );
      const body = await responseJson(response);
      const saved = body.item as InvestmentThesis;
      recovery.clear();
      select(saved);
      setNotice(
        archive === undefined
          ? '저장됨 · 내 PC에 보관했습니다.'
          : archive
            ? '보관함으로 옮겼습니다. 언제든 복구할 수 있습니다.'
            : '투자포인트를 복구했습니다.',
      );
      setArchived(saved.archived);
      await read();
    } catch (e) {
      setError((e as Error).message);
      // Read the competing version without overwriting the editor's draft.
      await read().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const current = items.find((i) => i.id === selected?.id);
  const conflict =
    selected && current && selected.revision !== current.revision;
  const displayed = items.filter((i) => i.archived === archived);
  return (
    <div className="@container flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-card">
      {recovery.banner}
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <NotebookPen className="size-4 text-primary" />내 투자포인트
            </h2>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {selected && (
              <ThesisVersions
                item={selected}
                onRestore={async (content) => {
                  if (!dirty || (await confirmDiscard(discardThesisMessage)))
                    setDraft(content);
                }}
              />
            )}
            <ThesisEvidenceLauncher
              key={selected?.id ?? 'empty'}
              item={selected}
              onOpen={onRequestEvidence}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!selected || selected.archived || dirty || busy}
              onClick={onRequestAi}
            >
              <Sparkles />
              AI 질문 제안
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !loaded ||
                busy ||
                items.filter((i) => !i.archived).length >=
                  thesisConfig.max_active_points
              }
              onClick={async () => {
                if (
                  busy ||
                  (dirty && !(await confirmDiscard(discardThesisMessage)))
                )
                  return;
                setArchived(false);
                setSection('point');
                select(null);
                setError(null);
              }}
            >
              <Plus />새 포인트
            </Button>
          </div>
        </div>
        {items.some((item) => item.archived) && (
          <div className="mt-3 flex items-center gap-2 text-[10px]">
            <Button
              size="xs"
              variant={archived ? 'ghost' : 'secondary'}
              onClick={() => setArchived(false)}
            >
              작성한 포인트 {items.filter((i) => !i.archived).length}
            </Button>
            <Button
              size="xs"
              variant={archived ? 'secondary' : 'ghost'}
              onClick={() => setArchived(true)}
            >
              보관함 {items.filter((i) => i.archived).length}
            </Button>
          </div>
        )}
        <div
          className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto"
          aria-label="투자포인트 목록"
        >
          {displayed.map((item, index) => (
            <button
              type="button"
              key={item.id}
              disabled={busy}
              aria-pressed={selected?.id === item.id}
              className={`max-w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] ${selected?.id === item.id ? 'border-primary/25 bg-primary/5 text-primary' : 'border-transparent bg-muted/50'}`}
              onClick={() => choose(item)}
            >
              <span className="block max-w-72 truncate">
                {index + 1}. {thesisTitle(item.content)}
              </span>
            </button>
          ))}
          {!displayed.length && (
            <span className="py-1 text-[11px] text-muted-foreground">
              {archived
                ? '보관된 포인트가 없습니다.'
                : '아직 작성한 포인트가 없습니다. 아래에 첫 가설을 적어보세요.'}
            </span>
          )}
        </div>
        <div
          className="mt-3 flex gap-2"
          role="tablist"
          aria-label="투자포인트 작성과 검증"
        >
          <Button
            size="sm"
            role="tab"
            aria-selected={section === 'point'}
            aria-controls="thesis-section"
            variant={section === 'point' ? 'secondary' : 'ghost'}
            onClick={() => setSection('point')}
          >
            투자포인트 작성
          </Button>
          <Button
            size="sm"
            role="tab"
            aria-selected={section === 'questions'}
            aria-controls="thesis-section"
            variant={section === 'questions' ? 'secondary' : 'ghost'}
            onClick={() => setSection('questions')}
          >
            검증 질문 {draft.checks.length}
          </Button>
        </div>
      </div>
      <div
        id="thesis-section"
        role="tabpanel"
        aria-label={section === 'point' ? '투자포인트 작성' : '검증 질문'}
        className={`min-h-0 flex-1 px-4 py-3 ${section === 'questions' ? 'flex flex-col gap-3 overflow-hidden' : 'space-y-4 overflow-y-auto'}`}
      >
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs leading-5"
          >
            <p>{error}</p>
            <Button
              size="xs"
              variant="link"
              disabled={busy}
              onClick={() => {
                void read()
                  .then(() => setError(null))
                  .catch((e) => setError(e.message));
              }}
            >
              최신 저장 목록 확인 · 입력 유지
            </Button>
          </div>
        )}
        {conflict && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5">
            <p>
              다른 화면의 저장본이 있습니다. 아래 최신본과 작성 중인 내용을
              비교하세요.
            </p>
            <pre className="my-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans">
              {[
                `제목: ${current.content.title || '미작성'}`,
                `투자포인트: ${current.content.body}`,
                `예상 시기: ${current.content.timing || '미정'}`,
                `기대가 약해지는 조건: ${current.content.weakens || '미작성'}`,
                `원문: ${current.content.source_url || '미연결'}`,
                ...current.content.checks.map(
                  (check, index) => `검증 ${index + 1}: ${check.text}`,
                ),
              ].join('\n\n')}
            </pre>
            <Button size="xs" variant="outline" onClick={() => choose(current)}>
              입력을 버리고 최신본 불러오기
            </Button>
          </section>
        )}
        {!loaded ? (
          <p className="text-xs text-muted-foreground">
            저장한 투자포인트를 확인합니다…
          </p>
        ) : (
          <fieldset
            disabled={busy || Boolean(selected?.archived)}
            className={`min-w-0 disabled:opacity-70 ${section === 'questions' ? 'flex min-h-0 flex-1 flex-col gap-3' : 'space-y-4'}`}
          >
            {selected?.archived && (
              <p className="rounded-lg bg-muted p-2 text-[11px]">
                보관된 포인트입니다. 복구하면 다시 편집할 수 있습니다.
              </p>
            )}
            {section === 'point' && (
              <>
                <label
                  className="block space-y-1.5 text-[11px]"
                  htmlFor="thesis-title"
                >
                  <span>
                    짧은 제목{' '}
                    <span className="text-muted-foreground">· 선택</span>
                  </span>
                  <Input
                    id="thesis-title"
                    value={draft.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="예: 신규 사업의 수익화"
                  />
                </label>
                <label
                  className="block space-y-1.5 text-[11px]"
                  htmlFor="thesis-body"
                >
                  <span className="font-medium">내 투자포인트</span>
                  <Textarea
                    id="thesis-body"
                    rows={5}
                    className="min-h-32 resize-y text-sm leading-6"
                    value={draft.body}
                    onChange={(e) => patch({ body: e.target.value })}
                    placeholder="이 기업을 관심 있게 보는 이유를 자유롭게 적어주세요. 아직 확인되지 않은 기대나 가정도 괜찮습니다."
                  />
                  <span
                    className={`block text-right text-[10px] ${draft.body.length > thesisConfig.max_body_chars ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {draft.body.length.toLocaleString()} /{' '}
                    {thesisConfig.max_body_chars.toLocaleString()}자
                  </span>
                </label>
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    예상 시기 · 반증 조건 · 원문 링크{' '}
                    <span className="font-normal text-muted-foreground">
                      선택
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <label
                      className="block space-y-1.5 text-[11px]"
                      htmlFor="thesis-timing"
                    >
                      <span>예상 확인 시기</span>
                      <Input
                        id="thesis-timing"
                        value={draft.timing}
                        onChange={(e) => patch({ timing: e.target.value })}
                        placeholder="예: 다음 분기 실적 발표 때 / 미정"
                      />
                    </label>
                    <label
                      className="block space-y-1.5 text-[11px]"
                      htmlFor="thesis-weakens"
                    >
                      <span>기대가 약해지는 조건</span>
                      <Textarea
                        id="thesis-weakens"
                        value={draft.weakens}
                        onChange={(e) => patch({ weakens: e.target.value })}
                        placeholder="어떤 사실이 확인되면 이 가설을 다시 생각할까요?"
                      />
                    </label>
                    <label
                      className="block space-y-1.5 text-[11px]"
                      htmlFor="thesis-source"
                    >
                      <span>관련 원문 링크</span>
                      <Input
                        id="thesis-source"
                        value={draft.source_url}
                        onChange={(e) => patch({ source_url: e.target.value })}
                        placeholder="https://…"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        링크만 저장하며 본문을 자동 수집하거나 AI로 전송하지
                        않습니다.
                      </span>
                    </label>
                  </div>
                </details>
              </>
            )}
            {section === 'questions' && (
              <ThesisQuestions
                key={selected?.id ?? 'new'}
                checks={draft.checks}
                onChange={(checks) => patch({ checks })}
                thesis={selected}
                dirty={dirty}
                onRequestEvidence={onRequestEvidence}
                preferredCheckId={preferredCheckId}
              />
            )}
          </fieldset>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-3">
        <div className="text-[10px] text-muted-foreground" aria-live="polite">
          {busy
            ? '저장 요청 중…'
            : (notice ??
              (dirty
                ? '저장 전 · 변경 사항이 있습니다'
                : selected
                  ? `저장됨 · 버전 ${selected.revision}`
                  : '새 투자포인트'))}
          <span className="mt-1 block">
            사용자 작성 · 자료 갱신과 별도로 보존
          </span>
        </div>
        <div className="flex gap-1">
          {selected && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || Boolean(conflict)}
              onClick={() => void save(!selected.archived)}
            >
              {selected.archived ? <ArchiveRestore /> : <Archive />}
              {selected.archived ? '복구' : '보관'}
            </Button>
          )}
          {!selected?.archived && (
            <Button
              size="sm"
              disabled={!loaded || busy || !dirty || Boolean(conflict)}
              onClick={() => void save()}
            >
              <Save />
              저장
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ThesisEvidenceLauncher({
  item,
  onOpen,
}: {
  item: InvestmentThesis | null;
  onOpen: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!item) return;
      const query = `?thesis=${encodeURIComponent(item.id)}`;
      const [documents, financials, manuals] = await Promise.all([
        fetch(`/api/watchlist/${item.code}/evidence-links${query}`, {
          cache: 'no-store',
          signal,
        }),
        fetch(`/api/watchlist/${item.code}/financial-evidence${query}`, {
          cache: 'no-store',
          signal,
        }),
        fetch(`/api/watchlist/${item.code}/manual-evidence${query}`, {
          cache: 'no-store',
          signal,
        }),
      ]);
      const [documentBody, financialBody, manualBody] = await Promise.all([
        documents.json(),
        financials.json(),
        manuals.json(),
      ]);
      if (!documents.ok || !financials.ok || !manuals.ok)
        throw new Error('연결 자료 수를 확인하지 못했습니다.');
      setCount(
        documentBody.items.length +
          financialBody.items.length +
          manualBody.items.length,
      );
      setError(false);
    },
    [item],
  );
  useEffect(() => {
    if (!item) return;
    const abort = new AbortController();
    void Promise.resolve()
      .then(() => load(abort.signal))
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [item, load]);
  useEffect(() => {
    if (!item) return;
    const handleEvidenceChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{ code?: string; thesisId?: string }>
      ).detail;
      if (detail?.code !== item.code || detail?.thesisId !== item.id) return;
      void load().catch(() => setError(true));
    };
    window.addEventListener('research-evidence-changed', handleEvidenceChange);
    return () =>
      window.removeEventListener(
        'research-evidence-changed',
        handleEvidenceChange,
      );
  }, [item, load]);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!item}
      className={error ? 'border-amber-300 text-amber-800' : ''}
      title={error ? '연결 자료 수를 확인하지 못했습니다.' : undefined}
      onClick={() => {
        void load().catch(() => setError(true));
        onOpen();
      }}
    >
      <Link2 />
      {error ? '연결 자료 확인' : `연결 자료 ${count ?? '—'}개`}
    </Button>
  );
}

export function ThesisContextPanel({
  item,
}: {
  item: InvestmentThesis | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-medium text-primary">
          내가 작성한 검토 가설
        </p>
        <h3 className="mt-2 break-words text-sm font-semibold leading-6">
          {item
            ? thesisTitle(item.content)
            : '투자포인트를 작성하거나 선택해 주세요'}
        </h3>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          {item
            ? `저장 버전 ${item.revision} · ${new Date(item.updated_at).toLocaleString('ko-KR')}`
            : 'Radar 선정 조건과 별개로, 이 기업을 계속 살펴볼 이유를 기록합니다.'}
        </p>
      </div>
      {item && <EvidenceLinksPanel item={item} />}
      {item && (
        <details className="space-y-3 rounded-xl border p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            저장한 가설 · 질문 보기
          </summary>
          <h4 className="text-xs font-semibold">
            저장한 가설 {item.archived ? '· 보관 중' : ''}
          </h4>
          <p className="whitespace-pre-wrap break-words text-[11px] leading-6">
            {item.content.body}
          </p>
          <div className="border-t pt-3">
            <h4 className="text-xs font-semibold">
              직접 확인할 질문 · {item.content.checks.length}개
            </h4>
            {item.content.checks.length ? (
              <ol className="mt-2 list-decimal space-y-2 pl-4 text-[11px] leading-5">
                {item.content.checks.map((check) => (
                  <li
                    key={check.id}
                    className="whitespace-pre-wrap break-words"
                  >
                    {check.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                아직 작성한 질문이 없습니다.
              </p>
            )}
          </div>
        </details>
      )}
      {item?.content.source_url && (
        <section className="rounded-xl border p-3">
          <h4 className="text-xs font-semibold">직접 연결한 원문</h4>
          <a
            className="mt-2 block break-all text-[11px] text-primary underline"
            href={item.content.source_url.trim()}
            target="_blank"
            rel="noreferrer"
          >
            원문 링크 열기 ↗
          </a>
          <p className="mt-2 text-[10px] text-muted-foreground">
            사용자 링크 · 본문 수집·확인 전
          </p>
        </section>
      )}
      <p className="border-t pt-3 text-[10px] leading-5 text-muted-foreground">
        개인 글은 로컬에 저장되며, AI 요청 전에는 외부로 전송되지 않습니다.
      </p>
    </div>
  );
}

function EvidenceLinksPanel({ item }: { item: InvestmentThesis }) {
  const [links, setLinks] = useState<ResearchEvidence[] | null>(null);
  const [financialLinks, setFinancialLinks] = useState<
    FinancialEvidence[] | null
  >(null);
  const [manualLinks, setManualLinks] = useState<ManualEvidence[] | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const [documents, financials, manuals] = await Promise.all([
        fetch(`/api/watchlist/${item.code}/evidence-links?thesis=${item.id}`, {
          cache: 'no-store',
          signal,
        }),
        fetch(
          `/api/watchlist/${item.code}/financial-evidence?thesis=${item.id}`,
          { cache: 'no-store', signal },
        ),
        fetch(`/api/watchlist/${item.code}/manual-evidence?thesis=${item.id}`, {
          cache: 'no-store',
          signal,
        }),
      ]);
      const [documentBody, financialBody, manualBody] = await Promise.all([
        documents.json(),
        financials.json(),
        manuals.json(),
      ]);
      if (!documents.ok)
        throw new Error(
          documentBody.error || '원문 연결 자료를 읽지 못했습니다.',
        );
      if (!financials.ok)
        throw new Error(
          financialBody.error || '재무 연결 자료를 읽지 못했습니다.',
        );
      if (!manuals.ok)
        throw new Error(
          manualBody.error || '직접 추가한 자료를 읽지 못했습니다.',
        );
      setLinks(documentBody.items);
      setFinancialLinks(financialBody.items);
      setManualLinks(manualBody.items);
    },
    [item.code, item.id],
  );
  useEffect(() => {
    const abort = new AbortController();
    void Promise.resolve()
      .then(() => load(abort.signal))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [load]);
  const archive = async (
    kind: 'document' | 'financial' | 'manual',
    id: string,
  ) => {
    const key = `${kind}:${id}`;
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(
        `/api/watchlist/${item.code}/${kind === 'document' ? 'evidence-links' : kind === 'financial' ? 'financial-evidence' : 'manual-evidence'}/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: true }),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || '연결을 해제하지 못했습니다.');
      if (kind === 'document')
        setLinks((prior) => prior?.filter((link) => link.id !== id) ?? []);
      else if (kind === 'financial')
        setFinancialLinks(
          (prior) => prior?.filter((link) => link.id !== id) ?? [],
        );
      else
        setManualLinks(
          (prior) => prior?.filter((link) => link.id !== id) ?? [],
        );
      window.dispatchEvent(
        new CustomEvent('research-evidence-changed', {
          detail: { code: item.code, thesisId: item.id },
        }),
      );
      setConfirming(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border p-3">
      <ManualEvidenceDialog
        key={`${item.id}:${manualOpen}`}
        item={item}
        open={manualOpen}
        onOpenChange={setManualOpen}
        onSaved={(saved) => {
          setManualLinks((prior) => [
            saved,
            ...(prior ?? []).filter((link) => link.id !== saved.id),
          ]);
          window.dispatchEvent(
            new CustomEvent('research-evidence-changed', {
              detail: { code: item.code, thesisId: item.id },
            }),
          );
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold">
          <Link2 className="size-3.5 text-primary" />
          연결 자료
        </h4>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">
            {links !== null && financialLinks !== null && manualLinks !== null
              ? links.length + financialLinks.length + manualLinks.length
              : '—'}
            개
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setManualOpen(true)}
          >
            <Plus />
            자료 직접 추가
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[11px] leading-5 text-destructive">
          {error}
        </p>
      )}
      {(links === null || financialLinks === null || manualLinks === null) &&
        !error && (
          <p className="text-[11px] text-muted-foreground">
            원문 연결을 확인합니다…
          </p>
        )}
      {links !== null && financialLinks !== null && manualLinks !== null && (
        <>
          <div
            className="grid grid-cols-3 gap-1.5"
            aria-label="관계별 연결 자료 요약"
          >
            {evidenceRelationGroups.map((group) => {
              const count =
                links.filter((link) => link.relation === group.value).length +
                financialLinks.filter((link) => link.relation === group.value)
                  .length +
                manualLinks.filter((link) => link.relation === group.value)
                  .length;
              return (
                <div
                  key={group.value}
                  className="rounded-lg border bg-muted/20 px-2 py-2 text-center"
                >
                  <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                    <span className={`size-1.5 rounded-full ${group.dot}`} />
                    {group.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {count}
                  </p>
                </div>
              );
            })}
          </div>
          {evidenceRelationGroups.map((group) => {
            const documents = links.filter(
              (link) => link.relation === group.value,
            );
            const financials = financialLinks.filter(
              (link) => link.relation === group.value,
            );
            const manuals = manualLinks.filter(
              (link) => link.relation === group.value,
            );
            const groupCount =
              documents.length + financials.length + manuals.length;
            return (
              <section key={group.value} className="space-y-2 border-t pt-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h5 className="flex items-center gap-1.5 text-xs font-semibold">
                      <span className={`size-2 rounded-full ${group.dot}`} />
                      {group.label}
                    </h5>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {group.description}
                    </p>
                  </div>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {groupCount}개
                  </span>
                </div>
                {manuals.map((link) => (
                  <ManualEvidenceCard
                    key={link.id}
                    item={item}
                    link={link}
                    confirming={confirming}
                    busy={busy}
                    onConfirm={setConfirming}
                    onArchive={(id) => void archive('manual', id)}
                  />
                ))}
                {documents.map((link) => (
                  <article
                    key={link.id}
                    className="rounded-lg bg-muted/35 p-2.5 text-[11px] leading-5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-background px-1.5 py-0.5 font-medium text-primary">
                        {evidenceRelations[link.relation]}
                      </span>
                      <span className="text-muted-foreground">
                        {link.block_kind === 'table' ? '표' : '문단'} ·{' '}
                        {link.section_title}
                      </span>
                    </div>
                    {link.thesis_revision !== item.revision && (
                      <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-amber-900">
                        투자포인트 수정 전 버전에서 연결 · 관계를 다시
                        확인하세요.
                      </p>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer line-clamp-2 whitespace-pre-wrap break-words">
                        {link.excerpt.text || '표 원문 펼쳐보기'}
                      </summary>
                      <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-l-2 pl-2 text-muted-foreground">
                        {link.excerpt.text ||
                          '표의 구조화된 셀은 원문 작업면에서 확인하세요.'}
                      </p>
                    </details>
                    {link.note && (
                      <p className="mt-2 whitespace-pre-wrap break-words border-t pt-2">
                        내 메모 · {link.note}
                      </p>
                    )}
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {link.document_title} · 저장본{' '}
                      {link.document_version.slice(0, 8)} ·{' '}
                      {new Date(link.collected_at).toLocaleDateString('ko-KR')}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        render={
                          <Link
                            href={`/stocks/${item.code}?${new URLSearchParams({
                              tab: 'documents',
                              receipt: link.receipt,
                              version: link.document_version,
                              section: link.section_id,
                              block: link.block_id,
                            }).toString()}`}
                          />
                        }
                      >
                        해당 원문 위치
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        render={
                          <a
                            href={documentUrl(link.receipt)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="DART 원문 열기"
                          >
                            <span className="sr-only">DART 원문 열기</span>
                          </a>
                        }
                      >
                        DART <ExternalLink />
                      </Button>
                      {confirming === `document:${link.id}` ? (
                        <span className="ml-auto flex items-center gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busy === `document:${link.id}`}
                            onClick={() => setConfirming(null)}
                          >
                            취소
                          </Button>
                          <Button
                            size="xs"
                            variant="destructive"
                            disabled={busy === `document:${link.id}`}
                            onClick={() => void archive('document', link.id)}
                          >
                            {busy === `document:${link.id}`
                              ? '처리 중…'
                              : '해제 확인'}
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="ml-auto"
                          onClick={() => setConfirming(`document:${link.id}`)}
                        >
                          연결 해제
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
                {financials.map((link) => {
                  const sourceStatus =
                    typeof link.source_status.status === 'string'
                      ? link.source_status.status
                      : 'missing';
                  const sourceAsOf =
                    typeof link.source_status.as_of === 'string'
                      ? link.source_status.as_of
                      : null;
                  const sourceWarning =
                    typeof link.source_status.warning === 'string'
                      ? link.source_status.warning
                      : null;
                  return (
                    <article
                      key={link.id}
                      className="rounded-lg bg-muted/35 p-2.5 text-[11px] leading-5"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md bg-background px-1.5 py-0.5 font-medium text-primary">
                          {evidenceRelations[link.relation]}
                        </span>
                        <span className="text-muted-foreground">
                          재무 · {link.metric_label}
                        </span>
                      </div>
                      {link.thesis_revision !== item.revision && (
                        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-amber-900">
                          투자포인트 수정 전 버전에서 연결 · 관계를 다시
                          확인하세요.
                        </p>
                      )}
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <p className="text-base font-semibold tabular-nums">
                          {displayNumber(link.value, link.unit)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {link.year} {link.quarter} ·{' '}
                          {link.statement_basis === 'CFS'
                            ? '연결'
                            : link.statement_basis === 'OFS'
                              ? '별도'
                              : '기준 미확인'}
                        </p>
                      </div>
                      {link.note && (
                        <p className="mt-2 whitespace-pre-wrap break-words border-t pt-2">
                          내 메모 · {link.note}
                        </p>
                      )}
                      <p
                        className={`mt-2 text-[10px] ${sourceStatus === 'ok' ? 'text-muted-foreground' : 'text-amber-800'}`}
                      >
                        DART 재무 · {sourceAsOf ?? '출처 기준일 미확인'} ·
                        저장본 {link.snapshot_hash.slice(0, 8)}
                        {sourceStatus === 'ok'
                          ? ''
                          : ` · ${financialEvidenceStatusLabel(sourceStatus)}`}
                      </p>
                      {sourceWarning && (
                        <p className="mt-1 text-[10px] text-amber-800">
                          {sourceWarning}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          render={
                            <Link
                              href={`/stocks/${item.code}?tab=financials`}
                            />
                          }
                        >
                          재무 추이 보기
                        </Button>
                        {link.receipt_no && (
                          <Button
                            size="xs"
                            variant="ghost"
                            render={
                              <a
                                href={documentUrl(link.receipt_no)}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="재무 원문 DART 열기"
                              >
                                <span className="sr-only">
                                  재무 원문 DART 열기
                                </span>
                              </a>
                            }
                          >
                            DART <ExternalLink />
                          </Button>
                        )}
                        {confirming === `financial:${link.id}` ? (
                          <span className="ml-auto flex items-center gap-1">
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={busy === `financial:${link.id}`}
                              onClick={() => setConfirming(null)}
                            >
                              취소
                            </Button>
                            <Button
                              size="xs"
                              variant="destructive"
                              disabled={busy === `financial:${link.id}`}
                              onClick={() => void archive('financial', link.id)}
                            >
                              {busy === `financial:${link.id}`
                                ? '처리 중…'
                                : '해제 확인'}
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="ml-auto"
                            onClick={() =>
                              setConfirming(`financial:${link.id}`)
                            }
                          >
                            연결 해제
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
                {groupCount === 0 && (
                  <p className="rounded-lg border border-dashed px-2.5 py-2 text-[10px] leading-5 text-muted-foreground">
                    이 관계로 분류한 자료가 없습니다.
                  </p>
                )}
              </section>
            );
          })}
        </>
      )}
      <p className="text-[10px] leading-5 text-muted-foreground">
        자료 관계는 사용자가 직접 분류하고 변경할 수 있습니다.
      </p>
    </section>
  );
}

function ManualEvidenceCard({
  item,
  link,
  confirming,
  busy,
  onConfirm,
  onArchive,
}: {
  item: InvestmentThesis;
  link: ManualEvidence;
  confirming: string | null;
  busy: string | null;
  onConfirm: (value: string | null) => void;
  onArchive: (id: string) => void;
}) {
  const key = `manual:${link.id}`;
  return (
    <article className="rounded-lg bg-muted/35 p-2.5 text-[11px] leading-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-background px-1.5 py-0.5 font-medium text-primary">
          {evidenceRelations[link.relation]}
        </span>
        <span className="text-muted-foreground">
          {manualEvidenceTypes[link.source_type]}
        </span>
        <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-800 dark:text-amber-200">
          사용자 입력·미검증
        </span>
      </div>
      <h6 className="mt-2 break-words font-semibold">{link.title}</h6>
      {link.document && (
        <RichMemoOpen document={link.document} title={link.title} />
      )}
      {link.thesis_revision !== item.revision && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-amber-900">
          투자포인트 수정 전 버전에서 연결 · 관계를 다시 확인하세요.
        </p>
      )}
      {link.document ? (
        <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">
          {link.body}
        </p>
      ) : (
        link.body && (
          <details className="mt-2">
            <summary className="cursor-pointer line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">
              {link.body}
            </summary>
            <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-l-2 pl-2 text-muted-foreground">
              {link.body}
            </p>
          </details>
        )
      )}
      {link.note && (
        <p className="mt-2 whitespace-pre-wrap break-words border-t pt-2">
          내 판단 메모 · {link.note}
        </p>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        {link.source_name || '출처명 미입력'} ·{' '}
        {link.published_at || '발행일 미입력'} · 저장{' '}
        {new Date(link.created_at).toLocaleDateString('ko-KR')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {link.url && (
          <Button
            size="xs"
            variant="ghost"
            render={
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${link.title} 링크 열기`}
              />
            }
          >
            링크 열기 <ExternalLink />
          </Button>
        )}
        {confirming === key ? (
          <span className="ml-auto flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              disabled={busy === key}
              onClick={() => onConfirm(null)}
            >
              취소
            </Button>
            <Button
              size="xs"
              variant="destructive"
              disabled={busy === key}
              onClick={() => onArchive(link.id)}
            >
              {busy === key ? '처리 중…' : '해제 확인'}
            </Button>
          </span>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => onConfirm(key)}
          >
            연결 해제
          </Button>
        )}
      </div>
    </article>
  );
}
