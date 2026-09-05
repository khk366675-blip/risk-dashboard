'use client';
/* eslint-disable jsx-a11y/label-has-associated-control */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocalDraft } from '@/components/draft-recovery';
import {
  Archive,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Library,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Target,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  kpiCategoryLabels,
  journalKindLabels,
  learningKindLabels,
  type JournalKind,
  type JournalEntry,
  type KpiObservation,
  type ResearchKpi,
  type ResearchSystemSnapshot,
} from '@/lib/research-system';
import {
  thesisReviewStates,
  type ResearchWorkbench,
} from '@/lib/research-workbench';
import { sourceStateLabels } from '@/lib/research-followup';
import {
  formatMultiple,
  formatPercent,
  formatWon,
  type StockDetail,
} from '@/lib/stock-detail';

const chartConfig = {
  actual: { label: '실제', color: '#2563eb' },
  estimate: { label: '예상', color: '#94a3b8' },
} satisfies ChartConfig;
const sourceDisplayLabels: Record<string, string> = {
  prices: '가격 데이터',
  financials: 'DART 재무 데이터',
  dart_events: 'DART 공시 데이터',
};
const emptySnapshot = (): ResearchSystemSnapshot => ({
  kpis: [],
  archived_kpis: [],
  journal: [],
  archived_journal: [],
  learning: [],
  generated_at: new Date().toISOString(),
});
async function json(response: Response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(value.error || '리서치 기록을 처리하지 못했습니다.');
  return value;
}

