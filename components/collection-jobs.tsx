'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Activity, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useActionConfirmation } from '@/components/use-action-confirmation';
type Job = {
  id: string;
  kind: 'markets' | 'radar';
  state: string;
  step: string;
  started_at: string;
  updated_at: string;
  error: string | null;
};
type StockJob = {
  peer?: boolean;
  code: string;
  name: string;
  state: string;
  step: string;
  error?: string;
};
const labels: Record<string, string> = {
  queued: '대기',
  running: '진행 중',
  completed: '완료',
  ready: '완료',
  partial: '일부 미확인',
  error: '실패',
};
export function CollectionJobs() {
  const path = usePathname(),
    [open, setOpen] = useState(false),
    [jobs, setJobs] = useState<Job[]>([]),
    [stocks, setStocks] = useState<StockJob[]>([]),
    [error, setError] = useState('');
  const { confirmAction, confirmationDialog } = useActionConfirmation();
  const mobile = path.startsWith('/mobile');
  useEffect(() => {
    if (mobile) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/operations', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) {
          setJobs(data.jobs);
          setStocks(data.stocks);
          setError(data.warning ?? '');
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : '수집 상태를 읽지 못했습니다.',
          );
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('dashboard-jobs', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('dashboard-jobs', refresh);
    };
  }, [mobile]);
  if (mobile) return null;
  const running = [...jobs, ...stocks].filter((j) =>
    ['queued', 'running'].includes(j.state),
  ).length;
  async function retry(job: Job) {
    if (
      !(await confirmAction({
        title: `${job.kind === 'radar' ? 'Radar' : 'Markets'} 수집을 다시 실행할까요?`,
        description:
          job.kind === 'radar'
            ? '동일 기준일의 검증된 가격 체크포인트를 재사용하고 수집·평가를 다시 진행합니다.'
            : '시장 지표를 다시 수집합니다. 기존 리서치는 유지합니다.',
        actionLabel: '다시 실행',
      }))
    )
      return;
    try {
      const r = await fetch(`/api/${job.kind}/refresh`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) setError(data.error);
      window.dispatchEvent(new Event('dashboard-jobs'));
    } catch {
      setError('실행 요청을 보내지 못했습니다. 연결을 확인해 주세요.');
    }
  }
  return (
    <>
      {confirmationDialog}
      <Button
        variant="outline"
        size="sm"
        className="fixed bottom-3 right-4 z-40 rounded-full bg-white shadow-sm"
        onClick={() => setOpen(true)}
      >
        {running ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Activity className="size-3.5" />
        )}
        수집 작업{running ? ` · ${running}` : ''}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>수집 작업</SheetTitle>
            <SheetDescription>
              페이지를 이동해도 수집은 계속됩니다. PC 종료 시에는 중단됩니다.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-6">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {!jobs.length && !stocks.length && (
              <p className="text-sm text-muted-foreground">
                아직 실행한 수집이 없습니다.
              </p>
            )}
            {jobs.map((job) => (
              <section key={job.id} className="rounded-xl border p-4">
                <div className="flex justify-between text-sm font-semibold">
                  <span>{job.kind === 'radar' ? 'Radar' : 'Markets'}</span>
                  <span>{labels[job.state]}</span>
                </div>
                <p className="mt-2 break-words text-xs text-muted-foreground">
                  {job.step}
                </p>
                <time className="mt-2 block text-[10px] text-muted-foreground">
                  {new Date(job.started_at).toLocaleString('ko-KR')}
                </time>
                {job.error && (
                  <p className="mt-2 break-words text-xs text-destructive">
                    {job.error}
                  </p>
                )}
                <div className="mt-3 flex gap-3">
                  {['completed', 'partial'].includes(job.state) && (
                    <a
                      href={`/${job.kind}`}
                      onClick={() => setOpen(false)}
                      className="text-xs text-primary underline"
                    >
                      결과 보기
                    </a>
                  )}
                  {['error', 'partial'].includes(job.state) && (
                    <button
                      onClick={() => void retry(job)}
                      className="text-xs text-primary underline"
                    >
                      다시 실행
                    </button>
                  )}
                </div>
              </section>
            ))}
            {stocks.map((job) => (
              <Link
                key={`${job.peer ? 'peer' : 'watchlist'}-${job.code}`}
                href={job.peer ? '/compare' : `/stocks/${job.code}`}
                onClick={() => setOpen(false)}
                className="block rounded-xl border p-4"
              >
                <div className="flex justify-between text-sm">
                  <strong>
                    {job.name}
                    {job.peer ? ' · 비교 기업' : ''}
                  </strong>
                  <span>{labels[job.state] || job.state}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{job.step}</p>
                <span className="mt-2 block text-xs text-primary">
                  종목 자료 · 상세/재시도
                </span>
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
