'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export function useLocalDraft<T>(
  key: string,
  value: T,
  dirty: boolean,
  restore: (value: T) => void,
) {
  const [recovery, setRecovery] = useState<{ value: T; at: string } | null>(
    null,
  );
  const [readyKey, setReadyKey] = useState('');
  const [error, setError] = useState(false);
  const suppressed = useRef(false);
  useEffect(() => {
    suppressed.current = false;
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem(`research-draft:${key}`);
        setRecovery(saved ? JSON.parse(saved) : null);
      } catch {
        setError(true);
      }
      setReadyKey(key);
    }, 0);
    return () => clearTimeout(timer);
  }, [key]);
  useEffect(() => {
    if (!dirty) suppressed.current = false;
    if (!key || readyKey !== key || recovery || !dirty || suppressed.current)
      return;
    const persist = () => {
      if (suppressed.current) return;
      try {
        localStorage.setItem(
          `research-draft:${key}`,
          JSON.stringify({ value, at: new Date().toISOString() }),
        );
      } catch {
        setError(true);
      }
    };
    const timer = setTimeout(persist, 300);
    window.addEventListener('beforeunload', persist);
    return () => {
      clearTimeout(timer);
      persist();
      window.removeEventListener('beforeunload', persist);
    };
  }, [key, readyKey, value, dirty, recovery]);
  const clear = () => {
    suppressed.current = true;
    try {
      localStorage.removeItem(`research-draft:${key}`);
    } catch {
      setError(true);
    }
    setRecovery(null);
  };
  return {
    clear,
    banner: recovery ? (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-blue-50 p-3 text-xs">
        <span className="flex-1">
          작성하던 초안 · {new Date(recovery.at).toLocaleString('ko-KR')}
        </span>
        <Button
          size="sm"
          onClick={() => {
            restore(recovery.value);
            suppressed.current = false;
            setRecovery(null);
          }}
        >
          불러오기
        </Button>
        <Button size="sm" variant="ghost" onClick={clear}>
          버리기
        </Button>
      </div>
    ) : error ? (
      <output className="text-xs text-amber-700">
        브라우저 초안을 보관하지 못했습니다. 직접 저장해 주세요.
      </output>
    ) : null,
  };
}
