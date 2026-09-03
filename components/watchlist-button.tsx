'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Star, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function WatchlistButton({ code }: { code: string }) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/watchlist/${code}`, { cache: 'no-store', signal: abort.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setActive(Boolean(result.record?.item.active));
      })
      .catch((failure) => {
        if (!abort.signal.aborted)
          setError(failure.message || '관심종목 상태를 확인하지 못했습니다.');
      });
    return () => abort.abort();
  }, [code]);
  const register = async () => {
    if (active) {
      router.push(`/stocks/${code}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/watchlist/${code}`, { method: 'PUT' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setActive(true);
      router.push(`/stocks/${code}`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : '등록에 실패했습니다.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Button className="w-full text-xs" disabled={busy} onClick={register}>
        {busy ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <Star className={active ? 'fill-current' : ''} />
        )}
        {active ? '관심종목 검토 이어가기' : '관심종목 등록 · 자료 보강'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-[10px] text-amber-800">
          {error}
        </p>
      )}
    </div>
  );
}
