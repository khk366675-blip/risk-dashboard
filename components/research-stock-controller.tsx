'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StockDetail } from '@/lib/stock-detail';
import type { RadarRun } from '@/lib/radar-run';
import type { ResearchRecord, WatchlistItem } from '@/lib/watchlist';
import { StockDetailWorkspace } from '@/components/stock-detail-workspace';
import type { StockDetailTab } from '@/lib/research-followup';
import { ThesisRegistrationDialog } from '@/components/thesis-registration-dialog';
import { useActionConfirmation } from '@/components/use-action-confirmation';

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
  const { confirmAction, confirmationDialog } = useActionConfirmation();
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
    if (
      action !== 'register' &&
      !(await confirmAction({
        title:
          action === 'remove'
            ? `${stock.name} 관심 해제할까요?`
            : `${stock.name} 자료를 갱신할까요?`,
        description:
          action === 'remove'
            ? '관심종목 목록에서 제외합니다. 작성한 투자포인트·답변·연결 자료는 보존되며, 다시 등록하면 이어서 볼 수 있습니다.'
            : action === 'retry'
              ? '실패하거나 누락된 자료 수집을 다시 요청합니다. 작성한 투자포인트와 메모는 유지됩니다.'
              : '가격·재무·공시 자료를 다시 수집합니다. 시간이 걸릴 수 있으며 작성한 투자포인트와 메모는 유지됩니다.',
        actionLabel: action === 'remove' ? '관심 해제' : '자료 갱신',
        destructive: action === 'remove',
      }))
    )
      return false;
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
      {confirmationDialog}
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
          stockLabel={`${stock.name} (${stock.code})`}
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
