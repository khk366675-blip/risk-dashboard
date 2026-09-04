'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Star, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThesisRegistrationDialog } from '@/components/thesis-registration-dialog';

export function WatchlistButton({ code }: { code: string }) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
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
  const register = async (reason: string, id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/watchlist/${code}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setActive(true);
      router.push(`/stocks/${code}`);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : '등록에 실패했습니다.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Button
        className="w-full text-xs"
        disabled={busy}
        onClick={() =>
          active ? router.push(`/stocks/${code}`) : setRegisterOpen(true)
        }
      >
        {busy ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <Star className={active ? 'fill-current' : ''} />
        )}
        {active ? '관심종목 상세' : '관심종목 등록'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-[10px] text-amber-800">
          {error}
        </p>
      )}
      {registerOpen && (
        <ThesisRegistrationDialog
          open
          onClose={() => setRegisterOpen(false)}
          onRegister={register}
          busy={busy}
          error={error}
        />
      )}
    </div>
  );
}
