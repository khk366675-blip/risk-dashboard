'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StockDetail } from '@/lib/stock-detail';
import type { RadarRun } from '@/lib/radar-run';
import type { ResearchRecord, WatchlistItem } from '@/lib/watchlist';
import { StockDetailWorkspace } from '@/components/stock-detail-workspace';
import type { StockDetailTab } from '@/lib/research-followup';
import { ThesisRegistrationDialog } from '@/components/thesis-registration-dialog';

export type ResearchControls = {
  item: WatchlistItem | null;
  items: WatchlistItem[];
  busy: boolean;
  error: string | null;
  change: (
    action: 'register' | 'remove' | 'refresh' | 'retry',
    initialThesis?: { reason: string; id: string },
  ) => Promise<boolean>;
};

export function ResearchStockController({
  stock,
  radarRun,
  initialRecord,
  initialItems,
  pollInterval,
  initialTab = 'overview',
  initialEventsScope = 'focus',
}: {
  stock: StockDetail;
  radarRun: RadarRun;
  initialRecord: ResearchRecord | null;
  initialItems: WatchlistItem[];
  pollInterval: number;
  initialTab?: StockDetailTab;
  initialEventsScope?: 'focus' | 'all';
}) {
  const router = useRouter();
  const [record, setRecord] = useState(initialRecord);
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const running =
    record?.item.active &&
    ['queued', 'running'].includes(record.item.job?.state ?? '');
  const read = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(`/api/watchlist/${stock.code}`, {
        cache: 'no-store',
        signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || '자료 상태를 확인하지 못했습니다.');
      setRecord(result.record);
      setItems(result.items);
      setError(null);
    },
    [stock.code],
  );
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        await read(abort.signal);
      } catch (failure) {
        if (!abort.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : '연결을 확인해 주세요.',
          );
      }
      if (!abort.signal.aborted && running)
        timer = setTimeout(refresh, pollInterval);
    };
    if (running) timer = setTimeout(refresh, pollInterval);
    const onFocus = () => {
      clearTimeout(timer);
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      abort.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [read, running, pollInterval]);
  const change: ResearchControls['change'] = async (action, initialThesis) => {
    if (busy) return false;
    if (action === 'register' && !initialThesis) {
      setRegisterOpen(true);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/watchlist/${stock.code}`, {
        method:
          action === 'register'
            ? 'PUT'
            : action === 'remove'
              ? 'DELETE'
              : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(action === 'retry' || action === 'refresh'
          ? {
              body: JSON.stringify({
                mode: action === 'retry' ? 'retry' : 'all',
              }),
            }
          : action === 'register'
            ? { body: JSON.stringify(initialThesis) }
            : {}),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || '요청을 완료하지 못했습니다.');
      setRecord(result.record);
      setItems(result.items);
      if (action === 'remove') router.push('/watchlist');
      if (action === 'register')
        router.push(`/stocks/${stock.code}?tab=thesis`);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : '요청에 실패했습니다.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <StockDetailWorkspace
        initialTab={initialTab}
        initialEventsScope={initialEventsScope}
        stock={record?.item.active ? record.stock : stock}
        radarRun={radarRun}
        research={{
          item: record?.item.active ? record.item : null,
          items,
          busy,
          error,
          change,
        }}
      />
      {registerOpen && (
        <ThesisRegistrationDialog
          open
          onClose={() => setRegisterOpen(false)}
          busy={busy}
          error={error}
          onRegister={(reason, id) => change('register', { reason, id })}
        />
      )}
    </>
  );
}