function useResearchSystem(code: string) {
  const [data, setData] = useState<ResearchSystemSnapshot>(emptySnapshot());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`/api/watchlist/${code}/research-system`, { cache: 'no-store' })
      .then(json)
      .then((value) => {
        if (active) {
          setData(value);
          setError(null);
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : '자료를 읽지 못했습니다.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [code]);
  const mutate = async (
    method: 'POST' | 'PATCH' | 'DELETE',
    value: Record<string, unknown>,
  ) => {
    setBusy(true);
    try {
      setData(
        await json(
          await fetch(`/api/watchlist/${code}/research-system`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value),
          }),
        ),
      );
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { data, busy, error, mutate };
}

export function KpiWorkspace({ code }: { code: string }) {
  const state = useResearchSystem(code);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'observe' | 'new' | 'edit'>('observe');
  const [showArchived, setShowArchived] = useState(false);
  const [editingObservation, setEditingObservation] =
    useState<KpiObservation | null>(null);
  const visibleKpis = showArchived ? state.data.archived_kpis : state.data.kpis;
  const selected =
    visibleKpis.find((item) => item.id === selectedId) ??
    visibleKpis[0] ??
    null;
  return (
    <div
      className={`flex h-full min-h-[580px] flex-col overflow-y-auto rounded-2xl border bg-card md:grid md:overflow-hidden ${selected ? 'md:grid-cols-[210px_minmax(0,1fr)_250px] 2xl:grid-cols-[250px_minmax(0,1fr)_300px]' : 'md:grid-cols-[250px_minmax(0,1fr)]'}`}
    >
      <aside
        className={`flex min-h-0 shrink-0 flex-col border-b bg-slate-50/70 md:max-h-none md:border-b-0 md:border-r ${visibleKpis.length ? 'max-h-[220px]' : 'max-h-[168px]'}`}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-xs font-semibold">사업 KPI</h2>
            <p className="mt-0.5 text-[9px] text-muted-foreground">
              직접 정의한 기업별 지표
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={showArchived ? 'secondary' : 'ghost'}
              onClick={() => {
                setShowArchived(!showArchived);
                setSelectedId(null);
                setMode('observe');
              }}
            >
              보관함 {state.data.archived_kpis.length || ''}
            </Button>
            {!showArchived && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={() => setMode('new')}
                aria-label="KPI 추가"
              >
                <Plus />
              </Button>
            )}
          </div>
        </div>
        <div
          className={`min-h-0 flex-1 p-2 ${visibleKpis.length ? 'overflow-y-auto' : 'overflow-hidden'}`}
        >
          {visibleKpis.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSelectedId(item.id);
                setMode('observe');
              }}
              className={`mb-1 w-full rounded-xl border px-3 py-2.5 text-left ${selected?.id === item.id ? 'border-primary/20 bg-white shadow-sm' : 'border-transparent hover:bg-white/70'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold">
                  {item.name}
                </span>
                <span className="text-[8px] text-muted-foreground">
                  {item.unit}
                </span>
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">
                {kpiCategoryLabels[item.category]} · 관측{' '}
                {item.observations.length}
              </p>
            </button>
          ))}
          {!visibleKpis.length && (
            <div className="px-3 py-4 text-center">
              <CheckCircle2 className="mx-auto size-4 text-slate-300" />
              <p className="mt-2 text-[10px] font-medium">
                {showArchived
                  ? '보관된 KPI가 없습니다'
                  : '추적 중인 KPI가 없습니다'}
              </p>
              <p className="mt-1 text-[9px] text-muted-foreground">
                {showArchived
                  ? '보관한 KPI는 이곳에서 복구합니다.'
                  : '입력란에서 첫 KPI를 추가하세요.'}
              </p>
            </div>
          )}
        </div>
      </aside>
      {selected && (
        <main className="max-h-[52dvh] min-h-0 overflow-y-auto p-4 md:max-h-none">
          <KpiDetail
            item={selected}
            archived={showArchived}
            onEdit={() => setMode('edit')}
            onEditObservation={(item) => {
              setEditingObservation(item);
              setMode('observe');
            }}
            onArchiveObservation={(id) =>
              state.mutate('DELETE', { kind: 'observation', id })
            }
            onArchive={() =>
              state.mutate('DELETE', { kind: 'kpi', id: selected.id })
            }
            onRestore={() =>
              state.mutate('PATCH', {
                kind: 'kpi',
                id: selected.id,
                action: 'restore',
              })
            }
            busy={state.busy}
          />
        </main>
      )}
      <aside className="min-h-0 shrink-0 overflow-visible border-t p-4 md:overflow-y-auto md:border-l md:border-t-0">
        {showArchived ? (
          <div>
            <h3 className="text-xs font-semibold">보관된 KPI</h3>
            <p className="mt-2 text-[9px] leading-5 text-muted-foreground">
              가운데에서 내용을 확인하고 복구할 수 있습니다. 보관 중에는
              수정하거나 관측값을 추가하지 않습니다.
            </p>
          </div>
        ) : mode === 'new' || mode === 'edit' ? (
          <KpiForm
            key={mode === 'edit' ? selected?.id : 'new'}
            initial={mode === 'edit' ? selected : null}
            busy={state.busy}
            onSubmit={async (value) => {
              const ok = await state.mutate(
                mode === 'edit' ? 'PATCH' : 'POST',
                {
                  kind: 'kpi',
                  ...(mode === 'edit' ? { id: selected?.id } : {}),
                  ...value,
                },
              );
              if (ok) setMode('observe');
            }}
          />
        ) : selected ? (
          <ObservationForm
            key={`${selected.id}:${editingObservation?.id ?? 'new'}`}
            item={selected}
            initial={editingObservation}
            busy={state.busy}
            onCancel={
              editingObservation ? () => setEditingObservation(null) : undefined
            }
            onSubmit={async (value) => {
              const ok = await state.mutate(
                editingObservation ? 'PATCH' : 'POST',
                {
                  kind: 'observation',
                  kpi_id: selected.id,
                  ...(editingObservation ? { id: editingObservation.id } : {}),
                  ...value,
                },
              );
              if (ok) setEditingObservation(null);
              return ok;
            }}
          />
        ) : (
          <KpiForm
            busy={state.busy}
            onSubmit={(value) =>
              state.mutate('POST', { kind: 'kpi', ...value })
            }
          />
        )}
        {state.error && (
          <p className="mt-3 rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">
            {state.error}
          </p>
        )}
      </aside>
    </div>
  );
}

function KpiDetail({
  item,
  archived,
  onEdit,
  onEditObservation,
  onArchiveObservation,
  onArchive,
  onRestore,
  busy,
}: {
  item: ResearchKpi;
  archived: boolean;
  onEdit: () => void;
  onEditObservation: (item: KpiObservation) => void;
  onArchiveObservation: (id: string) => void;
  onArchive: () => void;
  onRestore: () => void;
  busy: boolean;
}) {
  const latest = item.observations.at(-1);
  const chart = item.observations.map((o) => ({
    period: o.period,
    actual: o.actual,
    estimate: o.estimate,
  }));
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {kpiCategoryLabels[item.category]}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              단위 {item.unit}
            </span>
          </div>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">
            {item.name}
          </h3>
          <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
            {item.description || '설명 없음'}
          </p>
        </div>
        <div className="flex gap-1">
          {archived ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onRestore}
            >
              <RotateCcw /> 복구
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onEdit}
              >
                <Pencil /> 수정
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onArchive}
              >
                <Archive /> 보관
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Mini
          label="최근 실제"
          value={latest?.actual ?? null}
          unit={item.unit}
        />
        <Mini
          label="최근 예상"
          value={latest?.estimate ?? null}
          unit={item.unit}
        />
        <Mini label="최근 기간" value={latest?.period ?? '—'} />
      </div>
      <div className="mt-4 rounded-2xl border p-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold">실제 · 예상 추이</h4>
          <span className="text-[8px] text-muted-foreground">
            정규화하지 않은 입력 원수치
          </span>
        </div>
        {chart.length ? (
          <ChartContainer
            config={chartConfig}
            className="mt-2 aspect-auto h-[220px] w-full"
            initialDimension={{ width: 600, height: 220 }}
          >
            <LineChart data={chart} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 5" />
              <XAxis dataKey="period" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={54} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="actual"
                stroke="var(--color-actual)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                dataKey="estimate"
                stroke="var(--color-estimate)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 2 }}
                connectNulls
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <Empty
            title="첫 관측값을 입력하세요"
            body="오른쪽에서 기간, 실제값 또는 당시 예상값과 출처를 함께 저장합니다."
          />
        )}
      </div>
      {item.observations.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <div className="grid min-w-[520px] grid-cols-[1fr_80px_80px_1.2fr_70px] bg-slate-50 px-3 py-2 text-[8px] text-muted-foreground">
            <span>기간</span>
            <span>실제</span>
            <span>예상</span>
            <span>출처</span>
            <span className="text-right">관리</span>
          </div>
          {[...item.observations]
            .reverse()
            .slice(0, 8)
            .map((o) => (
              <div
                key={o.id}
                className="grid min-w-[520px] grid-cols-[1fr_80px_80px_1.2fr_70px] items-center border-t px-3 py-2 text-[10px]"
              >
                <span>{o.period}</span>
                <span className="tabular-nums">{o.actual ?? '—'}</span>
                <span className="tabular-nums text-muted-foreground">
                  {o.estimate ?? '—'}
                </span>
                <span className="truncate text-muted-foreground">
                  {o.source_url ? (
                    <a
                      href={o.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary"
                    >
                      {o.source_label}
                    </a>
                  ) : (
                    o.source_label
                  )}
                </span>
                <span className="flex justify-end gap-0.5">
                  {!archived && (
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${o.period} 관측값 수정`}
                        onClick={() => onEditObservation(o)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${o.period} 관측값 보관`}
                        onClick={() => onArchiveObservation(o.id)}
                      >
                        <Archive />
                      </Button>
                    </>
                  )}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function KpiForm({
  onSubmit,
  busy,
  initial,
}: {
  onSubmit: (value: Record<string, unknown>) => void;
  busy: boolean;
  initial?: ResearchKpi | null;
}) {
  const [name, setName] = useState(initial?.name ?? ''),
    [unit, setUnit] = useState(initial?.unit ?? ''),
    [category, setCategory] = useState(initial?.category ?? 'business'),
    [description, setDescription] = useState(initial?.description ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, unit, category, description });
      }}
    >
      <h3 className="text-xs font-semibold">
        {initial ? 'KPI 정의 수정' : '새 KPI 정의'}
      </h3>
      <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
        기업의 경제성을 설명하는 지표만 추가하세요. PQC 분류는 선택 사항입니다.
      </p>
      <label className="mt-4 block text-[9px] font-medium">이름</label>
      <Input
        className="mt-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="예: 월간 활성 사용자"
        required
      />
      <label className="mt-3 block text-[9px] font-medium">단위</label>
      <Input
        className="mt-1"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        placeholder="명, 원, %, 톤…"
        required
      />
      <label className="mt-3 block text-[9px] font-medium">분류</label>
      <select
        className="mt-1 h-9 w-full rounded-xl border bg-background px-3 text-xs"
        value={category}
        onChange={(e) => setCategory(e.target.value as ResearchKpi['category'])}
      >
        {Object.entries(kpiCategoryLabels).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <label className="mt-3 block text-[9px] font-medium">왜 중요한가</label>
      <Textarea
        className="mt-1 min-h-24"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="투자포인트와 연결되는 이유"
      />
      <Button
        type="submit"
        className="mt-4 w-full"
        disabled={busy || !name.trim() || !unit.trim()}
      >
        {busy ? (
          <RefreshCw className="animate-spin" />
        ) : initial ? (
          <Pencil />
        ) : (
          <Plus />
        )}{' '}
        {initial ? '수정 저장' : 'KPI 추가'}
      </Button>
    </form>
  );
}
function ObservationForm({
  item,
  initial,
  onSubmit,
  onCancel,
  busy,
}: {
  item: ResearchKpi;
  initial?: KpiObservation | null;
  onSubmit: (value: Record<string, unknown>) => Promise<boolean>;
  onCancel?: () => void;
  busy: boolean;
}) {
  const [period, setPeriod] = useState(initial?.period ?? ''),
    [actual, setActual] = useState(initial?.actual?.toString() ?? ''),
    [estimate, setEstimate] = useState(initial?.estimate?.toString() ?? ''),
    [source, setSource] = useState(initial?.source_label ?? ''),
    [url, setUrl] = useState(initial?.source_url ?? ''),
    [note, setNote] = useState(initial?.note ?? '');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await onSubmit({
          period,
          actual: actual === '' ? null : Number(actual),
          estimate: estimate === '' ? null : Number(estimate),
          source_label: source,
          source_url: url,
          note,
        });
        if (ok) {
          setPeriod('');
          setActual('');
          setEstimate('');
          setSource('');
          setUrl('');
          setNote('');
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">
          {initial ? '관측값 수정' : '관측값 추가'}
        </h3>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        )}
      </div>
      <p className="mt-1 text-[9px] text-muted-foreground">
        {item.name} · {item.unit}
      </p>
      <label className="mt-4 block text-[9px] font-medium">기간</label>
      <Input
        className="mt-1"
        value={period}
        onChange={(e) => setPeriod(e.target.value)}
        placeholder="2026 3Q / 2026-09"
        required
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[9px] font-medium">
          실제
          <Input
            className="mt-1"
            type="number"
            step="any"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </label>
        <label className="text-[9px] font-medium">
          당시 예상
          <Input
            className="mt-1"
            type="number"
            step="any"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
          />
        </label>
      </div>
      <label className="mt-3 block text-[9px] font-medium">출처 이름</label>
      <Input
        className="mt-1"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="사업보고서, IR 자료…"
        required
      />
      <label className="mt-3 block text-[9px] font-medium">
        출처 링크 · 선택
      </label>
      <Input
        className="mt-1"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://"
      />
      <label className="mt-3 block text-[9px] font-medium">메모</label>
      <Textarea
        className="mt-1 min-h-20"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        type="submit"
        className="mt-4 w-full"
        disabled={
          busy || !period.trim() || !source.trim() || (!actual && !estimate)
        }
      >
        {initial ? <Pencil /> : <Plus />}{' '}
        {initial ? '수정 저장' : '관측값 저장'}
      </Button>
    </form>
  );
}

export function JournalWorkspace({ code }: { code: string }) {
  const state = useResearchSystem(code);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<JournalKind>('insight'),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [url, setUrl] = useState('');
  const recovery = useLocalDraft(
    `journal:${code}`,
    { editingId, kind, title, body, date, url },
    Boolean(title || body || url),
    (value) => {
      setEditingId(value.editingId);
      setKind(value.kind);
      setTitle(value.title);
      setBody(value.body);
      setDate(value.date);
      setUrl(value.url);
    },
  );
  const save = async () => {
    const ok = await state.mutate(editingId ? 'PATCH' : 'POST', {
      kind: 'journal',
      journal_kind: kind,
      ...(editingId ? { id: editingId } : {}),
      title,
      body,
      occurred_at: date,
      source_url: url,
    });
    if (ok) {
      recovery.clear();
      setTitle('');
      setBody('');
      setUrl('');
      setEditingId(null);
    }
  };
  const visibleJournal = showArchived
    ? state.data.archived_journal
    : state.data.journal;
  const edit = (item: JournalEntry) => {
    setEditingId(item.id);
    setKind(item.kind);
    setTitle(item.title);
    setBody(item.body);
    setDate(item.occurred_at);
    setUrl(item.source_url ?? '');
  };
  const clear = () => {
    setEditingId(null);
    setKind('insight');
    setTitle('');
    setBody('');
    setDate(new Date().toISOString().slice(0, 10));
    setUrl('');
  };
  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-y-auto rounded-2xl border bg-card md:grid md:grid-cols-[minmax(0,1fr)_300px] md:overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_330px]">
      <main
        className={`min-h-0 shrink-0 overflow-y-auto md:max-h-none ${visibleJournal.length ? 'max-h-[45dvh]' : 'max-h-[230px]'}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-5 py-3 backdrop-blur">
          <div>
            <h2 className="text-xs font-semibold">Research Journal</h2>
            <p className="mt-0.5 text-[9px] text-muted-foreground">
              판단 변화 기록
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{visibleJournal.length}개 기록</Badge>
            <Button
              size="sm"
              variant={showArchived ? 'secondary' : 'ghost'}
              onClick={() => {
                setShowArchived(!showArchived);
                clear();
              }}
            >
              보관함 {state.data.archived_journal.length || ''}
            </Button>
          </div>
        </div>
        <div className="p-4">
          {visibleJournal.map((item) => (
            <article
              key={item.id}
              className="relative mb-2 rounded-2xl border bg-white p-4 pl-5"
            >
              <span className="absolute left-0 top-4 h-8 w-1 rounded-r bg-primary/70" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[8px]">
                      {journalKindLabels[item.kind]}
                    </Badge>
                    <time className="text-[8px] text-muted-foreground">
                      {item.occurred_at}
                    </time>
                  </div>
                  <h3 className="mt-2 text-[12px] font-semibold">
                    {item.title}
                  </h3>
                </div>
                <span className="flex gap-0.5">
                  {showArchived ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        state.mutate('PATCH', {
                          kind: 'journal',
                          id: item.id,
                          action: 'restore',
                        })
                      }
                    >
                      <RotateCcw /> 복구
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="기록 수정"
                        onClick={() => edit(item)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="기록 보관"
                        onClick={() =>
                          state.mutate('DELETE', {
                            kind: 'journal',
                            id: item.id,
                          })
                        }
                      >
                        <Archive />
                      </Button>
                    </>
                  )}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[10px] leading-5 text-slate-600">
                {item.body}
              </p>
              {item.source_url && (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[9px] text-primary"
                >
                  연결 자료 <ExternalLink className="size-3" />
                </a>
              )}
            </article>
          ))}
          {!visibleJournal.length && (
            <div className="px-3 py-5 text-center">
              <CheckCircle2 className="mx-auto size-4 text-slate-300" />
              <p className="mt-2 text-[10px] font-medium">
                {showArchived
                  ? '보관된 로그가 없습니다'
                  : '아직 리서치 로그가 없습니다'}
              </p>
              <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                {showArchived
                  ? '보관한 판단 기록은 이곳에서 복구합니다.'
                  : '아래 입력란에서 새 사실이나 판단 변화를 기록하세요.'}
              </p>
            </div>
          )}
        </div>
      </main>
      <aside className="min-h-0 shrink-0 overflow-visible border-t p-4 md:overflow-y-auto md:border-l md:border-t-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">
            {showArchived ? '보관함 안내' : editingId ? '기록 수정' : '새 기록'}
          </h3>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={clear}>
              취소
            </Button>
          )}
        </div>
        <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
          {showArchived
            ? '보관된 기록은 왼쪽 목록에서 복구할 수 있습니다.'
            : '투자포인트 본문을 반복하지 말고 새 사실이나 판단 변화만 기록하세요.'}
        </p>
        {!showArchived && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="mt-4"
          >
            {recovery.banner}
            <label className="text-[9px] font-medium">분류</label>
            <select
              className="mt-1 h-9 w-full rounded-xl border bg-background px-3 text-xs"
              value={kind}
              onChange={(e) => setKind(e.target.value as JournalKind)}
            >
              {Object.entries(journalKindLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <label className="mt-3 block text-[9px] font-medium">기록일</label>
            <Input
              className="mt-1"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <label className="mt-3 block text-[9px] font-medium">제목</label>
            <Input
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <label className="mt-3 block text-[9px] font-medium">
              무엇이 달라졌나
            </label>
            <Textarea
              className="mt-1 min-h-36"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
            <label className="mt-3 block text-[9px] font-medium">
              관련 링크 · 선택
            </label>
            <Input
              className="mt-1"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
            <Button
              type="submit"
              className="mt-4 w-full"
              disabled={state.busy || !title.trim() || !body.trim()}
            >
              {editingId ? <Pencil /> : <Plus />}{' '}
              {editingId ? '수정 저장' : '로그 저장'}
            </Button>
          </form>
        )}
        {state.error && (
          <p className="mt-3 rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">
            {state.error}
          </p>
        )}
      </aside>
    </div>
  );
}

