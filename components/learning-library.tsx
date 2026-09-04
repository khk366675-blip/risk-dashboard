'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Archive,
  BookOpen,
  ChevronRight,
  GitCompareArrows,
  LineChart,
  Plus,
  Radar,
  RotateCcw,
  Save,
  Star,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  learningKindLabels,
  learningStatusLabels,
  type LearningItem,
  type LearningKind,
  type LearningStatus,
} from '@/lib/research-system';

type StockLink = { code: string; name: string };
const blank = (): Partial<LearningItem> & {
  kind: LearningKind;
  status: LearningStatus;
  tags: string[];
  linked_stocks: StockLink[];
} => ({
  kind: 'book',
  status: 'to_read',
  title: '',
  author: '',
  tags: [],
  linked_stocks: [],
  summary: '',
  lessons: '',
  changed_view: '',
  applications: '',
  disagreements: '',
  source_url: '',
  started_at: null,
  finished_at: null,
});
async function read(response: Response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(value.error || '학습 기록을 저장하지 못했습니다.');
  return value;
}
export function LearningLibrary({
  initialItems,
  initialArchivedItems,
  initialSelectedId,
  stocks,
}: {
  initialItems: LearningItem[];
  initialArchivedItems: LearningItem[];
  initialSelectedId?: string | null;
  stocks: StockLink[];
}) {
  const [items, setItems] = useState(initialItems),
    [archivedItems, setArchivedItems] = useState(initialArchivedItems),
    [showArchived, setShowArchived] = useState(
      Boolean(
        initialSelectedId &&
        initialArchivedItems.some((item) => item.id === initialSelectedId),
      ),
    ),
    [selectedId, setSelectedId] = useState<string | null>(
      initialSelectedId ?? initialItems[0]?.id ?? null,
    ),
    [draft, setDraft] = useState(blank()),
    [editing, setEditing] = useState(initialItems.length === 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [query, setQuery] = useState('');
  const visibleItems = showArchived ? archivedItems : items;
  const selected = visibleItems.find((item) => item.id === selectedId) ?? null;
  const shown = editing ? draft : (selected ?? blank());
  const update = (key: string, value: unknown) =>
    setDraft((prior) => ({ ...prior, [key]: value }));
  const startNew = () => {
    setDraft(blank());
    setEditing(true);
    setSelectedId(null);
  };
  const startEdit = (item: LearningItem) => {
    setDraft({ ...item });
    setEditing(true);
    setSelectedId(item.id);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await read(
        await fetch('/api/learning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...draft,
            linked_codes: draft.linked_stocks?.map((s) => s.code) ?? [],
          }),
        }),
      );
      setItems(result.items);
      setArchivedItems(result.archived_items ?? archivedItems);
      const saved =
        result.items.find((item: LearningItem) => item.id === draft.id) ??
        result.items[0];
      setSelectedId(saved?.id ?? null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await read(
        await fetch('/api/learning', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selected.id }),
        }),
      );
      setItems(result.items);
      setArchivedItems(result.archived_items ?? archivedItems);
      setSelectedId(result.items[0]?.id ?? null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '보관하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await read(
        await fetch('/api/learning', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selected.id, action: 'restore' }),
        }),
      );
      setItems(result.items);
      setArchivedItems(result.archived_items ?? []);
      setSelectedId(selected.id);
      setShowArchived(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '복구하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const filtered = visibleItems.filter((item) =>
    `${item.title} ${item.author} ${item.tags.join(' ')}`
      .toLocaleLowerCase('ko-KR')
      .includes(query.toLocaleLowerCase('ko-KR')),
  );
  return (
    <div className="h-dvh overflow-hidden bg-background">
      <div className="grid h-full grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
        <AppNav active="learning" />
        <main className="flex min-w-0 flex-col overflow-hidden">
          <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-3 sm:h-16 sm:flex-nowrap sm:px-5 sm:py-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Link href="/markets" className="hover:text-foreground">Markets</Link>
                <ChevronRight className="size-3" />
                <span className="text-foreground">Learning Library</span>
              </div>
              <h1 className="mt-1 text-base font-semibold tracking-tight sm:text-lg">
                학습 기록
              </h1>
            </div>
            <div className="ml-auto flex shrink-0 gap-1">
              <Button
                size="sm"
                variant={showArchived ? 'secondary' : 'ghost'}
                onClick={() => {
                  const next = !showArchived;
                  setShowArchived(next);
                  setEditing(false);
                  setSelectedId((next ? archivedItems : items)[0]?.id ?? null);
                }}
              >
                보관함 {archivedItems.length || ''}
              </Button>
              {!showArchived && (
                <Button size="sm" onClick={startNew}>
                  <Plus /> 새 기록
                </Button>
              )}
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:grid md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className={`flex min-h-0 shrink-0 flex-col border-b bg-slate-50/60 md:max-h-none md:border-b-0 md:border-r ${filtered.length ? 'max-h-[220px]' : 'max-h-[126px]'}`}>
              <div className="border-b p-3">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="책·저자·태그 검색"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setEditing(false);
                    }}
                    className={`mb-1 w-full rounded-xl border px-3 py-3 text-left ${item.id === selectedId && !editing ? 'border-primary/20 bg-white shadow-sm' : 'border-transparent hover:bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-[11px] font-semibold">
                        {item.title}
                      </span>
                      <Badge variant="outline" className="shrink-0 text-[7px]">
                        {learningKindLabels[item.kind]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      {item.author || '작성자 미입력'} ·{' '}
                      {learningStatusLabels[item.status]}
                    </p>
                    {item.tags.length > 0 && (
                      <p className="mt-2 truncate text-[8px] text-primary">
                        {item.tags.map((tag) => `#${tag}`).join(' ')}
                      </p>
                    )}
                  </button>
                ))}
                {!filtered.length && (
                  <p className="p-4 text-center text-[10px] text-muted-foreground">
                    {showArchived
                      ? '보관된 기록이 없습니다.'
                      : '기록이 없습니다.'}
                  </p>
                )}
              </div>
            </aside>
            <section className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {editing ? (
                <LearningEditor
                  value={shown}
                  stocks={stocks}
                  busy={busy}
                  error={error}
                  onChange={update}
                  onSave={save}
                  onCancel={() => setEditing(false)}
                />
              ) : selected ? (
                <LearningReader
                  item={selected}
                  onEdit={() => startEdit(selected)}
                  onArchive={archive}
                  onRestore={restore}
                  archived={showArchived}
                />
              ) : (
                <div className="grid h-full place-items-center text-center">
                  <div>
                    <BookOpen className="mx-auto size-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium">
                      학습 기록을 선택하거나 추가하세요
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
function LearningEditor({
  value,
  stocks,
  busy,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  value: ReturnType<typeof blank>;
  stocks: StockLink[];
  busy: boolean;
  error: string | null;
  onChange: (key: string, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const linked = value.linked_stocks ?? [];
  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">
            {value.id ? '학습 기록 수정' : '새 학습 기록'}
          </h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            형식은 보조 수단입니다. 필요한 항목만 작성해도 됩니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            취소
          </Button>
          <Button disabled={busy || !value.title?.trim()} onClick={onSave}>
            <Save /> 저장
          </Button>
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[120px_1fr_180px]">
            <select
              className="h-9 rounded-xl border bg-white px-3 text-xs"
              value={value.kind}
              onChange={(e) => onChange('kind', e.target.value)}
            >
              {Object.entries(learningKindLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <Input
              value={value.title ?? ''}
              onChange={(e) => onChange('title', e.target.value)}
              placeholder="제목"
            />
            <Input
              value={value.author ?? ''}
              onChange={(e) => onChange('author', e.target.value)}
              placeholder="저자·강연자"
            />
          </div>
          <Field label="한 줄 요약">
            <Textarea
              value={value.summary ?? ''}
              onChange={(e) => onChange('summary', e.target.value)}
              className="min-h-20"
            />
          </Field>
          <Field label="배운 점">
            <Textarea
              value={value.lessons ?? ''}
              onChange={(e) => onChange('lessons', e.target.value)}
              className="min-h-32"
              placeholder="재사용하고 싶은 개념·프레임"
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="내 관점이 바뀐 부분">
              <Textarea
                value={value.changed_view ?? ''}
                onChange={(e) => onChange('changed_view', e.target.value)}
                className="min-h-28"
              />
            </Field>
            <Field label="현재 리서치에 적용할 점">
              <Textarea
                value={value.applications ?? ''}
                onChange={(e) => onChange('applications', e.target.value)}
                className="min-h-28"
              />
            </Field>
          </div>
          <Field label="동의하지 않거나 더 검증할 점">
            <Textarea
              value={value.disagreements ?? ''}
              onChange={(e) => onChange('disagreements', e.target.value)}
              className="min-h-24"
            />
          </Field>
        </div>
        <aside className="space-y-4 rounded-2xl border bg-slate-50/60 p-4">
          <Field label="상태">
            <select
              className="h-9 w-full rounded-xl border bg-white px-3 text-xs"
              value={value.status}
              onChange={(e) => onChange('status', e.target.value)}
            >
              {Object.entries(learningStatusLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="시작일">
              <Input
                type="date"
                value={value.started_at ?? ''}
                onChange={(e) => onChange('started_at', e.target.value)}
              />
            </Field>
            <Field label="완료일">
              <Input
                type="date"
                value={value.finished_at ?? ''}
                onChange={(e) => onChange('finished_at', e.target.value)}
              />
            </Field>
          </div>
          <Field label="태그">
            <Input
              value={(value.tags ?? []).join(', ')}
              onChange={(e) =>
                onChange(
                  'tags',
                  e.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean),
                )
              }
              placeholder="회계, 경쟁우위, 밸류에이션"
            />
          </Field>
          <Field label="원문 링크">
            <Input
              type="url"
              value={value.source_url ?? ''}
              onChange={(e) => onChange('source_url', e.target.value)}
              placeholder="https://"
            />
          </Field>
          <div>
            <p className="text-[9px] font-medium">연결할 관심종목</p>
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {stocks.map((stock) => {
                const checked = linked.some((item) => item.code === stock.code);
                return (
                  <label
                    key={stock.code}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onChange(
                          'linked_stocks',
                          checked
                            ? linked.filter((item) => item.code !== stock.code)
                            : [...linked, stock],
                        )
                      }
                    />{' '}
                    <span className="truncate">{stock.name}</span>
                    <span className="ml-auto text-[8px] text-muted-foreground">
                      {stock.code}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          {error && (
            <p className="rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">
              {error}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
function LearningReader({
  item,
  onEdit,
  onArchive,
  onRestore,
  archived,
}: {
  item: LearningItem;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  archived: boolean;
}) {
  return (
    <article className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex gap-2">
            <Badge>{learningKindLabels[item.kind]}</Badge>
            <Badge variant="secondary">
              {learningStatusLabels[item.status]}
            </Badge>
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            {item.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.author || '작성자 미입력'}
          </p>
        </div>
        <div className="flex gap-1">
          {archived ? (
            <Button variant="outline" onClick={onRestore}>
              <RotateCcw /> 복구
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onEdit}>
                수정
              </Button>
              <Button variant="ghost" onClick={onArchive}>
                <Archive /> 보관
              </Button>
            </>
          )}
        </div>
      </div>
      {item.tags.length > 0 && (
        <p className="mt-4 text-[10px] text-primary">
          {item.tags.map((tag) => `#${tag}`).join(' ')}
        </p>
      )}
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <ReadBlock title="요약" body={item.summary} wide />
        <ReadBlock title="배운 점" body={item.lessons} />
        <ReadBlock title="내 관점의 변화" body={item.changed_view} />
        <ReadBlock title="리서치 적용" body={item.applications} />
        <ReadBlock
          title="동의하지 않거나 더 검증할 점"
          body={item.disagreements}
        />
      </div>
      {item.linked_stocks.length > 0 && (
        <div className="mt-4 rounded-2xl border p-4">
          <h3 className="text-[10px] font-semibold">연결된 관심종목</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.linked_stocks.map((stock) => (
              <Link
                key={stock.code}
                href={`/stocks/${stock.code}?tab=research`}
                className="rounded-lg bg-primary/5 px-3 py-2 text-[10px] font-medium text-primary hover:bg-primary/10"
              >
                {stock.name} · {stock.code}
              </Link>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-[9px] font-medium">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
function ReadBlock({
  title,
  body,
  wide = false,
}: {
  title: string;
  body: string;
  wide?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border bg-white p-4 ${wide ? 'md:col-span-2' : ''}`}
    >
      <h3 className="text-[10px] font-semibold">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-[10px] leading-5 text-slate-600">
        {body || '작성 내용 없음'}
      </p>
    </section>
  );
}

export function AppNav({ active }: { active: 'learning' | 'compare' }) {
  return (
    <aside className="hidden h-full flex-col border-r bg-sidebar px-4 py-5 md:flex">
      <Link href="/" className="flex items-center gap-3 px-2">
        <span className="grid size-9 place-items-center rounded-xl bg-primary font-bold text-white">
          V
        </span>
        <span>
          <strong className="block text-sm">Value Dashboard</strong>
          <small className="text-[10px] text-muted-foreground">
            Research workspace
          </small>
        </span>
      </Link>
      <nav className="mt-8 space-y-1">
        <Nav href="/markets" icon={LineChart} label="Markets" />
        <Nav href="/radar" icon={Radar} label="Radar" />
        <Nav href="/watchlist" icon={Star} label="관심종목" />
        <Nav
          href="/compare"
          icon={GitCompareArrows}
          label="기업 비교"
          active={active === 'compare'}
        />
        <Nav
          href="/learning"
          icon={BookOpen}
          label="Learning"
          active={active === 'learning'}
        />
      </nav>
      <p className="mt-auto border-t pt-4 text-[8px] leading-4 text-muted-foreground">
        사용자 기록은 로컬 저장소에 보존됩니다.
      </p>
    </aside>
  );
}
function Nav({
  href,
  icon: Icon,
  label,
  active = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[11px] font-medium ${active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
