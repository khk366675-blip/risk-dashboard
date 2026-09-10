export async function runDashboardJob(
  kind: 'markets' | 'radar',
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/${kind}/refresh`, {
    method: 'POST',
    cache: 'no-store',
    signal,
  });
  const started = await response.json();
  if (!response.ok || !started.job)
    throw new Error(started.error || '수집을 시작하지 못했습니다.');
  window.dispatchEvent(new Event('dashboard-jobs'));
  for (;;) {
    const status = await fetch('/api/operations', {
        cache: 'no-store',
        signal,
      }),
      body = await status.json();
    if (!status.ok)
      throw new Error(
        body.error || '작업 패널에서 수집 상태를 다시 확인해 주세요.',
      );
    const job = body.jobs.find(
      (item: { id: string }) => item.id === started.job.id,
    );
    if (!job) throw new Error('실행 기록을 찾지 못했습니다.');
    if (job.state === 'error') throw new Error(job.error || '수집 실패');
    if (['completed', 'partial'].includes(job.state)) {
      const result = await fetch(`/data/${kind}/latest.json?t=${Date.now()}`, {
        cache: 'no-store',
        signal,
      });
      if (!result.ok) throw new Error('완료된 결과를 읽지 못했습니다.');
      return result.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}