export function ResearchView({ stock }: { stock: StockDetail }) {
  const state = useResearchSystem(stock.code);
  const [workbench, setWorkbench] = useState<ResearchWorkbench | null>(null);
  const [workbenchLoading, setWorkbenchLoading] = useState(true);
  useEffect(() => {
    void fetch('/api/watchlist/workbench', { cache: 'no-store' })
      .then(json)
      .then(setWorkbench)
      .catch(() => setWorkbench(null))
      .finally(() => setWorkbenchLoading(false));
  }, []);
  const research = workbench?.stocks.find((item) => item.code === stock.code);
  const theses = research?.theses ?? [];
  const metrics = [
    ['PER', formatMultiple(stock.valuation.per)],
    ['PBR', formatMultiple(stock.valuation.pbr)],
    ['TTM 매출', formatWon(stock.valuation.ttm_revenue, true)],
    ['TTM 영업이익', formatWon(stock.valuation.ttm_operating_profit, true)],
    ['ROE', formatPercent(stock.valuation.ttm_roe_pct)],
    ['부채비율', formatPercent(stock.valuation.debt_ratio_pct)],
  ];
  return (
    <div className="grid h-full min-h-[600px] gap-3 overflow-y-auto md:grid-cols-[minmax(0,1.45fr)_minmax(270px,.8fr)] md:overflow-hidden">
      <main className="space-y-3 md:overflow-y-auto">
        <section className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Research View</h2>
              <a
                className="mt-2 inline-block text-xs text-primary underline underline-offset-4"
                href={`/api/stocks/${stock.code}/export?format=md`}
                download
              >
                출처 포함 Markdown 저장
              </a>
            </div>
            <Badge variant="secondary">
              {workbenchLoading
                ? '불러오는 중'
                : `${theses.length}개 투자포인트`}
            </Badge>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {metrics.map(([label, value]) => (
              <Mini key={label} label={label} value={value} />
            ))}
          </div>
        </section>
        <section className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-primary" />
            <h3 className="text-xs font-semibold">투자포인트와 검토 상태</h3>
          </div>
          <div className="mt-3 space-y-2">
            {workbenchLoading && (
              <p className="rounded-xl bg-slate-50 p-4 text-[10px] text-muted-foreground">
                투자포인트와 연결 자료를 불러오는 중입니다.
              </p>
            )}
            {!workbenchLoading &&
              theses.map((thesis) => (
                <article key={thesis.id} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[11px] font-semibold">
                      {thesis.content.title ||
                        thesis.content.body.split('\n')[0]}
                    </h4>
                    <Badge variant="outline" className="text-[8px]">
                      근거 {thesis.evidence.total}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[10px] leading-5 text-slate-600">
                    {thesis.content.body}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-muted-foreground">
                    <span>뒷받침 {thesis.evidence.supports}</span>
                    <span>약화 {thesis.evidence.challenges}</span>
                    <span>미확인 {thesis.evidence.context}</span>
                    <span>상태 {thesisReviewStates[thesis.review.state]}</span>
                  </div>
                </article>
              ))}
            {!workbenchLoading && !theses.length && (
              <Empty
                title="작성된 투자포인트가 없습니다"
                body="투자포인트 탭에서 직접 논리를 작성하면 이곳에 요약됩니다."
              />
            )}
          </div>
        </section>
      </main>
      <aside className="space-y-3 md:overflow-y-auto">
        <section className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xs font-semibold">
              <BarChart3 className="size-4 text-primary" /> 핵심 KPI
            </h3>
            <span className="text-[9px] text-muted-foreground">
              {state.busy ? '확인 중' : `${state.data.kpis.length}개`}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {state.data.kpis.slice(0, 6).map((kpi) => {
              const latest = kpi.observations.at(-1);
              return (
                <div key={kpi.id} className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium">{kpi.name}</span>
                    <span className="text-[11px] font-semibold tabular-nums">
                      {latest?.actual ?? '—'}{' '}
                      <small className="font-normal text-muted-foreground">
                        {kpi.unit}
                      </small>
                    </span>
                  </div>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {latest?.period ?? '관측값 없음'} ·{' '}
                    {latest?.source_label ?? '출처 미입력'}
                  </p>
                </div>
              );
            })}
            {!state.busy && !state.data.kpis.length && (
              <p className="rounded-xl bg-slate-50 p-3 text-[10px] text-muted-foreground">
                사업 KPI 탭에서 기업 고유 지표를 추가하세요.
              </p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border bg-card p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold">
            <CalendarClock className="size-4 text-primary" /> 최근 판단 기록
          </h3>
          <div className="mt-3 space-y-3">
            {state.data.journal.slice(0, 5).map((entry) => (
              <div key={entry.id}>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-medium">{entry.title}</span>
                  <span className="ml-auto text-[9px] text-muted-foreground">
                    {entry.occurred_at}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                  {entry.body}
                </p>
              </div>
            ))}
            {!state.busy && !state.data.journal.length && (
              <p className="text-[10px] text-muted-foreground">
                아직 판단 변화 기록이 없습니다.
              </p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xs font-semibold">
              <Library className="size-4 text-primary" /> 연결된 Learning
            </h3>
            <span className="text-[9px] text-muted-foreground">
              {state.busy ? '확인 중' : `${state.data.learning.length}개`}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {state.data.learning.slice(0, 4).map((item) => (
              <Link
                key={item.id}
                href={`/learning?item=${item.id}`}
                className="block rounded-xl bg-slate-50 p-3 hover:bg-slate-100"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] font-medium">
                    {item.title}
                  </span>
                  <Badge variant="outline" className="text-[7px]">
                    {learningKindLabels[item.kind]}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-muted-foreground">
                  {item.applications ||
                    item.lessons ||
                    item.summary ||
                    '연결된 학습 기록'}
                </p>
              </Link>
            ))}
            {!state.busy && !state.data.learning.length && (
              <p className="text-[10px] text-muted-foreground">
                이 종목에 연결된 학습 기록이 없습니다.
              </p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border bg-card p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold">
            <FileText className="size-4 text-primary" /> 자료 상태
          </h3>
          <div className="mt-3 space-y-2">
            {Object.entries(stock.source_status).map(([key, source]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 text-[10px]"
              >
                <span className="truncate text-muted-foreground">
                  {source.source ||
                    sourceDisplayLabels[key] ||
                    '출처 확인 필요'}
                </span>
                <Badge
                  variant={source.status === 'ok' ? 'secondary' : 'outline'}
                  className="text-[9px]"
                >
                  {sourceStateLabels[source.status] ?? '상태 확인 필요'}
                </Badge>
              </div>
            ))}
          </div>
        </section>
        {state.error && (
          <p className="rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">
            {state.error}
          </p>
        )}
      </aside>
    </div>
  );
}

function Mini({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
}) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums">
        {value ?? '—'}
        {unit && value !== null ? (
          <small className="ml-1 text-[8px] font-normal text-muted-foreground">
            {unit}
          </small>
        ) : null}
      </p>
    </div>
  );
}
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid min-h-40 place-items-center p-6 text-center">
      <div>
        <CheckCircle2 className="mx-auto size-5 text-slate-300" />
        <p className="mt-2 text-[11px] font-medium">{title}</p>
        <p className="mt-1 max-w-xs text-[9px] leading-4 text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}
