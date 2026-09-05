'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocalDraft } from '@/components/draft-recovery';
import type { SearchHit } from '@/lib/server/research-search';
export function ResearchTools() {
  const [mode, setMode] = useState<'search' | 'capture' | null>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchHit[]>([]);
  const [draft, setDraft] = useState({ title: '', url: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const recovery = useLocalDraft(
    'quick-capture',
    draft,
    Boolean(draft.title || draft.url || draft.body),
    setDraft,
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMode('search');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (mode !== 'search') return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setError('');
      try {
        const response = await fetch(
          `/api/research/search?q=${encodeURIComponent(query)}`,
          { signal: abort.signal, cache: 'no-store' },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setItems(data.items);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [mode, query]);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/research/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      recovery.clear();
      setDraft({ title: '', url: '', body: '' });
      setSaved(data.item.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-wrap gap-1 border-t pt-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setMode('search');
          setError('');
        }}
      >
        <Search />
        검색 <span className="text-muted-foreground">⌃K</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setMode('capture');
          setSaved(null);
          setError('');
        }}
      >
        <Plus />
        자료 저장
      </Button>
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {mode === 'search' ? '내 리서치 검색' : '자료 빠르게 저장'}
            </DialogTitle>
          </DialogHeader>
          {mode === 'search' ? (
            <>
              <Input
                aria-label="전체 기록 검색"
                placeholder="투자포인트·자료·학습·로그 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="space-y-2">
                {items.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setMode(null)}
                    className="block rounded-xl border p-3 hover:bg-muted"
                  >
                    <p className="text-xs text-primary">{item.kind}</p>
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                      {item.excerpt}
                    </p>
                  </Link>
                ))}
                {query && !items.length && (
                  <p className="text-sm text-muted-foreground">
                    일치하는 저장 기록이 없습니다.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              {recovery.banner}
              <p className="text-sm text-muted-foreground">
                Learning에 보관합니다. 종목은 나중에 연결할 수 있습니다.
              </p>
              <Input
                aria-label="자료 제목"
                placeholder="제목"
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <Input
                aria-label="자료 링크"
                placeholder="링크 · 선택"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
              <Textarea
                aria-label="자료 메모"
                placeholder="기억할 내용이나 내 생각"
                maxLength={5000}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
              <Button disabled={busy || !draft.title.trim()} onClick={save}>
                {busy ? '저장 중' : '저장'}
              </Button>
              {saved && (
                <Link
                  href={`/learning?item=${saved}`}
                  onClick={() => setMode(null)}
                  className="text-sm text-primary"
                >
                  저장한 자료 열기 ↗
                </Link>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
