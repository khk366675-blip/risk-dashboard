'use client';

import { useState, type SyntheticEvent } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { thesisConfig } from '@/lib/investment-thesis';
import { formatWon } from '@/lib/stock-detail';

type SearchItem = {
  code: string;
  name: string;
  market: string;
  sector: string;
  industry: string | null;
  latest_price: number | null;
};

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || '요청을 처리하지 못했습니다.');
  return body;
}

export function ManualWatchlistDialog({
  open,
  onOpenChange,
  existingCodes,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  existingCodes: string[];
  onAdded: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [selected, setSelected] = useState<SearchItem | null>(null);
  const [reason, setReason] = useState('');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setError(null);
    setSelected(null);
    try {
      const result = await json(
        await fetch(
          `/api/stocks/search?q=${encodeURIComponent(query.trim())}`,
          {
            cache: 'no-store',
          },
        ),
      );
      setItems(result.items as SearchItem[]);
      setSearched(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : '상장종목을 검색하지 못했습니다.',
      );
    } finally {
      setSearching(false);
    }
  };

  const add = async () => {
    if (!selected || saving || existingCodes.includes(selected.code)) return;
    setSaving(true);
    setError(null);
    try {
      await json(
        await fetch(`/api/watchlist/${selected.code}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'manual',
            id: crypto.randomUUID(),
            reason,
          }),
        }),
      );
      onOpenChange(false);
      onAdded(selected.code);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : '관심종목에 추가하지 못했습니다.',
      );
    } finally {
      setSaving(false);
    }
  };

  const alreadyAdded = selected ? existingCodes.includes(selected.code) : false;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !saving && onOpenChange(value)}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>종목 직접 추가</DialogTitle>
          <DialogDescription>
            최신 KRX 상장종목 목록에서 찾은 종목을 Radar 선정 여부와 관계없이
            관심종목에 추가합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <form className="flex gap-2" onSubmit={search}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="종목명 또는 6자리 종목코드"
              aria-label="추가할 종목 검색"
              maxLength={80}
              disabled={searching || saving}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!query.trim() || searching || saving}
            >
              {searching ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Search />
              )}
              검색
            </Button>
          </form>

          <div className="max-h-52 overflow-y-auto rounded-xl border">
            {items.map((item) => {
              const active = selected?.code === item.code;
              const exists = existingCodes.includes(item.code);
              return (
                <button
                  key={item.code}
                  type="button"
                  className={`flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-0 ${active ? 'bg-primary/[0.05]' : 'hover:bg-muted/40'}`}
                  onClick={() => setSelected(item)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {item.name}
                    </span>
                    <span className="mt-1 block text-[9px] text-muted-foreground">
                      {item.code} · {item.market} ·{' '}
                      {item.industry || item.sector}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[10px] font-medium tabular-nums">
                      {formatWon(item.latest_price)}
                    </span>
                    {exists && (
                      <span className="mt-1 block text-[9px] text-primary">
                        추가됨
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {searched && !items.length && !error && (
              <p className="p-5 text-center text-[11px] text-muted-foreground">
                일치하는 상장종목이 없습니다.
              </p>
            )}
            {!searched && (
              <p className="p-5 text-center text-[11px] text-muted-foreground">
                종목명이나 코드를 입력해 검색하세요.
              </p>
            )}
          </div>

          {selected && (
            <label className="block text-[11px]" htmlFor="manual-watch-reason">
              <span className="font-medium">관심을 갖게 된 이유</span>
              <span className="ml-1 text-muted-foreground">· 선택</span>
              <Textarea
                id="manual-watch-reason"
                className="mt-2 min-h-24 text-xs"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={thesisConfig.max_body_chars}
                placeholder="비워두면 종목만 추가하고 투자포인트는 상세 화면에서 작성합니다."
                disabled={saving}
              />
            </label>
          )}

          {error && (
            <p role="alert" className="text-[11px] leading-5 text-destructive">
              {error}
            </p>
          )}
          <p className="text-[9px] leading-4 text-muted-foreground">
            {selected
              ? `${selected.name} (${selected.code})을(를) 등록할까요? `
              : ''}
            등록하면 가격·재무·DART 공시 수집을 요청합니다. 시간이 걸릴 수
            있으며 AI는 실행하지 않습니다.
          </p>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            disabled={!selected || alreadyAdded || saving}
            onClick={() => void add()}
          >
            {saving && <LoaderCircle className="animate-spin" />}
            {alreadyAdded
              ? '이미 관심종목'
              : saving
                ? '추가 중'
                : '관심종목 추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
