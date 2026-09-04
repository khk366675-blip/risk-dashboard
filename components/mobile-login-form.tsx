'use client';

import { useState } from 'react';
import { LockKeyhole, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function MobileLoginForm() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/mobile/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '로그인하지 못했습니다.');
      window.location.assign('/mobile');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f6f7fb] p-5">
      <section className="w-full max-w-sm rounded-3xl border bg-white p-6 shadow-sm">
        <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><LockKeyhole className="size-5" /></span>
        <p className="mt-5 text-[10px] font-medium uppercase tracking-[.18em] text-primary">Value Dashboard</p>
        <h1 className="mt-1 text-xl font-semibold">모바일 열람</h1>
        <p className="mt-2 text-xs leading-5 text-slate-500">개인 리서치 스냅샷과 메모를 확인합니다.</p>
        <form onSubmit={(event) => { event.preventDefault(); void login(); }} className="mt-6">
          <label className="text-[10px] font-medium" htmlFor="mobile-password">접속 비밀번호</label>
          <Input id="mobile-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2" />
          {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}
          <Button type="submit" className="mt-4 w-full" disabled={!password || busy}>{busy && <RefreshCw className="animate-spin" />} 접속</Button>
        </form>
      </section>
    </main>
  );
}
